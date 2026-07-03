<script setup>
import { computed } from "vue";

const { t } = useI18n();

const props = defineProps({
  isOpen: Boolean,
  closeModal: Function,
  meta: { type: Object, default: () => ({}) },
  fileName: { type: String, default: "" },
});

function close() {
  props.closeModal?.();
}

const hasMeta = computed(() => {
  const m = props.meta;
  return m && (m.title || m.type || m.tracker || (m.channels && m.channels.length) || (m.instruments && m.instruments.length));
});

const formatDuration = (sec) => {
  if (!sec || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const metaRows = computed(() => {
  const m = props.meta;
  const rows = [];
  if (m.title) rows.push({ label: t("trackInfo.title"), value: m.title });
  if (m.artist) rows.push({ label: t("trackInfo.artist"), value: m.artist });
  if (m.type) rows.push({ label: t("trackInfo.type"), value: m.type });
  if (m.tracker) rows.push({ label: t("trackInfo.tracker"), value: m.tracker });
  if (m.date) rows.push({ label: t("trackInfo.date"), value: m.date });
  if (m.dur) rows.push({ label: t("trackInfo.duration"), value: formatDuration(m.dur) });
  if (m.container) rows.push({ label: t("trackInfo.container"), value: m.container });
  if (m.numSubsongs > 1) rows.push({ label: t("trackInfo.subsongs"), value: String(m.numSubsongs) });
  return rows;
});

const hasChannels = computed(() => props.meta?.channels?.length > 0);
const hasInstruments = computed(() => props.meta?.instruments?.length > 0);
const hasSamples = computed(() => props.meta?.samples?.length > 0);
const hasOrders = computed(() => props.meta?.orders?.length > 0);
const hasSongs = computed(() => props.meta?.songs?.length > 1);

function handleBackdropClick(e) {
  if (e.target?.classList?.contains("ti-overlay")) {
    close();
  }
}
function handleKeydown(e) {
  if (e.key === "Escape") close();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ti-modal">
      <div
        v-if="isOpen"
        class="ti-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="t('trackInfo.modalTitle')"
        @click="handleBackdropClick"
        @keydown="handleKeydown"
      >
        <div class="ti-panel card">
          <header class="ti-header">
            <h2 class="ti-title">{{ t("trackInfo.modalTitle") }}</h2>
            <button
              class="ti-close btn-base"
              type="button"
              :aria-label="t('trackInfo.close')"
              @click="close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <p class="ti-filename">{{ fileName }}</p>

          <div v-if="!hasMeta" class="ti-empty">
            {{ t("trackInfo.noMeta") }}
          </div>

          <template v-else>
            <table v-if="metaRows.length" class="ti-table">
              <tbody>
                <tr v-for="row in metaRows" :key="row.label">
                  <th>{{ row.label }}</th>
                  <td>{{ row.value }}</td>
                </tr>
              </tbody>
            </table>

            <div v-if="meta.message" class="ti-section">
              <h3 class="ti-section-title">{{ t("trackInfo.message") }}</h3>
              <pre class="ti-message">{{ meta.message }}</pre>
            </div>

            <div v-if="hasChannels" class="ti-section">
              <h3 class="ti-section-title">{{ t("trackInfo.channels") }} ({{ meta.channels.length }})</h3>
              <div class="ti-tags">
                <span v-for="(ch, i) in meta.channels" :key="'ch'+i" class="ti-tag ti-tag-ch">{{ ch || `CH${i + 1}` }}</span>
              </div>
            </div>

            <div v-if="hasInstruments" class="ti-section">
              <h3 class="ti-section-title">{{ t("trackInfo.instruments") }} ({{ meta.instruments.length }})</h3>
              <div class="ti-tags">
                <span v-for="(ins, i) in meta.instruments" :key="'ins'+i" class="ti-tag ti-tag-ins">{{ ins || `INS${i + 1}` }}</span>
              </div>
            </div>

            <div v-if="hasSamples" class="ti-section">
              <h3 class="ti-section-title">{{ t("trackInfo.samples") }} ({{ meta.samples.length }})</h3>
              <div class="ti-tags">
                <span v-for="(smp, i) in meta.samples" :key="'smp'+i" class="ti-tag ti-tag-smp">{{ smp || `SMP${i + 1}` }}</span>
              </div>
            </div>

            <div v-if="hasOrders" class="ti-section">
              <h3 class="ti-section-title">{{ t("trackInfo.orders") }} ({{ meta.orders.length }})</h3>
              <div class="ti-orders">
                <div v-for="(ord, i) in meta.orders" :key="'ord'+i" class="ti-order-item">
                  <span class="ti-order-idx">{{ i }}</span>
                  <span class="ti-order-name">{{ ord.name || `Order ${i}` }}</span>
                  <span class="ti-order-pat">{{ t("trackInfo.pattern") }} {{ ord.pat }}</span>
                </div>
              </div>
            </div>

            <div v-if="hasSongs" class="ti-section">
              <h3 class="ti-section-title">{{ t("trackInfo.subsongs") }}</h3>
              <ul class="ti-list">
                <li v-for="(s, i) in meta.songs" :key="'song'+i">{{ s }}</li>
              </ul>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ti-overlay {
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

.ti-panel {
  width: 100%;
  max-width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 1.25rem;
  display: grid;
  gap: 0.85rem;
  position: relative;
}

.ti-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.ti-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text);
}

.ti-close {
  width: 30px;
  height: 30px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
}
.ti-close svg {
  width: 16px;
  height: 16px;
}

.ti-filename {
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

.ti-empty {
  color: var(--text-soft);
  font-size: 0.85rem;
  text-align: center;
  padding: 1.5rem 0;
}

.ti-table {
  width: 100%;
  border-collapse: collapse;
}
.ti-table th {
  text-align: left;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-soft);
  padding: 0.3rem 0.6rem 0.3rem 0;
  white-space: nowrap;
  vertical-align: top;
  width: 1%;
}
.ti-table td {
  font-size: 0.85rem;
  padding: 0.3rem 0;
  color: var(--text);
  word-break: break-all;
}

.ti-section {
  display: grid;
  gap: 0.4rem;
}
.ti-section-title {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.ti-message {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-soft);
  white-space: pre-wrap;
  word-break: break-word;
  background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  max-height: 180px;
  overflow-y: auto;
  font-family: inherit;
}

.ti-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.ti-tag {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.6;
}
.ti-tag-ch {
  background: color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent);
  color: var(--accent, #3b82f6);
  border: 1px solid color-mix(in srgb, var(--accent, #3b82f6) 20%, transparent);
}
.ti-tag-ins {
  background: color-mix(in srgb, var(--accent-green, #10b981) 12%, transparent);
  color: var(--accent-green, #10b981);
  border: 1px solid color-mix(in srgb, var(--accent-green, #10b981) 20%, transparent);
}
.ti-tag-smp {
  background: color-mix(in srgb, var(--accent-amber, #f59e0b) 12%, transparent);
  color: var(--accent-amber, #f59e0b);
  border: 1px solid color-mix(in srgb, var(--accent-amber, #f59e0b) 20%, transparent);
}

.ti-orders {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
  max-height: 160px;
  overflow-y: auto;
}
.ti-order-item {
  font-size: 0.68rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  color: var(--text-soft);
  display: flex;
  gap: 0.2rem;
}
.ti-order-idx {
  color: var(--text-muted);
  min-width: 1.4em;
}
.ti-order-pat {
  color: var(--text-muted);
}

.ti-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.ti-list li {
  font-size: 0.82rem;
  color: var(--text);
  padding: 0.1rem 0;
}

/* transitions – match DownloadModal */
.ti-modal-enter-active,
.ti-modal-leave-active {
  transition: opacity 0.2s ease;
}
.ti-modal-enter-from,
.ti-modal-leave-to {
  opacity: 0;
}
.ti-modal-enter-active .ti-panel,
.ti-modal-leave-active .ti-panel {
  transition: transform 0.2s ease;
}
.ti-modal-enter-from .ti-panel {
  transform: scale(0.96) translateY(6px);
}
.ti-modal-leave-to .ti-panel {
  transform: scale(0.96) translateY(6px);
}
</style>
