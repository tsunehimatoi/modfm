<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import BaseSelect from "./BaseSelect.vue";
import FormatFilterPanel from "./FormatFilterPanel.vue";

defineEmits(["open-settings"]);

const { t } = useI18n();
const itemsPerPage = 50;

const source = ref("0");
const sort = ref("0");
const channels = ref("all");
const size = ref("all");
const isPlaylistLoading = ref(false);
const playlistMode = ref(0);

const playlistRef = ref(null);

let leftObserver;
let mediaQuery;

const syncHeight = () => {
  if (!playlistRef.value) return;
  if (!mediaQuery || !mediaQuery.matches) {
    // 在移动端，设置最大高度为视口高度的 80%，确保有滚动
    const vh = window.innerHeight;
    playlistRef.value.style.maxHeight = `${Math.round(vh * 0.8)}px`;
    playlistRef.value.style.height = "";
    return;
  }
  const leftColumn = document.getElementById("cleftPart");
  if (!leftColumn) {
    playlistRef.value.style.height = "";
    return;
  }
  // 确保元素已渲染且可见
  const rect = leftColumn.getBoundingClientRect();
  if (rect.height === 0) {
    // 如果高度为0，说明元素可能还在动画中，延迟重试
    setTimeout(() => syncHeight(), 100);
    return;
  }
  playlistRef.value.style.height = `${Math.round(rect.height)}px`;
  playlistRef.value.style.maxHeight = "";
};

const updateFromState = (state) => {
  if (!state || typeof state !== "object") return;
  if (typeof state.isPlaylistLoading === "boolean") {
    isPlaylistLoading.value = state.isPlaylistLoading;
  }
  if (typeof state.playlistMode === "number") {
    playlistMode.value = state.playlistMode;
  }
};

const handlePlaylistLoading = (event) => updateFromState(event?.detail);

const syncFromWindowState = () => {
  if (typeof window === "undefined") return;
  updateFromState(window.__playerUiState);
};

onMounted(() => {
  if (typeof window === "undefined") return;
  syncFromWindowState();
  window.addEventListener("player:playlist-loading", handlePlaylistLoading);
  mediaQuery = window.matchMedia("(min-width: 768px)");
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", syncHeight);
  } else {
    mediaQuery.addListener(syncHeight);
  }
  const leftColumn = document.getElementById("cleftPart");
  if (leftColumn && typeof ResizeObserver !== "undefined") {
    leftObserver = new ResizeObserver(() => syncHeight());
    leftObserver.observe(leftColumn);
  } else {
    window.addEventListener("resize", syncHeight);
  }
  
  // 等待 DOM 渲染和动画完成后再同步高度
  // fadeUp 动画: 0.5s duration, PlaylistView delay: 0.1s, PlayerControls: 0s delay
  // 使用 requestAnimationFrame 确保在下一帧执行
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      syncHeight();
      // 动画完成后再次同步（0.5s + 0.1s + 缓冲）
      setTimeout(() => {
        syncHeight();
      }, 700);
    });
  });
});

onBeforeUnmount(() => {
  if (leftObserver) {
    leftObserver.disconnect();
  }
  if (typeof window === "undefined") return;
  window.removeEventListener("player:playlist-loading", handlePlaylistLoading);
  if (mediaQuery) {
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener("change", syncHeight);
    } else {
      mediaQuery.removeListener(syncHeight);
    }
  }
  window.removeEventListener("resize", syncHeight);
});

const sourceOptions = computed(() => [
  { label: t("playlist.sourceAll"), value: "0" },
  { label: t("playlist.sourceFavorites"), value: "1" },
  { label: t("playlist.sourceHistory"), value: "2" },
]);

const isFilterMenuOpen = ref(false);
const trackerName = ref("");
const formatFilterRef = ref(null);
const searchText = ref("");

const sortOptions = computed(() => [
  { label: t("playlist.sortIdAsc", null, "ID 正序 (升序)"), value: "0" },
  { label: t("playlist.sortIdDesc", null, "ID 倒序 (降序)"), value: "1" },
  { label: t("playlist.sortTitleAsc", null, "标题 正序 (A-Z)"), value: "2" },
  { label: t("playlist.sortTitleDesc", null, "标题 倒序 (Z-A)"), value: "3" },
  { label: t("playlist.sortFilenameAsc", null, "文件名 正序 (A-Z)"), value: "4" },
  { label: t("playlist.sortFilenameDesc", null, "文件名 倒序 (Z-A)"), value: "5" },
  { label: t("playlist.sortSizeAsc", null, "文件大小 正序 (小到大)"), value: "6" },
  { label: t("playlist.sortSizeDesc", null, "文件大小 倒序 (大到小)"), value: "7" },
  { label: t("playlist.sortMtimeAsc", null, "修改时间 正序 (旧到新)"), value: "8" },
  { label: t("playlist.sortMtimeDesc", null, "修改时间 倒序 (新到旧)"), value: "9" },
]);

const hasActiveFilters = computed(() => {
  return sort.value !== "0" ||
         channels.value !== "all" ||
         size.value !== "all" ||
         (trackerName.value && trackerName.value.trim() !== "");
});

const onTrackerNameChange = () => {
  const hiddenEl = document.getElementById("trackerNameInput");
  if (hiddenEl) {
    hiddenEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
};

const clearSearch = () => {
  searchText.value = "";
  nextTick(() => {
    const input = document.getElementById("searchInput");
    if (input) input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const clearTrackerName = () => {
  trackerName.value = "";
  onTrackerNameChange();
};

const clearAllFilters = () => {
  sort.value = "0";
  channels.value = "all";
  size.value = "all";
  trackerName.value = "";
  if (formatFilterRef.value) {
    formatFilterRef.value.resetToDefault();
  }
  nextTick(() => {
    // Dispatch a single change event to trigger one server reload.
    // All filter values are read from the DOM by loadSongsFromServer,
    // and Vue has already updated all bound elements by this tick.
    const sortSelect = document.getElementById("sortSelect");
    if (sortSelect) sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const channelsOptions = computed(() => [
  { label: t("playlist.channelsAll", null, "全部通道"), value: "all" },
  { label: t("playlist.channels4", null, "4 通道"), value: "4" },
  { label: t("playlist.channels8", null, "8 通道"), value: "8" },
  { label: t("playlist.channelsMulti", null, "多通道 (>8)"), value: "multi" },
]);

const sizeOptions = computed(() => [
  { label: t("playlist.sizeAll", null, "全部大小"), value: "all" },
  { label: t("playlist.sizeSmall", null, "极小 (< 100KB)"), value: "small" },
  { label: t("playlist.sizeMedium", null, "中等 (100KB - 1MB)"), value: "medium" },
  { label: t("playlist.sizeLarge", null, "超大 (> 1MB)"), value: "large" },
]);

const playlistModeLabel = computed(() => {
  switch (playlistMode.value) {
    case 1:
      return t("playlist.sourceFavorites");
    case 2:
      return t("playlist.sourceHistory");
    default:
      return t("playlist.sourceAll");
  }
});
</script>

<template>
  <section
    ref="playlistRef"
    class="card flex flex-col gap-4 min-h-0 overflow-hidden opacity-0 translate-y-4 animate-fadeUp [animation-delay:0.1s]"
    style="min-width: 0;"
  >
    <div class="shrink-0 border-b border-border/30 pb-3.5">
      <div class="flex flex-wrap items-center justify-between gap-3 min-w-0">
        <!-- Left: List Source & Search input -->
        <div class="flex flex-1 items-center gap-2 sm:gap-3 min-w-[200px]">
          <div class="flex items-center gap-2 whitespace-nowrap shrink-0">
            <BaseSelect
              id="likeBoxBtn"
              v-model="source"
              :options="sourceOptions"
            />
            <span
              id="likeBoxSpinner"
              class="hidden h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-text-soft"
              aria-hidden="true"
            ></span>
          </div>

          <div class="flex-1 min-w-[120px] relative group">
            <input
              id="searchInput"
              v-model="searchText"
              type="text"
              class="input-base w-full pl-10 pr-8 h-10 bg-surface-2/40 border-border/40 focus:bg-surface-2/60 transition-all text-sm"
              :placeholder="t('playlist.searchPlaceholder')"
              :aria-label="t('playlist.searchLabel')"
            />
            <svg
              class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-accent transition-colors"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <button
              v-if="searchText"
              @click="clearSearch"
              type="button"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text cursor-pointer transition-colors"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        <!-- Right: Toggle filters panel button -->
        <button
          type="button"
          @click="isFilterMenuOpen = !isFilterMenuOpen"
          class="flex items-center gap-2 px-3.5 h-10 rounded-lg border text-sm font-semibold transition-all cursor-pointer select-none active:scale-[0.98]"
          :class="isFilterMenuOpen 
            ? 'border-accent/40 bg-accent/[0.08] text-accent' 
            : 'border-border/80 bg-surface text-text-soft hover:text-text hover:border-border-strong hover:bg-surface-hover'"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
          </svg>
          <span class="max-sm:hidden">{{ t('playlist.filterAndSort', null, '筛选与排序') }}</span>
          <span 
            v-if="hasActiveFilters" 
            class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"
            :title="t('playlist.filterActive')"
          ></span>
          <svg
            class="w-3.5 h-3.5 text-text-muted transition-transform duration-200"
            :class="{ 'rotate-180': isFilterMenuOpen }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      <!-- Collapsible filters panel -->
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="transform scale-y-95 opacity-0 max-h-0"
        enter-to-class="transform scale-y-100 opacity-100 max-h-[500px]"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="transform scale-y-100 opacity-100 max-h-[500px]"
        leave-to-class="transform scale-y-95 opacity-0 max-h-0"
      >
        <div 
          v-show="isFilterMenuOpen"
          class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-3.5 p-4 rounded-xl border border-border/40 bg-surface-2/20 backdrop-blur-xs overflow-hidden origin-top"
        >
          <!-- Sort -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-text-muted/80">
              {{ t("playlist.sortLabel") }}
            </label>
            <BaseSelect id="sortSelect" v-model="sort" :options="sortOptions" class="w-full" />
          </div>

          <!-- Format (multi-select panel) -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-text-muted/80">
              {{ t("playlist.formatLabel", null, "格式") }}
            </label>
            <FormatFilterPanel ref="formatFilterRef" />
          </div>

          <!-- Channels -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-text-muted/80">
              {{ t("playlist.channelsLabel", null, "声道") }}
            </label>
            <BaseSelect id="channelsSelect" v-model="channels" :options="channelsOptions" class="w-full" />
          </div>

          <!-- Size -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-text-muted/80">
              {{ t("playlist.sizeLabel", null, "大小") }}
            </label>
            <BaseSelect id="sizeSelect" v-model="size" :options="sizeOptions" class="w-full" />
          </div>

          <!-- Tracker Name Filter -->
          <div class="flex flex-col gap-1.5 sm:col-span-2">
            <label class="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-text-muted/80 flex items-center justify-between">
              <span>{{ t("playlist.trackerNameLabel", null, "Tracker 名称") }}</span>
              <button 
                v-if="trackerName" 
                @click="clearTrackerName"
                type="button" 
                class="text-[0.62rem] text-accent hover:underline lowercase font-bold transition-all"
              >
                {{ t('playlist.clearFilter') }}
              </button>
            </label>
            <div class="relative w-full">
              <input
                id="trackerNameInput"
                v-model="trackerName"
                @keyup.enter="onTrackerNameChange"
                type="text"
                class="input-base w-full h-10 bg-surface pl-3 pr-8 border border-border/40 focus:border-accent/40 focus:bg-surface-2/40 transition-all text-sm rounded-lg"
                :placeholder="t('playlist.trackerNamePlaceholder')"
                list="trackerNameList"
              />
              <datalist id="trackerNameList">
                <option value="FastTracker II" />
                <option value="MilkyTracker" />
                <option value="OpenMPT" />
                <option value="Scream Tracker 3" />
                <option value="Protracker" />
                <option value="MadTracker 2.0" />
                <option value="Impulse Tracker" />
              </datalist>
              <button
                v-if="trackerName"
                @click="clearTrackerName"
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text cursor-pointer transition-colors"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          <!-- Clear all filters -->
          <div
            v-if="hasActiveFilters"
            class="col-span-full flex justify-end border-t border-border/30 pt-3 mt-1"
          >
            <button
              type="button"
              @click="clearAllFilters"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-text-soft hover:text-accent hover:bg-accent/[0.08] transition-all cursor-pointer select-none active:scale-[0.97]"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <span>{{ t('playlist.clearAllFilters', null, '清除筛选') }}</span>
            </button>
          </div>
        </div>
      </transition>
    </div>

    <div class="flex flex-col flex-1 min-h-0 gap-2.5">
      <div
        class="hidden sm:flex items-center justify-between gap-3 rounded-md border border-border/70 bg-surface-2/60 px-3 py-2 text-[0.78rem] font-semibold text-text-soft shrink-0"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-center gap-2">
          <span
            class="text-[0.68rem] uppercase tracking-[0.12em] text-text-soft"
          >
            {{ t("playlist.playlistLabel") }}
          </span>
          <span class="h-1 w-1 rounded-full bg-border-strong/80"></span>
          <span id="pageRangeSummary" class="text-text-muted">
            {{ t("playlist.pageRangeEmpty") }}
          </span>
          <span class="h-1 w-1 rounded-full bg-border-strong/80"></span>
          <span class="text-text-muted">{{ playlistModeLabel }}</span>
          <span
            v-if="isPlaylistLoading"
            class="playlist-loading-chip"
            role="status"
            aria-live="polite"
          >
            <span class="playlist-spinner" aria-hidden="true"></span>
            <span>{{ t("player.loadingSongShort") }}</span>
          </span>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="text-[0.66rem] uppercase tracking-[0.12em] text-text-soft"
          >
            {{ t("playlist.rowsLabel") }}
          </span>
          <span class="font-bold text-text">
            {{ t("playlist.rowsPerPage", { count: itemsPerPage }) }}
          </span>
        </div>
      </div>

      <div
        class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-md border border-border bg-surface-2/40 webkit-overflow-scrolling-touch"
        :aria-busy="isPlaylistLoading ? 'true' : 'false'"
        style="max-width: 100%;"
      >
        <table
          id="playlist"
          class="w-full table-fixed border-collapse text-[0.9rem] [&_th]:text-left [&_th]:text-[0.7rem] [&_th]:uppercase [&_th]:tracking-[0.12em] [&_th]:text-text-soft [&_th]:py-2.5 [&_th]:px-4 [&_th]:border-b [&_th]:border-border [&_th]:font-semibold [&_th]:sticky [&_th]:top-0 [&_th]:bg-surface-2 [&_th]:z-10 [&_th:first-child]:w-[70px] [&_th:first-child]:sm:w-[80px] [&_td:first-child]:w-[70px] [&_td:first-child]:sm:w-[80px] [&_td]:py-2 [&_td]:px-4 [&_td]:border-b [&_td]:border-border-light/50 [&_td:nth-child(2)]:overflow-hidden [&_tr]:transition-all [&_tr]:duration-150 [&_tbody_tr]:cursor-pointer [&_tbody_tr:hover]:bg-accent/[0.12] [&_tbody_tr:hover]:shadow-sm [&_tbody_tr:hover]:scale-[1.002] [&_tbody_tr:hover]:-translate-y-px [&_tbody_tr:active]:bg-accent/[0.18] [&_tbody_tr:active]:scale-[0.998]"
        style="max-width: 100%;"
        >
          <colgroup>
            <col class="w-[70px] sm:w-[80px]" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>{{ t("playlist.tableNo") }}</th>
              <th>{{ t("playlist.tableSongInfo", null, "歌曲信息") }}</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <nav
      id="playlistPager"
      class="pagination flex items-center justify-center gap-1 sm:gap-1.5 shrink-0 border-t border-border/70 pt-3"
      :aria-label="t('playlist.pager.aria')"
    >
      <!-- Left button group: jump back 10, previous -->
      <button
        id="pageMinus10"
        data-page-step="-10"
        type="button"
        class="pager-btn"
        :aria-label="t('playlist.pager.back10')"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m11 17-5-5 5-5" />
          <path d="m18 17-5-5 5-5" />
        </svg>
      </button>
      <button
        id="pagePrev"
        data-page-step="-1"
        type="button"
        class="pager-btn"
        :aria-label="t('playlist.pager.prev')"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>

      <!-- Center: compact page indicator -->
      <div class="flex items-center gap-1 rounded-md bg-surface-2/60 px-2.5 py-1.5">
        <input
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          class="h-7 w-11 sm:w-14 rounded border-0 bg-transparent text-center text-sm font-bold text-text [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-1 focus:ring-accent/40 focus:ring-offset-0"
          id="pageInput"
          :aria-label="t('playlist.pager.currentPage')"
        />
        <span class="text-sm font-bold text-text-soft whitespace-nowrap min-w-[2ch] text-center" id="totalPages">
          <span
            id="loading001"
            class="hidden h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            role="status"
            aria-hidden="true"
          ></span>
        </span>
      </div>

      <!-- Right button group: next, jump forward 10 -->
      <button
        id="pageNext"
        data-page-step="1"
        type="button"
        class="pager-btn"
        :aria-label="t('playlist.pager.next')"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      <button
        id="pagePlus10"
        data-page-step="10"
        type="button"
        class="pager-btn"
        :aria-label="t('playlist.pager.forward10')"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m13 7 5 5-5 5" />
          <path d="m6 7 5 5-5 5" />
        </svg>
      </button>
    </nav>
  </section>
</template>

<style scoped>
.pager-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2rem;
  width: 2rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.pager-btn:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  box-shadow: 0 1px 3px rgba(0,0,0,.08);
}
.pager-btn:active:not(:disabled) {
  transform: scale(0.96);
}
.pager-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 50%, transparent), 0 0 0 1px var(--surface);
}
.pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.playlist-loading-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-soft);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.playlist-spinner {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: spin 0.8s linear infinite;
  /* 使用 GPU 加速 */
  will-change: transform;
  transform: translateZ(0);
}

@keyframes spin {
  to {
    transform: rotate(360deg) translateZ(0);
  }
}

/* 性能优化：使用 contain 限制布局和绘制范围 */
.card {
  contain: layout style;
}

/* 优化表格渲染性能 */
#playlist {
  contain: layout style paint;
  /* 启用硬件加速 */
  transform: translateZ(0);
  will-change: contents;
}

/* 优化滚动性能 */
#playlist tbody {
  contain: layout style;
}

/* 为表格行添加优化 */
#playlist tbody tr {
  contain: layout style;
  /* 使用 GPU 加速过渡效果 */
  will-change: background-color, transform;
  position: relative;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 为表格行添加边框高亮效果 */
#playlist tbody tr::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.15s ease;
}

/* 增强的 hover 效果 */
#playlist tbody tr:hover {
  background: linear-gradient(
    90deg,
    rgb(var(--accent-rgb) / 0.08),
    rgb(var(--accent-rgb) / 0.12),
    rgb(var(--accent-rgb) / 0.08)
  );
  box-shadow: 
    0 2px 8px -2px rgb(var(--accent-rgb) / 0.15),
    inset 0 0 0 1px rgb(var(--accent-rgb) / 0.1);
}

#playlist tbody tr:hover::before {
  opacity: 1;
}

#playlist tbody tr:hover td {
  color: var(--text);
}

#playlist tbody tr:hover td:first-child {
  font-weight: 600;
  color: var(--accent);
}

#playlist tbody tr:hover td:nth-child(2) {
  color: var(--text);
  font-weight: 500;
}

/* 激活状态 */
#playlist tbody tr:active {
  transform: scale(0.998) translateY(1px);
  background: rgb(var(--accent-rgb) / 0.16);
  box-shadow: 
    0 1px 4px -1px rgb(var(--accent-rgb) / 0.2),
    inset 0 0 0 1px rgb(var(--accent-rgb) / 0.15);
}

/* 平滑的文本过渡 */
#playlist tbody tr td {
  transition: all 0.15s ease;
}

/* 移动端滚动优化 */
@media (max-width: 767px) {
  .webkit-overflow-scrolling-touch {
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
  }
  
  /* 确保在移动端显示滚动条 */
  .webkit-overflow-scrolling-touch::-webkit-scrollbar {
    width: 8px;
  }
  
  .webkit-overflow-scrolling-touch::-webkit-scrollbar-track {
    background: var(--scrollbar-track);
  }
  
  .webkit-overflow-scrolling-touch::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 4px;
  }
  
  .webkit-overflow-scrolling-touch::-webkit-scrollbar-thumb:hover {
    background: var(--border-strong);
  }
}
</style>
