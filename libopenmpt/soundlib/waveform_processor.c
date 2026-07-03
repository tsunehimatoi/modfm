#include "waveform_processor.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

ChannelState* g_active_waveform_states = NULL;

// ── High-pass filter constant ─────────────────────────────────────────────
// 20Hz @ 44100Hz, 1-pole. SidWiz uses BiQuad but 1-pole is within 0.1dB.
// a = exp(-2π * 20 / 44100) ≈ 0.99715
#define HP_A 0.99715f

// ── Amplitude normalization ───────────────────────────────────────────────
#define NORM_TARGET     0.85f   // target peak amplitude (85% of full scale)
#define PEAK_SMOOTH     0.85f   // rolling peak smoothing (faster response to transients)
#define MIN_PEAK        0.001f  // minimum peak to prevent division by zero
#define MAX_SAMPLE      1.0f    // hard clip ceiling (must be ≤1.0 for uint8 texture storage)

// ── Int16 conversion ──────────────────────────────────────────────────────
#define INT16_TO_FLOAT(s) ((float)(s) * (1.0f / 32768.0f))

// ───────────────────────────────────────────────────────────────────────────
// Initialize channel state
// ───────────────────────────────────────────────────────────────────────────
void waveform_channel_init(ChannelState* state) {
    memset(state, 0, sizeof(ChannelState));
    state->prev_trigger = -1;
    state->trigger_stability = 0;
    state->view_width = DEFAULT_VIEW_WIDTH;
    state->detected_period = 0.0f;
    state->rolling_peak = 0.1f;  // non-zero initial to avoid extreme scaling
    state->frames_since_feed = 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Apply high-pass filter to a single sample
// ───────────────────────────────────────────────────────────────────────────
static inline float hp_filter(float x, float* prev_in, float* prev_out) {
    float y = HP_A * (*prev_out + x - *prev_in);
    *prev_in = x;
    *prev_out = y;
    return y;
}

// ───────────────────────────────────────────────────────────────────────────
// Feed int16 PCM samples into the rolling buffer with HP filter
// ───────────────────────────────────────────────────────────────────────────
void waveform_channel_feed_int16(ChannelState* state, const int16_t* pcm, int count) {
    state->frames_since_feed = 0;
    for (int i = 0; i < count; i++) {
        float x = INT16_TO_FLOAT(pcm[i]);
        float y = hp_filter(x, &state->hp_prev_in, &state->hp_prev_out);

        // Write to circular buffer at current position
        state->pcm_buf[state->pcm_write_pos] = y;

        // Advance write position (circular)
        state->pcm_write_pos++;
        if (state->pcm_write_pos >= PCM_BUFFER_SIZE) {
            state->pcm_write_pos = 0;
        }
    }
    state->pcm_filled += count;
}

// ───────────────────────────────────────────────────────────────────────────
// Feed float PCM samples into the rolling buffer with HP filter
// ───────────────────────────────────────────────────────────────────────────
void waveform_channel_feed_float(ChannelState* state, const float* pcm, int count) {
    state->frames_since_feed = 0;
    for (int i = 0; i < count; i++) {
        float y = hp_filter(pcm[i], &state->hp_prev_in, &state->hp_prev_out);

        state->pcm_buf[state->pcm_write_pos] = y;

        state->pcm_write_pos++;
        if (state->pcm_write_pos >= PCM_BUFFER_SIZE) {
            state->pcm_write_pos = 0;
        }
    }
    state->pcm_filled += count;
}

// ───────────────────────────────────────────────────────────────────────────
// Read a sample from the circular PCM buffer at a given offset from the
// current write position. offset=0 is the newest sample, offset=1 is the
// second newest, etc.
// ───────────────────────────────────────────────────────────────────────────
static inline float pcm_get(const ChannelState* state, int offset) {
    // offset = 0 means newest sample (write_pos - 1)
    int idx = state->pcm_write_pos - 1 - offset;
    while (idx < 0) idx += PCM_BUFFER_SIZE;
    if (idx >= PCM_BUFFER_SIZE) idx -= PCM_BUFFER_SIZE;
    return state->pcm_buf[idx];
}

// ───────────────────────────────────────────────────────────────────────────
// PeakSpeedTrigger — EXACT match to SidWiz algorithm
//
// Finds the rising edge (negative→positive zero crossing) that has the
// highest subsequent peak value AND shortest distance from crossing to peak.
// Searches within [search_start, search_end) in the PCM buffer.
//
// Parameters:
//   state:         channel state
//   search_start:  first sample index to search (offset from newest)
//   search_end:    last sample index to search (exclusive)
//   lock_target:   preferred trigger position (previous trigger or center)
//
// Returns: trigger offset from newest sample, or -1 if not found
// ───────────────────────────────────────────────────────────────────────────
static int peak_speed_trigger(const ChannelState* state,
                               int search_start, int search_end,
                               int lock_target) {
    float peak_value = -1e30f;
    int shortest_distance = 0x7FFFFFFF;
    int result = -1;

    int i = search_start;
    while (i < search_end) {
        // Find positive edge crossing zero (negative→positive)
        while (i < search_end && pcm_get(state, i) > 0.0f) i++;
        while (i < search_end && pcm_get(state, i) <= 0.0f) i++;
        if (i >= search_end) break;

        int last_crossing = i;

        // Find peak value after crossing, pick closest to crossing
        float sample = pcm_get(state, i);
        while (i < search_end && sample > 0.0f) {
            if (sample > peak_value) {
                peak_value = sample;
                result = last_crossing;
                shortest_distance = i - last_crossing;
            } else if (sample == peak_value && (i - last_crossing) < shortest_distance) {
                result = last_crossing;
                shortest_distance = i - last_crossing;
            }
            i++;
            if (i < search_end) sample = pcm_get(state, i);
        }
    }

    (void)lock_target; // kept for API compatibility with PLL variant
    return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Detect signal period by measuring distance from trigger to next rising
// zero-crossing. Returns period in samples, or -1 if undetectable.
// ───────────────────────────────────────────────────────────────────────────
static float detect_period(const ChannelState* state, int trigger_offset) {
    // Scan forward from trigger to find the next positive zero crossing
    int found = 0;
    int i = trigger_offset - 1;  // start one before trigger
    if (i < 0) i = 0;

    // First, move past the current cycle's positive half
    while (i > 0 && pcm_get(state, i) > 0.0f) i--;
    // Now find the next rising edge
    while (i > 0 && pcm_get(state, i) <= 0.0f) i--;
    if (i <= 0) return -1.0f;

    int next_crossing = i;

    // Period = distance from trigger to next rising edge
    int period = trigger_offset - next_crossing;
    if (period < 2 || period > PCM_BUFFER_SIZE / 2) return -1.0f;

    return (float)period;
}

// ───────────────────────────────────────────────────────────────────────────
// Process the rolling buffer: find trigger, detect period, adapt view width,
// extract waveform, normalize. Returns intensity [0, 1].
// ───────────────────────────────────────────────────────────────────────────
float waveform_channel_process(ChannelState* state, float* output) {
    // ── Staleness detection: if no mixer data was fed since last call,
    //    the channel is silent.  Push silence into the buffer so the
    //    waveform/LED decay to zero instead of freezing.
    state->frames_since_feed++;
    if (state->frames_since_feed > 4) {
        state->rolling_peak *= 0.7f;
        if (state->rolling_peak < 0.001f) state->rolling_peak = 0.001f;
        for (int i = 0; i < 128; i++) {
            state->pcm_buf[state->pcm_write_pos] = 0.0f;
            state->pcm_write_pos++;
            if (state->pcm_write_pos >= PCM_BUFFER_SIZE) state->pcm_write_pos = 0;
        }
        state->pcm_filled += 128;
    }

    // Need at least one full buffer of data
    if (state->pcm_filled < PCM_BUFFER_SIZE) {
        for (int i = 0; i < WAVEFORM_SAMPLES; i++) output[i] = 0.0f;
        return 0.0f;
    }

    // ── 1. Compute peak and RMS (for intensity) ──────────────────────────
    float peak_abs = 0.0f;
    float sum_sq = 0.0f;
    for (int i = 0; i < PCM_BUFFER_SIZE; i++) {
        float v = state->pcm_buf[i];
        float a = v < 0.0f ? -v : v;
        if (a > peak_abs) peak_abs = a;
        sum_sq += v * v;
    }
    float rms = sqrtf(sum_sq / (float)PCM_BUFFER_SIZE);

    // ── dB-scaled RMS intensity → continuous [0, 1] ─────────────────────
    // -50 dBFS (rms ≈ 0.00316) → 0.0   -10 dBFS (rms ≈ 0.316) → 0.8
    //   0 dBFS (rms = 1.0)     → 1.0
    float intensity;
    if (rms < 0.00003f) {
        intensity = 0.0f;
    } else {
        float db = 20.0f * log10f(rms);
        intensity = (db + 50.0f) / 50.0f;
        if (intensity < 0.0f) intensity = 0.0f;
        if (intensity > 1.0f) intensity = 1.0f;
    }

    // ── 2. Determine adaptive view width ──────────────────────────────────
    int view_width = state->view_width;
    if (view_width < MIN_VIEW_SAMPLES) view_width = MIN_VIEW_SAMPLES;
    if (view_width > MAX_VIEW_SAMPLES) view_width = MAX_VIEW_SAMPLES;

    int half_view = view_width / 2;
    int search_start = half_view;
    int search_end = PCM_BUFFER_SIZE - half_view;

    // Ensure search range is valid
    if (search_end <= search_start) {
        search_start = PCM_BUFFER_SIZE / 4;
        search_end = PCM_BUFFER_SIZE * 3 / 4;
    }

    int center = PCM_BUFFER_SIZE / 2;

    // ── 3. Find trigger point ─────────────────────────────────────────────
    int trigger_offset = -1;

    if (peak_abs > 0.003f) {
        int eff_start = search_start;
        int eff_end = search_end;

        if (state->prev_trigger >= 0 &&
            state->prev_trigger >= search_start &&
            state->prev_trigger <= search_end &&
            state->trigger_stability > STABLE_THRESHOLD) {
            int lock_lo = state->prev_trigger - LOCK_WINDOW;
            int lock_hi = state->prev_trigger + LOCK_WINDOW;
            if (lock_lo < search_start) lock_lo = search_start;
            if (lock_hi > search_end) lock_hi = search_end;
            eff_start = lock_lo;
            eff_end = lock_hi;
        }

        trigger_offset = peak_speed_trigger(state, eff_start, eff_end,
                                             state->prev_trigger >= 0 ? state->prev_trigger : center);

        if (trigger_offset < 0 && (eff_start != search_start || eff_end != search_end)) {
            trigger_offset = peak_speed_trigger(state, search_start, search_end, center);
        }
    }

    if (trigger_offset < search_start || trigger_offset > search_end) {
        trigger_offset = center;
        state->trigger_stability = 0;
    } else {
        if (state->prev_trigger >= 0 &&
            abs(trigger_offset - state->prev_trigger) < 60) {
            state->trigger_stability++;
            if (state->trigger_stability > 30) state->trigger_stability = 30;
        } else {
            state->trigger_stability--;
            if (state->trigger_stability < 0) state->trigger_stability = 0;
        }
    }
    state->prev_trigger = trigger_offset;

    // ── 4. Detect period and adapt view width ─────────────────────────────
    if (peak_abs > 0.003f) {
        float period = detect_period(state, trigger_offset);
        if (period > 0.0f) {
            // EMA smooth the period
            if (state->detected_period <= 0.0f) {
                state->detected_period = period;
            } else {
                state->detected_period = PERIOD_SMOOTH * state->detected_period
                                       + (1.0f - PERIOD_SMOOTH) * period;
            }

            // Target: TARGET_CYCLES cycles in view
            float target_width = state->detected_period * (float)TARGET_CYCLES;
            int new_width = (int)(target_width + 0.5f);

            // Clamp
            if (new_width < MIN_VIEW_SAMPLES) new_width = MIN_VIEW_SAMPLES;
            if (new_width > MAX_VIEW_SAMPLES) new_width = MAX_VIEW_SAMPLES;

            // Smooth view width change (max 20% change per frame for stability)
            int diff = new_width - view_width;
            int max_change = view_width / 5;
            if (max_change < 10) max_change = 10;
            if (diff > max_change) diff = max_change;
            if (diff < -max_change) diff = -max_change;
            state->view_width = view_width + diff;
        } else {
            // No period detected — slowly drift toward default
            if (state->view_width < DEFAULT_VIEW_WIDTH) {
                state->view_width += (DEFAULT_VIEW_WIDTH - state->view_width) / 8;
            } else {
                state->view_width -= (state->view_width - DEFAULT_VIEW_WIDTH) / 8;
            }
        }
    }

    // Use the updated view_width
    view_width = state->view_width;
    if (view_width < MIN_VIEW_SAMPLES) view_width = MIN_VIEW_SAMPLES;
    if (view_width > MAX_VIEW_SAMPLES) view_width = MAX_VIEW_SAMPLES;
    half_view = view_width / 2;

    // ── 5. Extract waveform samples centered on trigger ────────────────────
    int start_offset = trigger_offset + half_view;
    if (start_offset > PCM_BUFFER_SIZE - 1) start_offset = PCM_BUFFER_SIZE - 1;

    float src_step = (float)view_width / (float)WAVEFORM_SAMPLES;
    float wf_peak = 0.0f;

    for (int s = 0; s < WAVEFORM_SAMPLES; s++) {
        float src_pos = (float)start_offset - s * src_step;
        if (src_pos < 0.0f) src_pos = 0.0f;
        if (src_pos > (float)(PCM_BUFFER_SIZE - 1)) src_pos = (float)(PCM_BUFFER_SIZE - 1);

        int src_idx = (int)src_pos;
        float frac = src_pos - (float)src_idx;

        float v0 = pcm_get(state, src_idx);
        float v1 = pcm_get(state, src_idx + 1);
        float v = v0 + (v1 - v0) * frac;
        output[s] = v;

        float a = v < 0.0f ? -v : v;
        if (a > wf_peak) wf_peak = a;
    }

    // ── 6. Normalize amplitude ────────────────────────────────────────────
    state->rolling_peak = state->rolling_peak * PEAK_SMOOTH + peak_abs * (1.0f - PEAK_SMOOTH);

    float norm_peak = state->rolling_peak;
    if (norm_peak < MIN_PEAK) norm_peak = MIN_PEAK;
    float norm_scale = NORM_TARGET / norm_peak;

    if (norm_scale < 1000.0f) {
        for (int s = 0; s < WAVEFORM_SAMPLES; s++) {
            float val = output[s] * norm_scale;
            // Hard clip to prevent extreme overshoot on sudden transients
            if (val > MAX_SAMPLE) val = MAX_SAMPLE;
            if (val < -MAX_SAMPLE) val = -MAX_SAMPLE;
            output[s] = val;
        }
    }

    return intensity;
}
