<script setup>
import { ref, computed, onMounted } from "vue";

const { t } = useI18n();

// ─── 预设定义 ───
const CHIPTUNE3_ALL_EXTS = [
  "xm", "mod", "it", "s3m", "umx", "mptm", "stm", "mtm", "ptm", "far", "ult",
  "669", "amf", "dsm", "mdl", "med", "okt", "psm", "dbm", "imf", "j2b", "mo3",
  "gdm", "stp", "sfx", "sfx2", "itp", "dtm", "mt2", "symmod", "c67", "ams", "stx",
  "667", "cba", "digi", "dmf", "dsym", "etx", "fc", "fc13", "fc14", "fmt", "ftm",
  "gmc", "gt2", "gtk", "ice", "ims", "m15", "mms", "mus", "oxm", "plm", "pt36",
  "puma", "rtm", "smod", "st26", "stk", "wow", "xmf",
  "mdz", "s3z", "xmz", "itz", "mptmz", "mdr",
];

// 引擎标签: bc=Bassoon+Chiptune3, c=Chiptune3, n=Native, f=FFmpeg
const ENGINE_TAG_MAP = {
  xm: "bc", mod: "bc",
  it: "c", s3m: "c", umx: "c", mptm: "c", stm: "c", mtm: "c", ptm: "c",
  far: "c", ult: "c", "669": "c", amf: "c", dsm: "c", mdl: "c", med: "c",
  okt: "c", psm: "c", dbm: "c", imf: "c", j2b: "c", mo3: "c", gdm: "c",
  stp: "c", sfx: "c", sfx2: "c", itp: "c", dtm: "c", mt2: "c", symmod: "c",
  c67: "c", ams: "c", stx: "c", "667": "c", cba: "c", digi: "c", dmf: "c",
  dsym: "c", etx: "c", fc: "c", fc13: "c", fc14: "c", fmt: "c", ftm: "c",
  gmc: "c", gt2: "c", gtk: "c", ice: "c", ims: "c", m15: "c", mms: "c",
  mus: "c", oxm: "c", plm: "c", pt36: "c", puma: "c", rtm: "c", smod: "c",
  st26: "c", stk: "c", wow: "c", xmf: "c", mdz: "c", s3z: "c", xmz: "c",
  itz: "c", mptmz: "c", mdr: "c",
  mp3: "n", ogg: "n", wav: "n", flac: "n",
};

const ENGINE_LABELS = { bc: "B,C", c: "C", n: "N", f: "F" };

// ─── 预设 ───
const PRESETS = {
  bassoon: { label: () => t("playlist.formatPresetBassoon"), exts: ["xm", "mod"] },
  major: { label: () => t("playlist.formatPresetMajor"), exts: ["xm", "mod", "it", "s3m", "mptm"] },
  chiptune3: { label: () => t("playlist.formatPresetChiptune3"), exts: CHIPTUNE3_ALL_EXTS },
  all: { label: () => t("playlist.formatPresetAll"), exts: null },
};

// ─── 状态 ───
const isOpen = ref(false);
const selected = ref(new Set(CHIPTUNE3_ALL_EXTS));
const activePreset = ref("chiptune3");
const rawCounts = ref([]);
const container = ref(null);
const panelRef = ref(null);

// API 结果 + 硬编码 C3 列表合并（补零），确保网格稳定完整
const mergedFormats = computed(() => {
  const map = new Map();
  // 先放 API 数据
  for (const f of rawCounts.value) {
    const engine = f.engine || ENGINE_TAG_MAP[f.extension];
    if (engine) map.set(f.extension, { ...f, engine });
  }
  // 补充 C3 列表中 API 没有的（count=0）
  for (const ext of CHIPTUNE3_ALL_EXTS) {
    if (!map.has(ext)) {
      map.set(ext, { extension: ext, count: 0, engine: ENGINE_TAG_MAP[ext] || "c" });
    }
  }
  return [...map.values()];
});

// 按引擎支持顺序排列：B,C → C → N → F，同组按数量降序
const ENGINE_ORDER = { bc: 0, c: 1, n: 2, f: 3 };
const sortedFormats = computed(() => {
  return [...mergedFormats.value].sort((a, b) => {
    const oa = ENGINE_ORDER[a.engine] ?? 4;
    const ob = ENGINE_ORDER[b.engine] ?? 4;
    if (oa !== ob) return oa - ob;
    return b.count - a.count;
  });
});

async function fetchCounts() {
  try {
    rawCounts.value = await $fetch("/api/songs/formats");
  } catch (e) {
    console.error("format counts fetch failed", e);
  }
}
onMounted(async () => {
  await fetchCounts();
  // 确保初始化时 68 种 C3 格式已写入隐藏 input，player-app.ts 读取前生效
  await nextTick();
  emitChange();
});

// ─── 操作 ───
function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  activePreset.value = key;
  if (preset.exts === null) {
    selected.value = new Set(mergedFormats.value.map(f => f.extension));
  } else {
    selected.value = new Set(preset.exts);
  }
  emitChange();
}

function toggleFormat(ext) {
  const next = new Set(selected.value);
  next.has(ext) ? next.delete(ext) : next.add(ext);
  selected.value = next;
  // 匹配预设
  const selArr = [...next].sort().join(",");
  let matched = null;
  for (const [key, p] of Object.entries(PRESETS)) {
    if (p.exts !== null) {
      if ([...p.exts].sort().join(",") === selArr) { matched = key; break; }
    }
  }
  activePreset.value = matched;
  emitChange();
}

function selectAll() {
  selected.value = new Set(mergedFormats.value.map(f => f.extension));
  activePreset.value = null;
  emitChange();
}
function clearAll() {
  selected.value = new Set();
  activePreset.value = null;
  emitChange();
}

function emitChange() {
  const input = document.getElementById("extensionsInput");
  if (input) {
    input.value = [...selected.value].join(",");
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

// ─── 面板定位 ───
const panelStyle = ref({ top: "0px", left: "0px" });
function updatePosition() {
  if (container.value) {
    const r = container.value.getBoundingClientRect();
    panelStyle.value = {
      top: `${r.bottom + 6}px`,
      left: `${Math.min(r.left, window.innerWidth - 400)}px`,
    };
  }
}

// ─── 打开/关闭 ───
function onToggle() {
  if (isOpen.value) {
    closePanel();
  } else {
    openPanel();
  }
}
function openPanel() {
  updatePosition();
  if (!rawCounts.value.length) fetchCounts();
  isOpen.value = true;
  // 延迟绑定 document click，避免触发按钮的 click 立即关闭
  setTimeout(() => document.addEventListener("click", onDocClick), 0);
}
function closePanel() {
  isOpen.value = false;
  document.removeEventListener("click", onDocClick);
}
function onDocClick(e) {
  // 点击容器内（触发按钮）或面板内 → 不关闭
  const inContainer = container.value?.contains(e.target);
  const inPanel = panelRef.value?.contains(e.target);
  if (!inContainer && !inPanel) {
    closePanel();
  }
}

defineExpose({
  resetToDefault() {
    activePreset.value = 'chiptune3';
    selected.value = new Set(CHIPTUNE3_ALL_EXTS);
    // Don't call emitChange() here — parent will batch and dispatch once
  },
});

const selectedCount = computed(() => selected.value.size);
const hasActiveFilter = computed(() => {
  const def = [...CHIPTUNE3_ALL_EXTS].sort().join(",");
  return [...selected.value].sort().join(",") !== def;
});

// 触发按钮标签：匹配预设则显示预设名，否则显示"筛选 + N"
const triggerLabel = computed(() => {
  if (activePreset.value && PRESETS[activePreset.value]) {
    return PRESETS[activePreset.value].label();
  }
  return `${t("playlist.formatFilterLabel")} · ${selectedCount.value}`;
});
</script>

<template>
  <div ref="container" class="relative">
    <button
      type="button"
      class="ff-trigger"
      :class="{ 'ff-trigger--active': hasActiveFilter }"
      @click.stop="onToggle"
    >
      <span class="ff-trigger-label">{{ triggerLabel }}</span>
      <svg class="ff-trigger-chev" :class="{ 'rotate-180': isOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </button>

    <input id="extensionsInput" type="hidden" :value="[...selected].join(',')" />

    <Teleport to="body">
      <Transition name="ffpanel">
        <div
          v-if="isOpen"
          ref="panelRef"
          class="ff-panel"
          :style="{ top: panelStyle.top, left: panelStyle.left, minWidth: '380px' }"
        >
          <div class="ff-presets">
            <button
              v-for="(p, k) in PRESETS" :key="k"
              class="ff-preset"
              :class="{ 'ff-preset--on': activePreset === k }"
              @click="applyPreset(k)"
            >{{ p.label() }}</button>
          </div>

          <div class="ff-actions">
            <span class="ff-actions-label">{{ t("playlist.formatFilterSelected", { n: selectedCount }) }}</span>
            <button class="ff-act" @click="selectAll">{{ t("playlist.formatFilterSelectAll") }}</button>
            <button class="ff-act" @click="clearAll">{{ t("playlist.formatFilterClear") }}</button>
          </div>

          <div class="ff-grid">
            <button
              v-for="fmt in sortedFormats" :key="fmt.extension"
              class="ff-chip"
              :class="{ 'ff-chip--on': selected.has(fmt.extension) }"
              @click="toggleFormat(fmt.extension)"
            >
              <span class="ff-chip-dot" :data-engine="fmt.engine" />
              <span class="ff-chip-ext">{{ fmt.extension.toUpperCase() }}</span>
              <span class="ff-chip-tag" :data-engine="fmt.engine">{{ ENGINE_LABELS[fmt.engine] || "F" }}</span>
              <span class="ff-chip-n">{{ fmt.count.toLocaleString() }}</span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── Trigger ── */
.ff-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  height: 2.5rem; /* h-10 */
  padding: 0 0.75rem; /* px-3 */
  border-radius: 0.5rem; /* rounded-lg */
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 0.875rem; /* text-sm */
  font-weight: 600;
  line-height: 1.25rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  user-select: none;
}
.ff-trigger:hover { border-color: var(--color-border-strong, var(--color-border)); background: var(--color-surface-hover, var(--color-surface)); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.ff-trigger--active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.ff-trigger-label { font-size: 0.875rem; overflow: hidden; text-overflow: ellipsis; }
.ff-trigger-chev { width: 0.875rem; height: 0.875rem; color: var(--color-text-soft, var(--color-text-muted)); transition: transform 0.2s; flex-shrink: 0; }

/* ── Panel ── */
.ff-panel {
  position: fixed; z-index: 10000; padding: 12px; border-radius: 14px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-glass, var(--color-surface));
  backdrop-filter: blur(20px);
  box-shadow: 0 16px 48px rgba(0,0,0,.45);
  max-height: 480px; display: flex; flex-direction: column; gap: 10px;
}

/* ── Presets ── */
.ff-presets { display: flex; flex-wrap: wrap; gap: 5px; }
.ff-preset {
  padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--color-border);
  background: transparent; color: var(--color-text-muted);
  font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.ff-preset:hover { border-color: var(--color-text-muted); color: var(--color-text); }
.ff-preset--on {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  color: var(--color-accent);
}

/* ── Actions ── */
.ff-actions {
  display: flex; align-items: center; gap: 6px;
  padding-bottom: 4px; border-bottom: 1px solid var(--color-border);
}
.ff-actions-label {
  flex: 1; font-size: 0.68rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted);
}
.ff-act {
  padding: 2px 8px; border-radius: 6px; border: 1px solid var(--color-border);
  background: transparent; color: var(--color-text-muted); font-size: 0.65rem;
  font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.ff-act:hover { border-color: var(--color-text-muted); color: var(--color-text); }

/* ── Grid ── */
.ff-grid {
  display: flex; flex-wrap: wrap; gap: 4px; overflow-y: auto;
  align-content: flex-start; max-height: 320px; padding-right: 2px;
}
.ff-grid::-webkit-scrollbar { width: 5px; }
.ff-grid::-webkit-scrollbar-track { background: transparent; }
.ff-grid::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 999px; }

/* ── Chip ── */
.ff-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px;
  border-radius: 7px; border: 1px solid transparent;
  background: transparent; cursor: pointer; transition: all 0.12s;
  font-size: 0.67rem; white-space: nowrap; color: var(--color-text-muted);
  opacity: 0.45;
}
.ff-chip:hover {
  border-color: var(--color-border);
  opacity: 0.7;
}
.ff-chip--on {
  border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  color: var(--color-text);
  opacity: 1;
  box-shadow: 0 0 6px color-mix(in srgb, var(--color-accent) 15%, transparent);
}

/* engine dot */
.ff-chip-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; transition: transform 0.12s; }
.ff-chip--on .ff-chip-dot { transform: scale(1.2); }
.ff-chip-dot[data-engine="bc"] { background: #f59e0b; }
.ff-chip-dot[data-engine="c"]  { background: #60a5fa; }
.ff-chip-dot[data-engine="n"]  { background: #34d399; }
.ff-chip-dot[data-engine="f"]  { background: #a78bfa; }

.ff-chip-ext { font-weight: 700; letter-spacing: 0.02em; }

/* engine tag badge */
.ff-chip-tag { font-size: 0.55rem; font-weight: 700; padding: 0 3px; border-radius: 3px; }
.ff-chip-tag[data-engine="bc"] { background: rgba(245,158,11,.18); color: #f59e0b; }
.ff-chip-tag[data-engine="c"]  { background: rgba(96,165,250,.18); color: #60a5fa; }
.ff-chip-tag[data-engine="n"]  { background: rgba(52,211,153,.18); color: #34d399; }
.ff-chip-tag[data-engine="f"]  { background: rgba(167,139,250,.18); color: #a78bfa; }

.ff-chip-n { color: var(--color-text-muted); font-size: 0.6rem; min-width: 28px; text-align: right; opacity: 0.6; }

/* ── Transition ── */
.ffpanel-enter-active { transition: all 0.15s ease-out; }
.ffpanel-leave-active { transition: all 0.1s ease-in; }
.ffpanel-enter-from, .ffpanel-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
</style>
