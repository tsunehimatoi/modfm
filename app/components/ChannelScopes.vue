<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ChannelScopesWebGLRenderer, showWebGLErrorBanner } from "../utils/webgl-visualizer";

const channels = ref([]);
const canvasRefs = ref([]);
const containerRef = ref(null);
const totalCanvasRef = ref(null);

// 示波器可见性设置
const showTotal = ref(true);
const showChannels = ref(true);

const isPlaying = ref(false);

const getInitialPlayingState = () => {
  if (typeof window !== "undefined" && window.__playerUiState) {
    return !!window.__playerUiState.isPlaying;
  }
  return false;
};

let lastTickTime = 0;
let lastDomUpdateTime = 0;

function readScopeSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("player_settings") || "{}");
    showTotal.value = s.setTotalScope !== false;
    showChannels.value = s.setChannelScope !== false;
  } catch {}
}

const handleScopeSettings = (e) => {
  if (!e || !e.detail) return;
  if ("showTotal"    in e.detail) showTotal.value    = !!e.detail.showTotal;
  if ("showChannels" in e.detail) showChannels.value = !!e.detail.showChannels;
};

// 两者都关闭时隐藏整个容器
const showContainer = computed(() => showTotal.value || showChannels.value);

// 通道网格列数：自动计算最优列数，使每行尽可能填满、行间均衡
// ≤24 通道最多 8 列（12→6×2，16→8×2）；>24 通道允许收窄至 12 列（48→12×4）
const gridColumns = computed(() => {
  const count = channels.value.length;
  if (count === 0) return 1;
  if (count <= 4) return count;

  // 24 通道及以下保持宽松（最多 8 列），超过 24 允许收窄（最多 12 列）
  const maxCols = count <= 24 ? 8 : 12;

  let best = 4;
  let bestScore = Infinity;

  for (let cols = maxCols; cols >= 4; cols--) {
    const rows = Math.ceil(count / cols);
    const lastRowFill = count % cols;
    const waste = lastRowFill === 0 ? 0 : cols - lastRowFill;
    const score = waste * waste + rows * 4;
    if (score < bestScore) {
      bestScore = score;
      best = cols;
    }
  }

  return best;
});

let rafHandle = null;
let analyserSlots = [];
let canvasCtxs = [];
let canvasSizes = [];
let peakHistory = [];
let waveformSamples = [];   // per-channel: Float32Array[COLS] of raw sample values
let cachedGradients = [];
let resizeObserver = null;
let themeColors = null;
let themeReadAt = 0;
let mqlReducedMotion = null;
let prefersReducedMotion = false;

// Total (sum) waveform state
let totalCtx = null;
let totalSize = null;
let totalSamples = null;    // Float32Array[COLS] summed waveform
let totalGradient = null;
let totalPeak = 0;

const WAVEFORM_SAMPLES = 512; // matches C-side WAVEFORM_SAMPLES
const COLS = 512;            // one texel per waveform sample for full fidelity
let lastFrame = 0;

// ── WebGL state ──────────────────────────────────────────────────────────────
const webglCanvasRef = ref(null);
let webglRenderer = null;
let webglFailed = false;

// Cached Rects for WebGL viewport/scissor to avoid Layout Thrashing (getBoundingClientRect)
let cachedGlRect = null;
let cachedTotalRect = null;
const cachedChannelRects = [];
let needUpdateRects = true;

function updateRectsCache() {
  if (!webglRenderer) return;
  const glCanvas = webglRenderer.canvas;
  if (!glCanvas) return;
  cachedGlRect = glCanvas.getBoundingClientRect();

  if (totalCanvasRef.value) {
    cachedTotalRect = totalCanvasRef.value.getBoundingClientRect();
  } else {
    cachedTotalRect = null;
  }

  cachedChannelRects.length = analyserSlots.length;
  for (let i = 0; i < analyserSlots.length; i++) {
    const placeholder = canvasRefs.value[i];
    if (placeholder) {
      cachedChannelRects[i] = placeholder.getBoundingClientRect();
    } else {
      cachedChannelRects[i] = null;
    }
  }
  needUpdateRects = false;
}

function tryInitWebGL() {
  if (webglFailed || webglRenderer) return;
  const canvas = webglCanvasRef.value;
  if (!canvas) return;
  try {
    webglRenderer = ChannelScopesWebGLRenderer.create(canvas, COLS);
  } catch (e) {
    console.error("[webgl-vis] ChannelScopes WebGL init failed, falling back to 2D canvas. Error:", e);
    showWebGLErrorBanner("多通道示波器 WebGL 初始化错误 (ChannelScopes Init)", e);
    webglFailed = true;
    webglRenderer = null;
  }
}

function destroyWebGL() {
  if (webglRenderer) {
    try { webglRenderer.destroy(); } catch {}
    webglRenderer = null;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const setCanvasRef = (el, idx) => {
  if (el) {
    canvasRefs.value[idx] = el;
    // Only get 2D context if WebGL is not available
    if (webglFailed) {
      canvasCtxs[idx] = el.getContext("2d", { alpha: true, desynchronized: true });
    }
  }
};

const setTotalCanvasRef = (el) => {
  totalCanvasRef.value = el;
  if (el) {
    // Only get 2D context if WebGL is not available
    if (webglFailed) {
      totalCtx = el.getContext("2d", { alpha: true, desynchronized: true });
    }
  } else {
    totalCtx = null;
    totalSize = null;
    totalGradient = null;
  }
};

function readAnalysers() {
  const list = (typeof window !== "undefined" && window.__channelAnalysers) || [];
  analyserSlots = list.filter((slot) => slot && slot.analyser);
  for (const slot of analyserSlots) {
    // Keep analyser in case other components use it, but we don't need FFT size
    slot.analyser.smoothingTimeConstant = 0.25;
  }
  const n = analyserSlots.length;

  canvasRefs.value.length = n;
  canvasCtxs.length = n;
  canvasSizes.length = n;
  cachedGradients.length = n;
  peakHistory.length = n;
  waveformSamples.length = n;

  channels.value = analyserSlots.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    if (!waveformSamples[i] || waveformSamples[i].length !== COLS) {
      waveformSamples[i] = new Float32Array(COLS);
    }
    if (peakHistory[i] == null) peakHistory[i] = 0;
  }

  requestAnimationFrame(resizeAllCanvases);
  needUpdateRects = true;
}

function resizeAllCanvases() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Resize WebGL canvas
  if (webglRenderer && webglCanvasRef.value) {
    webglRenderer.resize(dpr);
  }

  // Resize 2D canvases (fallback mode only)
  if (webglFailed) {
    for (let i = 0; i < canvasRefs.value.length; i++) {
      const canvas = canvasRefs.value[i];
      if (!canvas) continue;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      canvasSizes[i] = { w, h, dpr };
      cachedGradients[i] = null;
    }
    const tCanvas = totalCanvasRef.value;
    if (tCanvas) {
      const rect = tCanvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (tCanvas.width !== w) tCanvas.width = w;
      if (tCanvas.height !== h) tCanvas.height = h;
      totalSize = { w, h, dpr };
      totalGradient = null;
    }
  }
  needUpdateRects = true;
}

function readThemeColors(force) {
  const now = performance.now();
  if (!force && themeColors && now - themeReadAt < 1000) return themeColors;
  themeReadAt = now;
  if (!containerRef.value) {
    themeColors = {
      stroke: "#34d399",
      fillTop: "rgba(52,211,153,0.55)",
      fillBottom: "rgba(52,211,153,0.05)",
      idle: "rgba(148,163,184,0.18)",
      grid: "rgba(255,255,255,0.05)",
      label: "#94a3b8",
    };
    return themeColors;
  }
  const cs = window.getComputedStyle(containerRef.value);
  const stroke = cs.getPropertyValue("--scope-waveform").trim() || "#34d399";
  const accent = cs.getPropertyValue("--accent").trim() || stroke;
  const muted = cs.getPropertyValue("--text-soft").trim() || "#94a3b8";
  const border = cs.getPropertyValue("--border").trim() || "rgba(255,255,255,0.08)";
  themeColors = {
    stroke,
    accent,
    fillTop: hexToRgba(stroke, 0.45),
    fillBottom: hexToRgba(stroke, 0.04),
    idle: hexToRgba(muted, 0.15),
    grid: border,
    label: muted,
  };
  return themeColors;
}

function hexToRgba(color, alpha) {
  if (!color) return `rgba(148,163,184,${alpha})`;
  color = color.trim();
  if (color.startsWith("rgb")) {
    const inner = color.replace(/^rgba?\(|\)$/g, "");
    const parts = inner.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length === 3) return `rgba(${parts.join(",")},${alpha})`;
  }
  if (color.startsWith("#")) {
    let h = color.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length >= 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      if ([r, g, b].every((v) => Number.isFinite(v))) {
        return `rgba(${r},${g},${b},${alpha})`;
      }
    }
  }
  return color;
}

// ── Raw waveform computation (replaces envelope) ───────────────────────
// Takes realWaveData (512 samples from C side), interpolates to COLS samples.
// The C side already handles trigger centering, period-adaptive view width,
// and amplitude normalization — so JS side just interpolates and renders.
function computeWaveform(waveData, samples) {
  if (!waveData || waveData.length === 0) {
    samples.fill(0);
    return 0;
  }

  const dataLen = waveData.length; // 512 from C

  // Compute intensity from peak
  let peakAbs = 0;
  for (let i = 0; i < dataLen; i++) {
    const a = waveData[i] < 0 ? -waveData[i] : waveData[i];
    if (a > peakAbs) peakAbs = a;
  }
  const intensity = Math.min(1, peakAbs / 0.85);

  // Interpolate 512 → COLS samples (linear interpolation) with soft clip
  for (let c = 0; c < COLS; c++) {
    const srcPos = (c / (COLS - 1)) * (dataLen - 1);
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;
    const v0 = waveData[srcIdx];
    const v1 = srcIdx + 1 < dataLen ? waveData[srcIdx + 1] : v0;
    let v = v0 + (v1 - v0) * frac;

    // Hard clip to ±1.0 — essential for correct uint8 texture storage
    // Values outside [-1,1] overflow the Uint8 range and wrap to opposite side
    if (v > 1.0) v = 1.0;
    if (v < -1.0) v = -1.0;

    samples[c] = v;
  }

  return intensity;
}


// ── Raw waveform renderer (SidWiz-style polyline) ──────────────────────
function renderWaveform(ctx, size, samples, colors, intensity) {
  const { w, h } = size;

  ctx.clearRect(0, 0, w, h);

  // Center axis
  ctx.fillStyle = colors.grid;
  ctx.fillRect(0, (h - 1) >> 1, w, 1);

  const halfH = h * 0.5;
  const amp = halfH - 2;

  // Idle: flat center line with uniform stroke color
  if (intensity < 0.02) {
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = Math.max(1, size.dpr);
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(w, halfH);
    ctx.stroke();
    return intensity;
  }

  // Draw polyline through all sample points (SidWiz style)
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  const step = w / (COLS - 1);
  ctx.moveTo(0, halfH - samples[0] * amp);

  for (let c = 1; c < COLS; c++) {
    const x = c * step;
    const y = halfH - samples[c] * amp;
    ctx.lineTo(x, y);
  }

  // Halo pass (wide, translucent)
  ctx.strokeStyle = hexToRgba(colors.stroke, 0.22);
  ctx.lineWidth = Math.max(2, size.dpr * 2.5);
  ctx.stroke();

  // Sharp core pass
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(1.0, size.dpr * 1.1);
  ctx.stroke();

  return intensity;
}

function drawChannel(idx, colors) {
  const slot = analyserSlots[idx];
  if (!slot) return 0;

  // Read realWaveData directly from DummyAnalyser (512 samples from C side)
  const waveData = slot.analyser.realWaveData;
  const samples = waveformSamples[idx];
  if (!samples) return 0;

  // Interpolate waveform samples for rendering but use C-side
  // dB-scaled RMS intensity for LED/glow (continuous, not binary)
  computeWaveform(waveData, samples);
  const intensity = slot.analyser.waveformIntensity ?? 0;

  // 2D fallback only
  if (webglFailed) {
    const ctx = canvasCtxs[idx];
    const size = canvasSizes[idx];
    if (!ctx || !size) return intensity;
    return renderWaveform(ctx, size, samples, colors, intensity);
  }

  return intensity;
}

function drawTotal(colors) {
  if (analyserSlots.length === 0) return 0;

  // Sum all channel waveform samples
  if (!totalSamples || totalSamples.length !== COLS) {
    totalSamples = new Float32Array(COLS);
  }
  totalSamples.fill(0);

  let maxIntensity = 0;
  for (let i = 0; i < analyserSlots.length; i++) {
    const chSamples = waveformSamples[i];
    if (!chSamples) continue;
    for (let c = 0; c < COLS; c++) {
      totalSamples[c] += chSamples[c];
    }
    // Approximate intensity from per-channel peak history
    const p = peakHistory[i] || 0;
    if (p > maxIntensity) maxIntensity = p;
  }

  // Per-frame min-max normalize: map [min, max] → [-1, 1] so peaks always touch edges
  let totalMin = Infinity;
  let totalMax = -Infinity;
  for (let c = 0; c < COLS; c++) {
    const v = totalSamples[c];
    if (v < totalMin) totalMin = v;
    if (v > totalMax) totalMax = v;
  }
  const range = totalMax - totalMin;
  // Noise gate: don't amplify near-silence (range < ~2 LSB of 8-bit)
  if (range > 0.008) {
    const scale = 2.0 / range;
    const offset = (totalMax + totalMin) / 2.0;
    for (let c = 0; c < COLS; c++) {
      totalSamples[c] = (totalSamples[c] - offset) * scale;
    }
  } else {
    totalSamples.fill(0);
  }

  const intensity = Math.min(1, maxIntensity * 1.2);

  // 2D fallback only
  if (webglFailed) {
    if (!totalCtx || !totalSize) return intensity;
    return renderWaveform(totalCtx, totalSize, totalSamples, colors, intensity);
  }

  return intensity;
}

function tick(ts) {
  let allIdle = false;
  if (!isPlaying.value) {
    let checkIdle = true;
    for (let i = 0; i < analyserSlots.length; i++) {
      if ((peakHistory[i] || 0) > 0.01) {
        checkIdle = false;
        break;
      }
    }
    if (totalPeak > 0.01) checkIdle = false;
    if (checkIdle) {
      allIdle = true;
    }
  }

  if (allIdle) {
    stopLoop();
    for (let i = 0; i < analyserSlots.length; i++) {
      peakHistory[i] = 0;
      const cell = canvasRefs.value[i] && canvasRefs.value[i].parentElement;
      if (cell) {
        cell.__activity = 0;
        cell.style.setProperty("--cell-activity", "0.00");
      }
    }
    totalPeak = 0;
    const tCell = totalCanvasRef.value && totalCanvasRef.value.parentElement;
    if (tCell) {
      tCell.__activity = 0;
      tCell.style.setProperty("--cell-activity", "0.00");
    }
  } else {
    rafHandle = requestAnimationFrame(tick);
  }

  // ── Delta Time ──
  const now = performance.now();
  let dt = 22.22;
  if (lastTickTime > 0) {
    dt = Math.max(1, now - lastTickTime);
    if (dt > 100) dt = 22.22; // 挂起或卡顿唤醒防过度衰减
  }
  lastTickTime = now;

  const decayRate = dt / 22.22;
  const decayFactor = Math.pow(0.88, decayRate);

  const shouldUpdateDom = now - lastDomUpdateTime >= 40;
  if (shouldUpdateDom) {
    lastDomUpdateTime = now;
  }

  if (prefersReducedMotion) {
    if (ts - lastFrame < 200) return;
  }
  lastFrame = ts;

  if (analyserSlots.length === 0) return;
  if (document.hidden) return;

  const colors = readThemeColors(false);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Lazy-init WebGL
  if (!webglFailed && !webglRenderer) {
    tryInitWebGL();
  }

  // Draw all channels (populates waveformSamples)
  for (let i = 0; i < analyserSlots.length; i++) {
    const intensity = drawChannel(i, colors);
    const prev = peakHistory[i] || 0;
    const next = intensity > prev ? intensity : prev * decayFactor;
    peakHistory[i] = next;
    const cell = canvasRefs.value[i] && canvasRefs.value[i].parentElement;
    if (cell && shouldUpdateDom) {
      const quantized = Math.round(next * 20) / 20;
      if (cell.__activity !== quantized) {
        cell.__activity = quantized;
        cell.style.setProperty("--cell-activity", quantized.toFixed(2));
      }
    }
  }

  // Total (sum) waveform — uses the waveformSamples populated above.
  const totalIntensity = drawTotal(colors);
  const totalNext = totalIntensity > totalPeak ? totalIntensity : totalPeak * decayFactor;
  totalPeak = totalNext;
  const tCell = totalCanvasRef.value && totalCanvasRef.value.parentElement;
  if (tCell && shouldUpdateDom) {
    const quantized = Math.round(totalNext * 20) / 20;
    if (tCell.__activity !== quantized) {
      tCell.__activity = quantized;
      tCell.style.setProperty("--cell-activity", quantized.toFixed(2));
    }
  }

  // ── WebGL batch rendering via viewport/scissor ────────────────────────
  if (webglRenderer) {
    if (needUpdateRects) {
      updateRectsCache();
    }

    if (cachedGlRect) {
      try {
        webglRenderer.clear();

        const glRect = cachedGlRect;

        // Render Total waveform
        if (showTotal.value && totalSamples && cachedTotalRect) {
          const elRect = cachedTotalRect;
          const vpX = Math.floor((elRect.left - glRect.left) * dpr);
          const vpY = Math.floor((glRect.bottom - elRect.bottom) * dpr);  // WebGL y=0 at bottom
          const vpW = Math.floor(elRect.width * dpr);
          const vpH = Math.floor(elRect.height * dpr);
          if (vpW > 0 && vpH > 0) {
            webglRenderer.renderChannel(
              totalSamples,
              COLS,
              { x: vpX, y: vpY, w: vpW, h: vpH },
              totalPeak,
              colors,
              dpr,
              true,
            );
          }
        }

        // Render each channel
        if (showChannels.value) {
          for (let i = 0; i < analyserSlots.length; i++) {
            const elRect = cachedChannelRects[i];
            if (!elRect || !waveformSamples[i]) continue;
            const vpX = Math.floor((elRect.left - glRect.left) * dpr);
            const vpY = Math.floor((glRect.bottom - elRect.bottom) * dpr);
            const vpW = Math.floor(elRect.width * dpr);
            const vpH = Math.floor(elRect.height * dpr);
            if (vpW > 0 && vpH > 0) {
              webglRenderer.renderChannel(
                waveformSamples[i],
                COLS,
                { x: vpX, y: vpY, w: vpW, h: vpH },
                peakHistory[i] || 0,
                colors,
                dpr,
              );
            }
          }
        }
      } catch (e) {
        console.error("[webgl-vis] ChannelScopes WebGL runtime error, falling back to 2D:", e);
        showWebGLErrorBanner("多通道示波器 WebGL 运行时错误 (ChannelScopes Render)", e);
        destroyWebGL();
        webglFailed = true;
        // Re-initialize 2D contexts
        for (let i = 0; i < canvasRefs.value.length; i++) {
          const el = canvasRefs.value[i];
          if (el) canvasCtxs[i] = el.getContext("2d", { alpha: true, desynchronized: true });
        }
        if (totalCanvasRef.value) {
          totalCtx = totalCanvasRef.value.getContext("2d", { alpha: true, desynchronized: true });
        }
        resizeAllCanvases();
      }
    }
  }
}

function startLoop() {
  if (rafHandle != null) return;
  rafHandle = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafHandle != null) cancelAnimationFrame(rafHandle);
  rafHandle = null;
  lastTickTime = 0;
}

const handleChannelsReady = () => {
  readAnalysers();
};

const handleVisibility = () => {
  if (document.hidden) stopLoop();
  else startLoop();
};

const handleThemeChange = () => {
  readThemeColors(true);
};

const handlePlayState = (e) => {
  if (e && e.detail && typeof e.detail.isPlaying === "boolean") {
    isPlaying.value = e.detail.isPlaying;
    if (isPlaying.value) {
      startLoop();
    }
  }
};

onMounted(() => {
  readScopeSettings();
  if (typeof window !== "undefined") {
    isPlaying.value = getInitialPlayingState();
  }
  if (typeof window.matchMedia === "function") {
    mqlReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion = mqlReducedMotion.matches;
    mqlReducedMotion.addEventListener?.("change", (e) => {
      prefersReducedMotion = e.matches;
    });
  }
  readAnalysers();
  window.addEventListener("player:channels-ready", handleChannelsReady);
  window.addEventListener("player:track-change", handleChannelsReady);
  window.addEventListener("app:locale-changed", handleThemeChange);
  window.addEventListener("player:scope-settings", handleScopeSettings);
  window.addEventListener("player:play-state", handlePlayState);
  document.addEventListener("visibilitychange", handleVisibility);

  if (typeof ResizeObserver !== "undefined" && containerRef.value) {
    resizeObserver = new ResizeObserver(() => resizeAllCanvases());
    resizeObserver.observe(containerRef.value);
  }
  window.addEventListener("resize", resizeAllCanvases);
  startLoop();
});

onBeforeUnmount(() => {
  stopLoop();
  destroyWebGL();
  window.removeEventListener("player:channels-ready", handleChannelsReady);
  window.removeEventListener("player:track-change", handleChannelsReady);
  window.removeEventListener("app:locale-changed", handleThemeChange);
  window.removeEventListener("player:scope-settings", handleScopeSettings);
  window.removeEventListener("player:play-state", handlePlayState);
  document.removeEventListener("visibilitychange", handleVisibility);
  window.removeEventListener("resize", resizeAllCanvases);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});
</script>

<template>
  <div
    ref="containerRef"
    v-show="showContainer"
    class="card channel-scopes p-2.5 opacity-0 translate-y-4 animate-fadeUp [animation-delay:0.07s] hover:shadow-card-hover"
    aria-label="Per-channel oscilloscopes"
  >
    <!-- WebGL Canvas — shared single canvas for all channels -->
    <canvas
      ref="webglCanvasRef"
      class="webgl-channel-canvas"
    ></canvas>



    <div
      v-if="channels.length === 0"
      class="text-xs text-text-muted opacity-70 text-center py-2"
    >
      Channels initializing...
    </div>
    <template v-else>
      <div
        id="scopeTotalCell"
        class="total-cell"
        :style="showTotal ? '' : 'display:none'"
      >
        <span class="channel-label">SUM · ALL CH</span>
        <span class="channel-led" aria-hidden="true"></span>
        <canvas
          :ref="setTotalCanvasRef"
          class="total-canvas"
        ></canvas>
      </div>
      <div
        id="scopeChannelGrid"
        class="channel-grid"
        :data-channels="channels.length"
        :style="showChannels ? { '--grid-cols': gridColumns } : { display: 'none' }"
      >
        <div
          v-for="(_, idx) in channels"
          :key="idx"
          class="channel-cell"
        >
          <span class="channel-label">CH {{ (idx + 1).toString().padStart(2, "0") }}</span>
          <span class="channel-led" aria-hidden="true"></span>
          <canvas
            :ref="(el) => setCanvasRef(el, idx)"
            class="channel-canvas"
          ></canvas>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>

.channel-scopes {
  --cell-bg-a: color-mix(in srgb, var(--surface-2, #0b0f17) 92%, transparent);
  --cell-bg-b: color-mix(in srgb, var(--surface-3, #111827) 78%, transparent);
  display: grid;
  gap: 6px;
  position: relative;
}

/* WebGL canvas overlays the entire container */
.webgl-channel-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}

.total-cell {
  --cell-activity: 0;
  position: relative;
  border-radius: 7px;
  overflow: hidden;
  background:
    radial-gradient(
      120% 80% at 50% 100%,
      color-mix(in srgb, var(--scope-waveform, #34d399) calc(var(--cell-activity) * 22%), transparent) 0%,
      transparent 60%
    ),
    linear-gradient(180deg, var(--cell-bg-a), var(--cell-bg-b));
  border: 1px solid
    color-mix(in srgb, var(--scope-waveform, #34d399) calc(35% + var(--cell-activity) * 25%), var(--border));
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, white calc(var(--cell-activity) * 14%), transparent),
    0 6px 14px -10px color-mix(in srgb, var(--scope-waveform, #34d399) calc(var(--cell-activity) * 70%), transparent);
  transition: box-shadow 120ms linear, border-color 120ms linear;
}
.total-cell::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(
    to right,
    var(--border, rgba(255, 255, 255, 0.06)) 1px,
    transparent 1px
  );
  background-size: 12.5% 100%;
  opacity: 0.16;
}
.total-canvas {
  width: 100%;
  height: 56px;
  display: block;
  position: relative;
}
.total-cell .channel-label {
  font-size: 9px;
  letter-spacing: 0.16em;
  opacity: 0.9;
  color: color-mix(in srgb, var(--scope-waveform, #34d399) 60%, var(--text));
}
.channel-grid {
  display: grid;
  gap: 3px;
  /* Mobile: max 6 cols */
  grid-template-columns: repeat(min(var(--grid-cols, 4), 6), 1fr);
}
@media (min-width: 720px) {
  .channel-grid {
    gap: 4px;
    /* Tablet: max 8 cols */
    grid-template-columns: repeat(min(var(--grid-cols, 6), 8), 1fr);
  }
}
@media (min-width: 1024px) {
  .channel-grid {
    /* Desktop: max 12 cols */
    grid-template-columns: repeat(min(var(--grid-cols, 8), 12), 1fr);
  }
}
.channel-cell {
  --cell-activity: 0;
  position: relative;
  border-radius: 5px;
  overflow: hidden;
  background:
    radial-gradient(
      120% 80% at 50% 100%,
      color-mix(in srgb, var(--scope-waveform, #34d399) calc(var(--cell-activity) * 18%), transparent) 0%,
      transparent 60%
    ),
    linear-gradient(180deg, var(--cell-bg-a), var(--cell-bg-b));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, white calc(var(--cell-activity) * 10%), transparent),
    0 0 0 1px transparent,
    0 4px 10px -8px color-mix(in srgb, var(--scope-waveform, #34d399) calc(var(--cell-activity) * 65%), transparent);
  transition: box-shadow 120ms linear, border-color 120ms linear;
  will-change: box-shadow;
}
.channel-cell::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(
    to right,
    var(--border, rgba(255, 255, 255, 0.06)) 1px,
    transparent 1px
  );
  background-size: 25% 100%;
  opacity: 0.14;
}
.channel-canvas {
  width: 100%;
  height: 32px;
  display: block;
  position: relative;
}
.channel-label {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 7px;
  font-family: ui-monospace, "Fira Code", SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.05em;
  font-weight: 700;
  color: var(--text-soft, #94a3b8);
  opacity: 0.75;
  pointer-events: none;
  z-index: 2;
  text-shadow: 0 1px 0 color-mix(in srgb, var(--surface-2, #000) 70%, transparent);
}
.channel-led {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: color-mix(
    in srgb,
    var(--scope-waveform, #34d399) calc(var(--cell-activity) * 100%),
    color-mix(in srgb, var(--text-soft, #94a3b8) 30%, transparent)
  );
  box-shadow: 0 0 calc(var(--cell-activity) * 6px) color-mix(in srgb, var(--scope-waveform, #34d399) 80%, transparent);
  z-index: 2;
  pointer-events: none;
  transition: background-color 120ms linear, box-shadow 120ms linear;
}
@media (prefers-reduced-motion: reduce) {
  .channel-cell {
    transition: none;
  }
  .channel-led {
    transition: none;
  }
}
</style>
