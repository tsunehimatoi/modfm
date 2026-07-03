#ifndef WAVEFORM_PROCESSOR_H
#define WAVEFORM_PROCESSOR_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ── Constants (matching SidWiz defaults) ──────────────────────────────────
#define WAVEFORM_SAMPLES    512    // output waveform points
#define PCM_BUFFER_SIZE     4096   // rolling PCM buffer (93ms @ 44100Hz)
#define DEFAULT_VIEW_WIDTH  2048   // fallback view width when period unknown
#define TARGET_CYCLES       3      // always show ~3 waveform cycles
#define MIN_VIEW_SAMPLES    512    // minimum view window = 1:1 with output (no oversampling)
#define MAX_VIEW_SAMPLES    4096   // maximum view window (for very low freq)
#define LOCK_WINDOW         200    // ±samples around prev trigger for PLL lock
#define STABLE_THRESHOLD    3      // frames of stability before narrowing search
#define PERIOD_SMOOTH       0.7f   // EMA smoothing factor for period tracking

// ── Per-channel DSP state ─────────────────────────────────────────────────
typedef struct ChannelState {
    // Rolling PCM buffer (HP-filtered, float [-1, 1])
    float pcm_buf[PCM_BUFFER_SIZE];
    int   pcm_write_pos;   // next write position in circular buffer
    int   pcm_filled;       // total samples ever written (for initial fill)

    // 1-pole high-pass filter state (20Hz @ 44100Hz, matching SidWiz)
    // y[n] = a * (y[n-1] + x[n] - x[n-1]);  a = e^(-2π·20/44100) ≈ 0.99715
    float hp_prev_in;
    float hp_prev_out;

    // PeakSpeedTrigger state (matching SidWiz algorithm exactly)
    int   prev_trigger;       // previous trigger point (sample index in PCM buffer)
    int   trigger_stability;  // consecutive frames with stable trigger

    // Adaptive view width (cycles-based, like SidWiz)
    int   view_width;         // current adaptive view width (samples)
    float detected_period;    // EMA-smoothed detected signal period (samples)

    // Rolling peak for amplitude normalization
    float rolling_peak;

    // Staleness detection: incremented each process() call, reset by feed().
    // When > 4 the mixer has stopped feeding this channel → force-decay to zero.
    int   frames_since_feed;
} ChannelState;

// ── API ───────────────────────────────────────────────────────────────────

// Initialize a channel state. Call once per channel before use.
void waveform_channel_init(ChannelState* state);

// Feed new PCM samples to a channel's rolling buffer.
//   state:   channel state pointer
//   pcm:     int16 PCM samples (little-endian, values in [-32768, 32767])
//   count:   number of int16 samples
// The function converts int16→float, applies HP filter, and stores in buffer.
void waveform_channel_feed_int16(ChannelState* state, const int16_t* pcm, int count);

// Feed float PCM samples (already in [-1, 1] range).
void waveform_channel_feed_float(ChannelState* state, const float* pcm, int count);

// Process the rolling buffer: find trigger, extract waveform, normalize.
//   state:   channel state pointer
//   output:  destination float buffer (must be at least WAVEFORM_SAMPLES)
// Returns:   signal intensity [0, 1] (0 = silent)
float waveform_channel_process(ChannelState* state, float* output);

extern ChannelState* g_active_waveform_states;

#ifdef __cplusplus
}
#endif

#endif // WAVEFORM_PROCESSOR_H
