<script setup>
/**
 * SettingsBody — reusable settings form.
 * Used by SettingsModal and InfoDrawer.
 */
import { nextTick, ref, onMounted, onUnmounted } from "vue";

const props = defineProps({
  active: { type: Boolean, default: true },
});

const { t } = useI18n();

function readSetting(key, fallback = true) {
  try {
    const s = JSON.parse(localStorage.getItem("player_settings") || "{}");
    return key in s ? !!s[key] : fallback;
  } catch { return fallback; }
}
function readSettingNum(key, fallback = 0) {
  try {
    const s = JSON.parse(localStorage.getItem("player_settings") || "{}");
    return key in s ? Number(s[key]) : fallback;
  } catch { return fallback; }
}

function applyGeneral(key, value) {
  if (typeof window !== "undefined" && window.applyGeneralSettings) {
    window.applyGeneralSettings({ [key]: value });
  } else {
    try {
      const s = JSON.parse(localStorage.getItem("player_settings") || "{}");
      s[key] = value;
      localStorage.setItem("player_settings", JSON.stringify(s));
    } catch {}
  }
}

// ── Oscilloscope ────────────────────────────────────────────────────
const scopeHistogram = ref(readSetting("setScope", true));
const scopeTotal = ref(readSetting("setTotalScope", false));
const scopeChannels = ref(readSetting("setChannelScope", true));

function applyScopeToggles() {
  if (typeof window !== "undefined" && window.applyScopeSettings) {
    window.applyScopeSettings(scopeHistogram.value, scopeTotal.value, scopeChannels.value);
  } else {
    try {
      const s = JSON.parse(localStorage.getItem("player_settings") || "{}");
      s.setScope = scopeHistogram.value;
      s.setTotalScope = scopeTotal.value;
      s.setChannelScope = scopeChannels.value;
      localStorage.setItem("player_settings", JSON.stringify(s));
    } catch {}
    window.dispatchEvent(new CustomEvent("player:scope-settings", {
      detail: { showTotal: scopeTotal.value, showChannels: scopeChannels.value },
    }));
    const scopeEl = document.getElementById("scope");
    if (scopeEl) scopeEl.style.display = scopeHistogram.value ? "" : "none";
  }
}
function toggleScope(w) {
  if (w === "histogram") scopeHistogram.value = !scopeHistogram.value;
  if (w === "total") scopeTotal.value = !scopeTotal.value;
  if (w === "channels") scopeChannels.value = !scopeChannels.value;
  applyScopeToggles();
}

// ── Display ─────────────────────────────────────────────────────────
const showPattern = ref(readSetting("setPattern", true));
const showIntro = ref(readSetting("setIntroduce", true));
function toggleShowPattern() { showPattern.value = !showPattern.value; applyGeneral("setPattern", showPattern.value); }
function toggleShowIntro()   { showIntro.value   = !showIntro.value;   applyGeneral("setIntroduce", showIntro.value); }

// ── Playback ────────────────────────────────────────────────────────
const forceVolume   = ref(readSetting("forcedVolume", false));
const defaultVolume = ref(readSettingNum("setVolume", 40));
const maxLoop       = ref(readSettingNum("setLooptimes", 2));
const loudnessEq    = ref(readSetting("loudnessEq", false));
function toggleForceVolume() { forceVolume.value = !forceVolume.value; applyGeneral("forcedVolume", forceVolume.value); }
function toggleLoudnessEq() { loudnessEq.value = !loudnessEq.value; applyGeneral("loudnessEq", loudnessEq.value); }
function onVolumeChange() { const v = Math.max(0, Math.min(100, Number(defaultVolume.value) || 0)); defaultVolume.value = v; applyGeneral("setVolume", v); }
function onLoopChange()   { const v = Math.max(0, Math.min(100, Number(maxLoop.value) || 0)); maxLoop.value = v; applyGeneral("setLooptimes", v); }

// ── Engine ──────────────────────────────────────────────────────────
const selectedEngine = ref(readSettingNum("setEngine", 2));
function onEngineChange() { const v = Math.max(1, Math.min(3, Number(selectedEngine.value) || 2)); selectedEngine.value = v; applyGeneral("setEngine", v); }

// ── Actions ─────────────────────────────────────────────────────────
function onResetSettings() { if (window.resetSettings) window.resetSettings(); nextTick(() => syncFromStorage()); }

// ── Sync ────────────────────────────────────────────────────────────
function syncFromStorage() {
  scopeHistogram.value = readSetting("setScope", true);
  scopeTotal.value     = readSetting("setTotalScope", false);
  scopeChannels.value  = readSetting("setChannelScope", true);
  showPattern.value    = readSetting("setPattern", true);
  showIntro.value      = readSetting("setIntroduce", true);
  forceVolume.value    = readSetting("forcedVolume", false);
  defaultVolume.value  = readSettingNum("setVolume", 10);
  maxLoop.value        = readSettingNum("setLooptimes", 2);
  loudnessEq.value     = readSetting("loudnessEq", false);
  selectedEngine.value = readSettingNum("setEngine", 2);
}
const handleScopeSettingsEvent = (e) => {
  if (!e?.detail) return;
  if ("showHistogram" in e.detail) scopeHistogram.value = !!e.detail.showHistogram;
  if ("showTotal" in e.detail)     scopeTotal.value     = !!e.detail.showTotal;
  if ("showChannels" in e.detail)  scopeChannels.value  = !!e.detail.showChannels;
};
onMounted(() => {
  window.addEventListener("player:scope-settings", handleScopeSettingsEvent);
  if (props.active) syncFromStorage();
});
onUnmounted(() => {
  window.removeEventListener("player:scope-settings", handleScopeSettingsEvent);
});
</script>

<template>
  <div class="sb-root">
    <!-- Oscilloscope -->
    <section class="sb-section">
      <div class="sb-label">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1 8 Q3 3 5 8 Q7 13 9 8 Q11 3 13 8 Q14.5 11 15 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>
        Oscilloscope
      </div>
      <div class="scope-cards">
        <button type="button" class="scope-card" :class="{ 'scope-card--on': scopeHistogram }" @click="toggleScope('histogram')" :aria-pressed="scopeHistogram">
          <div class="scope-card-preview"><svg viewBox="0 0 80 40" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="hg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--scope-spectrum-start,#3b82f6)" stop-opacity="0.85"/><stop offset="100%" stop-color="var(--scope-spectrum-end,#8b5cf6)" stop-opacity="0.3"/></linearGradient></defs><rect x="1" y="14" width="5" height="26" rx="1.5" fill="url(#hg1)"/><rect x="8" y="6" width="5" height="34" rx="1.5" fill="url(#hg1)"/><rect x="15" y="10" width="5" height="30" rx="1.5" fill="url(#hg1)"/><rect x="22" y="2" width="5" height="38" rx="1.5" fill="url(#hg1)"/><rect x="29" y="8" width="5" height="32" rx="1.5" fill="url(#hg1)"/><rect x="36" y="18" width="5" height="22" rx="1.5" fill="url(#hg1)"/><rect x="43" y="12" width="5" height="28" rx="1.5" fill="url(#hg1)"/><rect x="50" y="22" width="5" height="18" rx="1.5" fill="url(#hg1)"/><rect x="57" y="26" width="5" height="14" rx="1.5" fill="url(#hg1)"/><rect x="64" y="30" width="5" height="10" rx="1.5" fill="url(#hg1)"/><rect x="71" y="33" width="5" height="7" rx="1.5" fill="url(#hg1)"/></svg></div>
          <div class="scope-card-meta"><svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><rect x="0.5" y="6" width="3" height="7" rx="0.75" fill="currentColor" opacity="0.7"/><rect x="5" y="3" width="3" height="10" rx="0.75" fill="currentColor"/><rect x="9.5" y="8" width="3" height="5" rx="0.75" fill="currentColor" opacity="0.6"/></svg><span class="scope-card-name">Spectrum</span><span class="scope-card-dot" :class="scopeHistogram ? 'on' : 'off'"/></div>
        </button>
        <button type="button" class="scope-card" :class="{ 'scope-card--on': scopeTotal }" @click="toggleScope('total')" :aria-pressed="scopeTotal">
          <div class="scope-card-preview"><svg viewBox="0 0 80 40" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="wg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--scope-waveform,#34d399)" stop-opacity="0.55"/><stop offset="50%" stop-color="var(--scope-waveform,#34d399)" stop-opacity="0.06"/><stop offset="100%" stop-color="var(--scope-waveform,#34d399)" stop-opacity="0.55"/></linearGradient></defs><line x1="0" y1="20" x2="80" y2="20" stroke="rgba(255,255,255,0.08)" stroke-width="1"/><path d="M0,20 Q5,9 10,15 Q15,21 20,11 Q25,1 30,12 Q35,23 40,10 Q45,0 50,13 Q55,26 60,16 Q65,6 70,18 Q75,28 80,20 L80,20 Q75,32 70,22 Q65,14 60,24 Q55,34 50,27 Q45,20 40,30 Q35,37 30,28 Q25,19 20,29 Q15,39 10,25 Q5,31 0,20Z" fill="url(#wg1)"/><path d="M0,20 Q5,9 10,15 Q15,21 20,11 Q25,1 30,12 Q35,23 40,10 Q45,0 50,13 Q55,26 60,16 Q65,6 70,18 Q75,28 80,20" stroke="var(--scope-waveform,#34d399)" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg></div>
          <div class="scope-card-meta"><svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M0,6.5 Q2,2 4,6.5 Q6,11 8,6.5 Q10,2 13,6.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg><span class="scope-card-name">CH SUM</span><span class="scope-card-dot" :class="scopeTotal ? 'on' : 'off'"/></div>
        </button>
        <button type="button" class="scope-card" :class="{ 'scope-card--on': scopeChannels }" @click="toggleScope('channels')" :aria-pressed="scopeChannels">
          <div class="scope-card-preview"><svg viewBox="0 0 80 40" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="0" width="24" height="18" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/><path d="M2,9 Q5,4 8,9 Q11,14 14,9 Q18,4 22,9" stroke="var(--scope-waveform,#34d399)" stroke-width="1" fill="none" opacity="0.8"/><rect x="28" y="0" width="24" height="18" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/><path d="M30,9 Q33,6 36,9 Q39,12 42,9 Q45,6 50,9" stroke="var(--scope-waveform,#34d399)" stroke-width="1" fill="none" opacity="0.6"/><rect x="56" y="0" width="24" height="18" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/><path d="M58,9 Q61,5 64,9 Q67,13 70,9 Q73,5 78,8" stroke="var(--scope-waveform,#34d399)" stroke-width="1" fill="none" opacity="0.9"/><rect x="0" y="22" width="24" height="18" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/><path d="M2,31 Q6,27 10,31 Q14,35 18,31 Q21,28 22,31" stroke="var(--scope-waveform,#34d399)" stroke-width="1" fill="none" opacity="0.5"/><rect x="28" y="22" width="24" height="18" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/><path d="M30,31 Q34,28 38,31 Q42,34 46,31 Q49,29 50,31" stroke="var(--scope-waveform,#34d399)" stroke-width="1" fill="none" opacity="0.75"/><rect x="56" y="22" width="24" height="18" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/><path d="M58,31 Q62,26 66,31 Q70,36 74,31 Q77,28 78,30" stroke="var(--scope-waveform,#34d399)" stroke-width="1" fill="none" opacity="0.65"/></svg></div>
          <div class="scope-card-meta"><svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><rect x="0" y="0" width="5.5" height="5.5" rx="1" fill="currentColor" opacity="0.7"/><rect x="7.5" y="0" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="0" y="7.5" width="5.5" height="5.5" rx="1" fill="currentColor" opacity="0.5"/><rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" fill="currentColor" opacity="0.85"/></svg><span class="scope-card-name">Channels</span><span class="scope-card-dot" :class="scopeChannels ? 'on' : 'off'"/></div>
        </button>
      </div>
    </section>

    <!-- Display -->
    <section class="sb-section">
      <div class="sb-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Display</div>
      <div class="sb-rows">
        <div class="sb-row"><span class="sb-row-label">{{ t("settings.table.showPattern") }}</span><button type="button" class="sb-toggle" :class="{ 'sb-toggle--on': showPattern }" @click="toggleShowPattern" :aria-checked="showPattern" role="switch"><span class="sb-toggle-thumb"/></button></div>
        <div class="sb-row"><span class="sb-row-label">{{ t("settings.table.showIntro") }}</span><button type="button" class="sb-toggle" :class="{ 'sb-toggle--on': showIntro }" @click="toggleShowIntro" :aria-checked="showIntro" role="switch"><span class="sb-toggle-thumb"/></button></div>
      </div>
    </section>

    <!-- Playback -->
    <section class="sb-section">
      <div class="sb-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M10 8l6 4-6 4V8z" fill="currentColor"/></svg> Playback</div>
      <div class="sb-rows">
        <div class="sb-row"><span class="sb-row-label">{{ t("settings.table.forceVolume") }}</span><button type="button" class="sb-toggle" :class="{ 'sb-toggle--on': forceVolume }" @click="toggleForceVolume" :aria-checked="forceVolume" role="switch"><span class="sb-toggle-thumb"/></button></div>
        <div class="sb-row"><span class="sb-row-label">{{ t("settings.table.defaultVolume") }}</span><input type="number" class="sb-num" v-model.number="defaultVolume" min="0" max="100" @change="onVolumeChange"/></div>
        <div class="sb-row"><span class="sb-row-label">{{ t("settings.table.maxLoop") }}</span><input type="number" class="sb-num" v-model.number="maxLoop" min="0" max="100" @change="onLoopChange"/></div>
        <div class="sb-row"><span class="sb-row-label">{{ t("settings.table.loudnessEq") }}</span><button type="button" class="sb-toggle" :class="{ 'sb-toggle--on': loudnessEq }" @click="toggleLoudnessEq" :aria-checked="loudnessEq" role="switch"><span class="sb-toggle-thumb"/></button></div>
      </div>
    </section>

    <!-- Engine -->
    <section class="sb-section">
      <div class="sb-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> {{ t("settings.engine") }}</div>
      <p class="sb-hint">{{ t("settings.engineDesc") }}</p>
      <div class="engine-cards">
        <button type="button" class="engine-card" :class="{ 'engine-card--on': selectedEngine === 1 }" @click="selectedEngine = 1; onEngineChange()" :aria-pressed="selectedEngine === 1"><div class="engine-card-meta"><span class="engine-card-name">{{ t("settings.engines.bassoon") }}</span><span class="engine-card-badge">1</span></div><span class="engine-card-desc">{{ t("settings.engines.bassoonDesc") }}</span><span class="engine-card-dot" :class="selectedEngine === 1 ? 'on' : 'off'"/></button>
        <button type="button" class="engine-card" :class="{ 'engine-card--on': selectedEngine === 2 }" @click="selectedEngine = 2; onEngineChange()" :aria-pressed="selectedEngine === 2"><div class="engine-card-meta"><span class="engine-card-name">{{ t("settings.engines.chiptune3") }}</span><span class="engine-card-badge engine-card-badge--rec">★ {{ t("settings.engines.chiptune3Badge") }}</span></div><span class="engine-card-desc">{{ t("settings.engines.chiptune3Desc") }}</span><span class="engine-card-dot" :class="selectedEngine === 2 ? 'on' : 'off'"/></button>
        <button type="button" class="engine-card" :class="{ 'engine-card--on': selectedEngine === 3 }" @click="selectedEngine = 3; onEngineChange()" :aria-pressed="selectedEngine === 3"><div class="engine-card-meta"><span class="engine-card-name">{{ t("settings.engines.ffmpeg") }}</span><span class="engine-card-badge">3</span></div><span class="engine-card-desc">{{ t("settings.engines.ffmpegDesc") }}</span><span class="engine-card-dot" :class="selectedEngine === 3 ? 'on' : 'off'"/></button>
      </div>
    </section>

    <!-- Actions -->
    <section class="sb-section">
      <div class="sb-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Actions</div>
      <div class="flex flex-col gap-2">
        <button class="btn-base btn-ghost justify-start" type="button" @click="onResetSettings"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="flex-shrink-0"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> {{ t("settings.actions.restoreDefaults") }}</button>
        <button class="btn-base btn-ghost justify-start" type="button" onclick="clearHistory()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="flex-shrink-0"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> {{ t("settings.actions.clearHistory") }}</button>
        <button class="btn-base btn-ghost justify-start" type="button" onclick="clearCachedPlaylist()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="flex-shrink-0"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="20" cy="17" r="3" fill="currentColor" opacity="0.3"/><path d="M19 16l2 2M21 16l-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> {{ t("settings.actions.clearCache") }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sb-root { display: flex; flex-direction: column; gap: 22px; }
.sb-section { display: flex; flex-direction: column; gap: 10px; }
.sb-label { display: flex; align-items: center; gap: 6px; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-soft); }
.sb-hint { margin: 0; font-size: 0.72rem; color: var(--text-soft); line-height: 1.5; }

.sb-rows { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: color-mix(in srgb, var(--surface-2) 60%, transparent); }
.sb-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 14px; border-bottom: 1px solid var(--border); }
.sb-row:last-child { border-bottom: none; }
.sb-row-label { font-size: 0.82rem; font-weight: 500; color: var(--text); }

.sb-toggle { position: relative; width: 38px; height: 22px; border-radius: 11px; background: color-mix(in srgb, var(--text-soft) 30%, var(--border)); border: none; cursor: pointer; flex-shrink: 0; transition: background 160ms; padding: 0; }
.sb-toggle--on { background: var(--accent, #3b82f6); }
.sb-toggle-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.25); transition: transform 160ms cubic-bezier(0.34,1.56,0.64,1); }
.sb-toggle--on .sb-toggle-thumb { transform: translateX(16px); }

.sb-num { width: 68px; padding: 5px 8px; border-radius: 7px; border: 1px solid var(--border); background: var(--surface-3, var(--surface-2)); color: var(--text); font-size: 0.82rem; text-align: right; outline: none; transition: border-color 150ms; font-family: ui-monospace,"Fira Code",SFMono-Regular,monospace; }
.sb-num:focus { border-color: var(--accent, #3b82f6); }
.sb-num::-webkit-inner-spin-button, .sb-num::-webkit-outer-spin-button { opacity: 0.4; }

/* ── Mobile ──────────────────────────────────────────────────────── */
@media (max-width: 480px) {
  .sb-root { gap: 18px; }
  .scope-cards { grid-template-columns: 1fr; gap: 6px; }
  .scope-card-meta { font-size: 0.72rem; padding: 7px 10px; }
  .sb-row { padding: 10px 12px; gap: 8px; }
  .sb-row-label { font-size: 0.78rem; }
  .engine-card { padding: 8px 12px; }
  .engine-card-name { font-size: 0.78rem; }
  .engine-card-desc { font-size: 0.65rem; }
}

/* Scope cards */
.scope-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.scope-card { position: relative; display: flex; flex-direction: column; gap: 0; border: 1.5px solid var(--border); border-radius: 10px; overflow: hidden; background: color-mix(in srgb, var(--surface-2) 80%, transparent); cursor: pointer; transition: border-color 160ms, box-shadow 160ms, transform 100ms; text-align: left; }
.scope-card:hover { border-color: color-mix(in srgb, var(--scope-waveform, #34d399) 55%, var(--border)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--scope-waveform, #34d399) 20%, transparent), 0 6px 18px -6px color-mix(in srgb, var(--scope-waveform, #34d399) 25%, transparent); transform: translateY(-1px); }
.scope-card--on { border-color: color-mix(in srgb, var(--scope-waveform, #34d399) 65%, transparent); background: color-mix(in srgb, var(--scope-waveform, #34d399) 6%, var(--surface-2)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--scope-waveform, #34d399) 18%, transparent), inset 0 1px 0 color-mix(in srgb, white 8%, transparent); }
.scope-card-preview { width: 100%; padding: 8px 8px 5px; line-height: 0; background: color-mix(in srgb, var(--surface-3, #111827) 60%, transparent); border-bottom: 1px solid var(--border); }
.scope-card-preview svg { width: 100%; height: 34px; display: block; }
.scope-card-meta { display: flex; align-items: center; gap: 5px; padding: 6px 8px; color: var(--text-soft); font-size: 0.68rem; font-weight: 600; letter-spacing: 0.05em; }
.scope-card-name { flex: 1; font-family: ui-monospace,"Fira Code",SFMono-Regular,monospace; }
.scope-card-dot { width: 6px; height: 6px; border-radius: 999px; flex-shrink: 0; transition: background 160ms, box-shadow 160ms; }
.scope-card-dot.on { background: var(--scope-waveform, #34d399); box-shadow: 0 0 5px var(--scope-waveform, #34d399); }
.scope-card-dot.off { background: color-mix(in srgb, var(--text-soft) 30%, transparent); }

/* Engine cards */
.engine-cards { display: flex; flex-direction: column; gap: 6px; }
.engine-card { position: relative; display: flex; flex-direction: column; gap: 2px; border: 1.5px solid var(--border); border-radius: 10px; overflow: hidden; background: color-mix(in srgb, var(--surface-2) 60%, transparent); cursor: pointer; transition: border-color 160ms, box-shadow 160ms, transform 100ms; text-align: left; padding: 10px 14px; }
.engine-card:hover { border-color: color-mix(in srgb, var(--accent, #3b82f6) 55%, var(--border)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #3b82f6) 20%, transparent), 0 4px 12px -4px color-mix(in srgb, var(--accent, #3b82f6) 18%, transparent); transform: translateY(-1px); }
.engine-card--on { border-color: color-mix(in srgb, var(--accent, #3b82f6) 65%, transparent); background: color-mix(in srgb, var(--accent, #3b82f6) 6%, var(--surface-2)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #3b82f6) 18%, transparent), inset 0 1px 0 color-mix(in srgb, white 8%, transparent); }
.engine-card-meta { display: flex; align-items: center; gap: 6px; }
.engine-card-name { font-size: 0.82rem; font-weight: 600; color: var(--text); font-family: ui-monospace,"Fira Code",SFMono-Regular,monospace; }
.engine-card-badge { font-size: 0.62rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: var(--surface-3); color: var(--text-soft); letter-spacing: 0.04em; }
.engine-card-badge--rec { background: color-mix(in srgb, var(--accent, #3b82f6) 18%, transparent); color: var(--accent, #3b82f6); }
.engine-card-desc { font-size: 0.68rem; color: var(--text-soft); padding-right: 12px; }
.engine-card-dot { position: absolute; top: 12px; right: 12px; width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; transition: background 160ms, box-shadow 160ms; }
.engine-card-dot.on { background: var(--accent, #3b82f6); box-shadow: 0 0 6px var(--accent, #3b82f6); }
.engine-card-dot.off { background: color-mix(in srgb, var(--text-soft) 25%, transparent); }
</style>
