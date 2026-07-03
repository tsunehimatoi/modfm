<script setup>
import { ref, computed } from "vue";

const props = defineProps({
  isOpen: Boolean,
  closeModal: Function,
  fileName: { type: String, default: "" },
  fileUrl: { type: String, default: "" },
  downloadUrl: { type: String, default: "" },
});

const { t } = useI18n();

const isConverting = ref(false);
const convertError = ref("");

const sourceUrl = computed(() => props.downloadUrl || props.fileUrl);

const fileExt = computed(() => {
  const name = props.fileName || "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
});

const canConvertToMp3 = computed(() =>
  ["xm", "mod", "it", "s3m", "umx", "mptm", "stm", "mtm", "ptm", "far", "ult", "669", "amf", "dsm", "mdl", "med", "okt", "psm", "dbm", "imf", "j2b", "mo3", "gdm", "stp", "sfx", "sfx2", "itp", "dtm", "mt2", "symmod", "c67", "ams", "stx", "667", "cba", "digi", "dmf", "dsym", "etx", "fc", "fc13", "fc14", "fmt", "ftm", "gmc", "gt2", "gtk", "ice", "ims", "m15", "mms", "mus", "oxm", "plm", "pt36", "puma", "rtm", "smod", "st26", "stk", "wow", "xmf", "mdz", "s3z", "xmz", "itz", "mptmz", "mdr"].includes(fileExt.value)
);

const sourceLabel = computed(() => {
  const ext = fileExt.value.toUpperCase();
  return ext ? t("download.sourceFile", { ext }) : t("download.sourceFileGeneric");
});

// Build the server-relative path from the music API URL
const musicApiPath = computed(() => {
  if (!sourceUrl.value) return "";
  try {
    const url = new URL(sourceUrl.value, window.location.origin);
    // e.g. /api/music/somedir/file.xm -> extract path after /api/music/
    const prefix = "/api/music/";
    if (url.pathname.startsWith(prefix)) {
      return url.pathname.slice(prefix.length);
    }
  } catch {}
  return "";
});

const mp3ConvertUrl = computed(() => {
  if (!musicApiPath.value) return "";
  return `/api/music/convert-mp3?path=${encodeURIComponent(musicApiPath.value)}`;
});

const handleDownloadSource = () => {
  if (!sourceUrl.value) return;
  const a = document.createElement("a");
  a.href = sourceUrl.value;
  a.download = props.fileName || "track";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  props.closeModal?.();
};

const handleDownloadMp3 = async () => {
  if (!mp3ConvertUrl.value) return;
  convertError.value = "";
  isConverting.value = true;

  try {
    const res = await fetch(mp3ConvertUrl.value);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = props.fileName.replace(/\.[^.]+$/, "");
    a.href = url;
    a.download = `${baseName}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    props.closeModal?.();
  } catch (err) {
    convertError.value = t("download.convertError");
  } finally {
    isConverting.value = false;
  }
};

const handleBackdropClick = (e) => {
  if (e.target === e.currentTarget) props.closeModal?.();
};

const handleKeydown = (e) => {
  if (e.key === "Escape") props.closeModal?.();
};
</script>

<template>
  <Teleport to="body">
    <Transition name="dl-modal">
      <div
        v-if="isOpen"
        class="dl-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="t('download.modalTitle')"
        @click="handleBackdropClick"
        @keydown="handleKeydown"
      >
        <div class="dl-panel card">
          <header class="dl-header">
            <h2 class="dl-title">{{ t("download.modalTitle") }}</h2>
            <button
              class="dl-close btn-base"
              type="button"
              :aria-label="t('download.close')"
              @click="closeModal?.()"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <p class="dl-filename">{{ fileName }}</p>

          <div class="dl-options">
            <!-- Source file -->
            <button
              class="dl-option btn-base"
              type="button"
              :disabled="!sourceUrl"
              @click="handleDownloadSource"
            >
              <span class="dl-option-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 12v6" />
                  <path d="m9 15 3 3 3-3" />
                </svg>
              </span>
              <span class="dl-option-body">
                <span class="dl-option-label">{{ sourceLabel }}</span>
                <span class="dl-option-desc">{{ t("download.sourceDesc") }}</span>
              </span>
            </button>

            <!-- MP3 (only for convertible formats) -->
            <button
              v-if="canConvertToMp3"
              class="dl-option dl-option-mp3 btn-base"
              type="button"
              :disabled="isConverting || !mp3ConvertUrl"
              @click="handleDownloadMp3"
            >
              <span class="dl-option-icon">
                <span v-if="isConverting" class="dl-spinner" aria-hidden="true"></span>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M10 8l6 4-6 4V8z" />
                </svg>
              </span>
              <span class="dl-option-body">
                <span class="dl-option-label">{{ isConverting ? t("download.converting") : t("download.mp3Label") }}</span>
                <span class="dl-option-desc">{{ t("download.mp3Desc") }}</span>
              </span>
            </button>
          </div>

          <p v-if="convertError" class="dl-error" role="alert">{{ convertError }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dl-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.dl-panel {
  width: 100%;
  max-width: 380px;
  padding: 1.25rem;
  display: grid;
  gap: 1rem;
  position: relative;
}

.dl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.dl-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text);
}

.dl-close {
  width: 30px;
  height: 30px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
}

.dl-close svg {
  width: 16px;
  height: 16px;
}

.dl-filename {
  margin: 0;
  font-size: 0.78rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0.35rem 0.6rem;
  background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.dl-options {
  display: grid;
  gap: 0.55rem;
}

.dl-option {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.85rem;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;
  width: 100%;
}

.dl-option:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  transform: translateY(-1px);
  box-shadow: 0 8px 20px -12px rgba(15, 23, 42, 0.25);
}

.dl-option:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.dl-option-mp3 {
  border-color: rgba(37, 99, 235, 0.3);
  background: rgba(37, 99, 235, 0.04);
}

.dl-option-mp3:hover:not(:disabled) {
  border-color: rgba(37, 99, 235, 0.55);
  background: rgba(37, 99, 235, 0.09);
}

.dl-option-icon {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--surface-2) 80%, transparent);
  flex-shrink: 0;
}

.dl-option-icon svg {
  width: 18px;
  height: 18px;
  color: var(--text-soft);
}

.dl-option-mp3 .dl-option-icon {
  background: rgba(37, 99, 235, 0.1);
}

.dl-option-mp3 .dl-option-icon svg {
  color: var(--accent-strong, #2563eb);
}

.dl-option-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.dl-option-label {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--text);
}

.dl-option-desc {
  font-size: 0.72rem;
  color: var(--text-soft);
}

.dl-spinner {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 2px solid var(--accent);
  border-top-color: transparent;
  animation: dlSpin 0.7s linear infinite;
}

.dl-error {
  margin: 0;
  font-size: 0.78rem;
  color: var(--danger, #dc2626);
  padding: 0.45rem 0.7rem;
  border-radius: 8px;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.25);
}

/* Transition */
.dl-modal-enter-active,
.dl-modal-leave-active {
  transition: opacity 0.2s ease;
}
.dl-modal-enter-from,
.dl-modal-leave-to {
  opacity: 0;
}
.dl-modal-enter-active .dl-panel,
.dl-modal-leave-active .dl-panel {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.dl-modal-enter-from .dl-panel,
.dl-modal-leave-to .dl-panel {
  transform: translateY(10px) scale(0.97);
  opacity: 0;
}

@keyframes dlSpin {
  to { transform: rotate(360deg); }
}
</style>
