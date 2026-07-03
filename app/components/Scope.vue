<script setup>
defineProps({
  mode: {
    type: String,
    default: "card",
    validator: (value) => ["card", "background"].includes(value),
  },
});
</script>

<template>
  <div
    id="scope"
    :class="[
      'relative overflow-hidden',
      mode === 'card'
        ? 'scope-card card p-3.5 opacity-0 translate-y-4 animate-fadeUp [animation-delay:0.05s] hover:shadow-card-hover'
        : 'scope-bg',
    ]"
    :data-mode="mode"
  >
    <span class="scope-corner scope-corner--tl" aria-hidden="true"></span>
    <span class="scope-corner scope-corner--tr" aria-hidden="true"></span>
    <span class="scope-corner scope-corner--bl" aria-hidden="true"></span>
    <span class="scope-corner scope-corner--br" aria-hidden="true"></span>
    <canvas
      id="scopeCanvas"
      :class="
        mode === 'card'
          ? 'w-full h-[110px] block rounded-sm relative z-[1]'
          : 'scope-bg-canvas'
      "
      :data-fill="mode === 'background' ? 'true' : 'false'"
    ></canvas>
    <!-- Inactive label overlay (used by WebGL mode since WebGL can't draw text) -->
    <span
      id="scopeInactiveLabel"
      class="scope-inactive-label"
      style="display: none"
    ></span>
  </div>
</template>

<style scoped>
.scope-card {
  background:
    radial-gradient(
      120% 90% at 50% 110%,
      color-mix(in srgb, var(--scope-waveform, #34d399) 14%, transparent) 0%,
      transparent 55%
    ),
    radial-gradient(
      90% 60% at 0% 0%,
      color-mix(in srgb, var(--scope-spectrum-start, #3b82f6) 10%, transparent)
        0%,
      transparent 60%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface-2, #0b0f17) 92%, transparent),
      color-mix(in srgb, var(--surface-3, #111827) 78%, transparent)
    );
}
.scope-card::before {
  content: "";
  position: absolute;
  inset: 12px;
  border-radius: 4px;
  pointer-events: none;
  background-image: repeating-linear-gradient(
    to right,
    color-mix(
        in srgb,
        var(--border, rgba(255, 255, 255, 0.06)) 60%,
        transparent
      )
      0 1px,
    transparent 1px calc(100% / 8)
  );
  opacity: 0.18;
  z-index: 0;
}

/* Background mode: scope occupies a top strip (less than half the card) */
.scope-bg {
  position: absolute;
  inset: 0 0 auto 0;
  height: 48%;
  min-height: 70px;
  max-height: 220px;
  z-index: 0;
  pointer-events: none;
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 35%, transparent);
  background: radial-gradient(
    130% 100% at 50% -10%,
    color-mix(in srgb, var(--scope-spectrum-start, #3b82f6) 8%, transparent) 0%,
    transparent 70%
  );
}
.scope-bg::before {
  content: "";
  position: absolute;
  inset: 10px;
  border-radius: 6px;
  pointer-events: none;
  background-image: repeating-linear-gradient(
    to right,
    color-mix(
        in srgb,
        var(--border, rgba(255, 255, 255, 0.06)) 30%,
        transparent
      )
      0 1px,
    transparent 1px calc(100% / 8)
  );
  opacity: 0.06;
  z-index: 0;
}
.scope-bg-canvas {
  position: absolute !important;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  display: block;
  z-index: 1;
  opacity: 0.5;
  mix-blend-mode: screen;
}
@media (prefers-color-scheme: light) {
  .scope-bg-canvas {
    mix-blend-mode: multiply;
    opacity: 0.4;
  }
}
.scope-bg::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--surface) 0%, transparent) 0%,
    color-mix(in srgb, var(--surface) 0%, transparent) 100%
  );
  z-index: 2;
}

.scope-corner {
  position: absolute;
  width: 10px;
  height: 10px;
  pointer-events: none;
  z-index: 3;
  border-color: color-mix(
    in srgb,
    var(--scope-waveform, #34d399) 70%,
    transparent
  );
}
.scope-bg .scope-corner {
  width: 12px;
  height: 12px;
  border-color: color-mix(
    in srgb,
    var(--scope-waveform, #34d399) 25%,
    transparent
  );
}
.scope-corner--tl {
  top: 8px;
  left: 8px;
  border-top: 1px solid;
  border-left: 1px solid;
}
.scope-corner--tr {
  top: 8px;
  right: 8px;
  border-top: 1px solid;
  border-right: 1px solid;
}
.scope-corner--bl {
  bottom: 8px;
  left: 8px;
  border-bottom: 1px solid;
  border-left: 1px solid;
}
.scope-corner--br {
  bottom: 8px;
  right: 8px;
  border-bottom: 1px solid;
  border-right: 1px solid;
}

/* Inactive label overlay (WebGL mode — WebGL can't draw text) */
.scope-inactive-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text-soft, #94a3b8);
  opacity: 0.55;
  pointer-events: none;
  z-index: 3;
  text-transform: lowercase;
  letter-spacing: 0.1em;
}
</style>
