<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Scope from "~/components/Scope.vue";
import DownloadModal from "~/components/DownloadModal.vue";

const { t } = useI18n();
const {
  authState: authUser,
  toggleLike,
  isLiked: storeIsLiked,
} = useAuthStore();

const activeSong = useState("activeSong", () => null);

const trackNumber = ref(null);
const songTitle = ref(activeSong.value?.title || "");
const fileName = ref(activeSong.value?.fileName || "");
const fileUrl = ref(activeSong.value ? `/api/music/${encodeURIComponent(activeSong.value.fileName)}` : "");
const downloadUrl = ref("");
const gameUrl = ref("");
const modArchiveUrl = ref("");
const isPlaying = ref(false);
const isTrackLoading = ref(false);
const playmode = ref(1);
const modeLabel = computed(() => {
  switch (playmode.value) {
    case 0:
      return t("player.mode.stopAfter");
    case 1:
      return t("player.mode.inOrder");
    case 2:
      return t("player.mode.loopOne");
    case 3:
    default:
      return t("player.mode.shuffle");
  }
});
const volume = ref(10);
const progress = ref(0);
const elapsedSeconds = ref(0);
const durationSeconds = ref(0);
const remainingSeconds = ref(0);
const isLiking = ref(false);

// isLiked is now derived from the global auth store
const isLiked = storeIsLiked(() => fileName.value);

const hasTrack = computed(() => Boolean(fileName.value));

const displayTitle = computed(() => {
  if (isTrackLoading.value) return t("player.loadingSong");
  return songTitle.value || fileName.value || (t("app.title") ? `${t("nav.brand")} - ${t("app.title")}` : t("player.noFileSelected"));
});
const displayTrackNumber = computed(() => {
  if (isTrackLoading.value) return t("player.noTrackNumber");
  return trackNumber.value
    ? t("player.trackNumber", { number: trackNumber.value })
    : t("player.noTrackNumber");
});
const displayFileName = computed(() => {
  return fileName.value || "";
});

const progressValue = computed(() =>
  Math.max(0, Math.min(100, Math.round(Number(progress.value) || 0))),
);
const volumeValue = computed(() =>
  Math.max(0, Math.min(100, Math.round(Number(volume.value) || 0))),
);

const clampSeconds = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
};

const formatTime = (seconds) => {
  const totalSeconds = Math.max(0, Math.floor(clampSeconds(seconds)));
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

const elapsedTimeText = computed(() => formatTime(elapsedSeconds.value));
const durationTimeText = computed(() =>
  durationSeconds.value > 0 ? formatTime(durationSeconds.value) : "--:--",
);
const progressTimeText = computed(
  () => `${elapsedTimeText.value} / ${durationTimeText.value}`,
);

const progressLabelText = computed(() =>
  t("player.progressLabel", {
    value: progressValue.value,
    time: progressTimeText.value,
  }),
);
const volumeLabelText = computed(() =>
  t("player.volumeLabel", { value: volumeValue.value }),
);

const volumeSliderStyle = computed(() => ({
  "--slider-value": `${volumeValue.value}%`,
  "--slider-fill": "var(--accent-2)",
  "--slider-track": "color-mix(in srgb, var(--text) var(--slider-track-opacity, 12%), transparent)",
  "--slider-height": "6px",
  "--slider-thumb-size": "15px",
}));

const progressSliderStyle = computed(() => ({
  "--slider-value": `${progressValue.value}%`,
  "--slider-fill": "var(--accent)",
  "--slider-track": "color-mix(in srgb, var(--text) var(--slider-track-opacity, 12%), transparent)",
  "--slider-height": "6px",
  "--slider-thumb-size": "15px",
}));

const modeIconPath = computed(() => {
  switch (playmode.value) {
    case 0: // Stop After
      return "M6 6h12v12H6z";
    case 1: // In Order
      return "M4 6h16M4 12h16M4 18h10";
    case 2: // Loop One
      return "M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3";
    case 3: // Shuffle
    default:
      return "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5";
  }
});

const showDownloadModal = ref(false);
const showTrackInfo = ref(false);
const trackMeta = ref({});
const actionArchiveHref = computed(() => modArchiveUrl.value);

const updateFromState = (state) => {
  if (!state || typeof state !== "object") return;
  if (state.trackNumber !== undefined && state.trackNumber !== null) {
    trackNumber.value = state.trackNumber;
  }
  if (typeof state.songTitle === "string") {
    songTitle.value = state.songTitle;
  }
  if (typeof state.fileName === "string") {
    fileName.value = state.fileName;
  }
  if (typeof state.fileUrl === "string") {
    fileUrl.value = state.fileUrl;
  }
  if (typeof state.downloadUrl === "string") {
    downloadUrl.value = state.downloadUrl;
  }
  if (typeof state.gameUrl === "string") {
    gameUrl.value = state.gameUrl;
  }
  if (typeof state.modArchiveUrl === "string") {
    modArchiveUrl.value = state.modArchiveUrl;
  }
  if (typeof state.isPlaying === "boolean") {
    isPlaying.value = state.isPlaying;
  }
  if (typeof state.isTrackLoading === "boolean") {
    isTrackLoading.value = state.isTrackLoading;
  }
  if (typeof state.playmode === "number") {
    playmode.value = state.playmode;
  }
  if (typeof state.volume === "number") {
    volume.value = state.volume;
  }
  if (typeof state.progress === "number") {
    progress.value = state.progress;
  }
  if (typeof state.elapsedSeconds === "number") {
    elapsedSeconds.value = state.elapsedSeconds;
  }
  if (typeof state.durationSeconds === "number") {
    durationSeconds.value = state.durationSeconds;
  }
  if (typeof state.remainingSeconds === "number") {
    remainingSeconds.value = state.remainingSeconds;
  }
};

const handleTrackChange = (event) => updateFromState(event?.detail);
const handleTrackLoading = (event) => updateFromState(event?.detail);
const handleTrackMeta = (event) => {
  if (event?.detail && typeof event.detail === "object") {
    trackMeta.value = event.detail;
  }
};
const handlePlayState = (event) => updateFromState(event?.detail);
const handleModeChange = (event) => updateFromState(event?.detail);
const handleVolumeChange = (event) => updateFromState(event?.detail);
const handleProgressChange = (event) => updateFromState(event?.detail);
const handleTimeUpdate = (event) => updateFromState(event?.detail);

const syncFromWindowState = () => {
  if (typeof window === "undefined") return;
  updateFromState(window.__playerUiState);
};

const handleLikeClick = async () => {
  if (!authUser.value.loggedIn) {
    // Open auth modal if not logged in
    if (
      typeof window !== "undefined" &&
      typeof window.openAuthModal === "function"
    ) {
      window.openAuthModal("login");
    }
    return;
  }

  if (!fileName.value || isLiking.value) return;

  isLiking.value = true;
  try {
    await toggleLike(fileName.value);
  } catch (err) {
    console.error("Failed to toggle like", err);
  } finally {
    isLiking.value = false;
  }
};

const triggerLegacyClick = (id) => {
  const el = document.getElementById(id);
  if (!el || typeof el.onclick !== "function") return false;
  el.onclick();
  return true;
};

const handlePlayClick = () => {
  if (triggerLegacyClick("play")) return;
  if (
    typeof window !== "undefined" &&
    typeof window.togglePlay === "function"
  ) {
    window.togglePlay();
  }
};

const handleModeClick = () => {
  if (triggerLegacyClick("modeButton")) return;
};

const handleNextClick = () => {
  if (typeof window !== "undefined" && typeof window.toNewSong === "function") {
    window.toNewSong();
  }
};

const preventWhenMissing = (href, event) => {
  if (!href) event.preventDefault();
};

onMounted(() => {
  syncFromWindowState();
  if (typeof window === "undefined") return;
  window.addEventListener("player:track-change", handleTrackChange);
  window.addEventListener("player:track-loading", handleTrackLoading);
  window.addEventListener("player:track-meta", handleTrackMeta);
  window.addEventListener("player:play-state", handlePlayState);
  window.addEventListener("player:mode-change", handleModeChange);
  window.addEventListener("player:volume-change", handleVolumeChange);
  window.addEventListener("player:progress-change", handleProgressChange);
  window.addEventListener("player:time-update", handleTimeUpdate);
});

onBeforeUnmount(() => {
  if (typeof window === "undefined") return;
  window.removeEventListener("player:track-change", handleTrackChange);
  window.removeEventListener("player:track-loading", handleTrackLoading);
  window.removeEventListener("player:track-meta", handleTrackMeta);
  window.removeEventListener("player:play-state", handlePlayState);
  window.removeEventListener("player:mode-change", handleModeChange);
  window.removeEventListener("player:volume-change", handleVolumeChange);
  window.removeEventListener("player:progress-change", handleProgressChange);
  window.removeEventListener("player:time-update", handleTimeUpdate);
});
</script>

<template>
  <div id="cleftPart" class="grid gap-5" style="min-width: 0">
    <section
      id="player"
      class="card player-card opacity-0 translate-y-4 animate-fadeUp"
      :data-playing="isPlaying ? 'true' : 'false'"
      :data-has-track="hasTrack ? 'true' : 'false'"
      :data-loading="isTrackLoading ? 'true' : 'false'"
    >
      <Scope mode="background" />
      <div class="player-shell">
        <header class="player-header">
          <div class="player-chips">
            <span class="chip chip-track">{{ displayTrackNumber }}</span>
            <span class="chip chip-mode">{{ modeLabel }}</span>
          </div>

          <nav class="player-actions" :aria-label="t('player.actionsAria')">
            <button
              class="action-link"
              type="button"
              :class="{ 'is-disabled': !hasTrack }"
              :aria-label="t('player.actionDownloadAria')"
              :disabled="!hasTrack"
              @click="hasTrack && (showDownloadModal = true)"
            >
              <svg
                class="action-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4v10" />
                <path d="m8 10 4 4 4-4" />
                <path d="M5 20h14" />
              </svg>
              <span class="action-text">{{ t("player.download") }}</span>
            </button>

            <!-- 游戏按钮暂时注释，功能还未完成 -->
            <!--
            <a
              class="action-link"
              :class="{ 'is-disabled': !actionGameHref }"
              :href="actionGameHref || '#'"
              :aria-label="t('player.actionGameAria')"
              :aria-disabled="!actionGameHref"
              @click="preventWhenMissing(actionGameHref, $event)"
            >
              <svg
                class="action-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path
                  d="M6.5 10h11a4.5 4.5 0 0 1 4.5 4.5v0A4.5 4.5 0 0 1 17.5 19h-11A4.5 4.5 0 0 1 2 14.5v0A4.5 4.5 0 0 1 6.5 10Z"
                />
                <path d="M9 14h.01" />
                <path d="M15 14h.01" />
                <path d="M8 13v2" />
                <path d="M7 14h2" />
              </svg>
              <span class="action-text">{{ t("player.game") }}</span>
            </a>
            -->

            <a
              class="action-link"
              :class="{ 'is-disabled': !actionArchiveHref }"
              :href="actionArchiveHref || '#'"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="t('player.actionArchiveAria')"
              :aria-disabled="!actionArchiveHref"
              @click="preventWhenMissing(actionArchiveHref, $event)"
            >
              <svg
                class="action-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M10 14 21 3" />
                <path d="M21 3h-7" />
                <path d="M21 3v7" />
                <path
                  d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"
                />
              </svg>
              <span class="action-text">{{ t("player.archive") }}</span>
            </a>

            <button
              class="action-link"
              type="button"
              :class="{ 'is-disabled': !hasTrack }"
              :aria-label="t('player.actionInfoAria')"
              :disabled="!hasTrack"
              @click="hasTrack && (showTrackInfo = true)"
            >
              <svg
                class="action-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              <span class="action-text">{{ t("player.info") }}</span>
            </button>
          </nav>
        </header>

        <div class="player-titleblock">
          <h1 class="player-title">
            <span
              v-if="isTrackLoading"
              class="title-loading"
              role="status"
              aria-live="polite"
            >
              <span class="title-loading-spinner" aria-hidden="true"></span>
              <span>{{ t("player.loadingSong") }}</span>
            </span>
            <template v-else>{{ displayTitle }}</template>
          </h1>
          <p
            class="player-filename"
            :title="isTrackLoading ? '' : displayFileName"
          >
            <span
              v-if="!displayFileName"
              class="filename-placeholder"
              aria-hidden="true"
            ></span>
            <template v-else>{{ displayFileName }}</template>
          </p>
        </div>

        <div class="player-controls">
          <button
            class="btn-base btn-primary control-play"
            type="button"
            :aria-label="isPlaying ? t('player.pause') : t('player.play')"
            @click="handlePlayClick"
          >
            <svg
              class="control-play-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path v-if="!isPlaying" d="M5 3l14 9-14 9V3z" />
              <path v-else d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
            <span class="control-play-text">
              {{ isPlaying ? t("player.pause") : t("player.play") }}
            </span>
          </button>

          <button
            class="btn-base btn-secondary control-mode"
            type="button"
            :aria-label="t('player.playbackModeAria', { mode: modeLabel })"
            @click="handleModeClick"
          >
            <svg
              class="control-mode-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="modeIconPath" />
            </svg>
            <span class="control-mode-text">{{ modeLabel }}</span>
          </button>

          <button
            class="btn-base btn-secondary control-next"
            type="button"
            :aria-label="t('player.nextAria')"
            @click="handleNextClick"
          >
            <svg
              class="control-next-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M5 4l10 8-10 8V4zM19 5v14" />
            </svg>
            <span class="control-next-text sr-only">{{
              t("player.next")
            }}</span>
          </button>

          <button
            id="likeButton"
            class="btn-base btn-danger control-like"
            type="button"
            :aria-label="t('player.like')"
            :title="
              hasTrack ? t('player.likeTitle') : t('player.likeTitleEmpty')
            "
            @click="handleLikeClick"
          >
            <template v-if="isLiking">
              <span
                class="spinner-border animate-spin inline-block w-4 h-4 border-2 rounded-full border-t-transparent mr-1"
                role="status"
              ></span>
            </template>
            <template v-else>
              <svg
                class="control-like-icon"
                viewBox="0 0 24 24"
                :fill="isLiked ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
                />
              </svg>
            </template>
            <span class="control-like-text sr-only">
              {{ isLiked ? t("player.like") : t("player.like") }}
            </span>
          </button>
        </div>

        <div class="slider-stack">
          <div class="slider-row slider-volume" :style="volumeSliderStyle">
            <span class="slider-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                <path
                  v-if="volumeValue >= 50"
                  d="M19.07 4.93a10 10 0 0 1 0 14.14"
                />
                <path v-if="volumeValue > 0" d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </span>
            <label id="volumeLabel" class="slider-label sr-only" for="volume">
              {{ volumeLabelText }}
            </label>
            <input
              id="volume"
              class="slider player-range"
              type="range"
              min="0"
              max="100"
              :value="volumeValue"
              aria-labelledby="volumeLabel"
            />
            <span class="slider-value compact">{{ volumeValue }}%</span>
          </div>

          <div class="slider-row slider-progress" :style="progressSliderStyle">
            <span class="slider-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </span>
            <label
              id="progressLabel"
              class="slider-label sr-only"
              for="progress"
            >
              {{ progressLabelText }}
            </label>
            <input
              id="progress"
              class="slider player-range"
              type="range"
              min="0"
              max="100"
              :value="progressValue"
              aria-labelledby="progressLabel"
            />
            <span class="slider-value compact slider-value-time">{{
              progressTimeText
            }}</span>
          </div>
        </div>

        <!-- Legacy interop nodes used by public/script/player-app.js -->
        <ClientOnly>
          <div class="legacy-interop" aria-hidden="true">
            <button id="play" type="button">{{ t("player.play") }}</button>
            <button id="modeButton" type="button">
              {{ modeLabel }}
            </button>
            <p id="songname">{{ t("player.loadingSong") }}</p>
            <p id="notitle"></p>
            <p id="filename"></p>
          </div>
        </ClientOnly>
      </div>
    </section>

    <DownloadModal
      :is-open="showDownloadModal"
      :close-modal="() => (showDownloadModal = false)"
      :file-name="fileName"
      :file-url="fileUrl"
      :download-url="downloadUrl"
    />

    <TrackInfoModal
      :is-open="showTrackInfo"
      :close-modal="() => (showTrackInfo = false)"
      :meta="trackMeta"
      :file-name="fileName"
    />

    <ClientOnly>
      <section id="pattern" class="pattern-panel reveal delay-2 player-pattern">
        <div class="pattern-header">
          <div class="pattern-title">{{ t("player.patternTitle") }}</div>
          <span class="badge text-[0.65rem]">{{
            t("player.trackerViewBadge")
          }}</span>
        </div>
        <div id="patternhighlight" class="pattern-highlight"></div>
        <div id="patternview" class="pattern-view"></div>
      </section>
    </ClientOnly>
  </div>
</template>

<style scoped>
.player-card {
  padding: 1.25rem;
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

.player-shell {
  display: grid;
  gap: 0.9rem;
  position: relative;
  z-index: 1;
}

.player-header {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
}

.player-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.18rem 0.45rem;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-2) 65%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: var(--text-soft);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
}

.chip-track {
  color: var(--accent-strong);
  border-color: rgba(37, 99, 235, 0.35);
  background: rgba(37, 99, 235, 0.06);
}

.chip-mode {
  color: var(--text);
}

.player-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.action-link {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  padding: 0.28rem 0.5rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: var(--text);
  font-weight: 600;
  font-size: 0.72rem;
  text-decoration: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}

.action-link:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  box-shadow: 0 10px 22px -16px rgba(15, 23, 42, 0.28);
  transform: translateY(-1px);
}

.action-link.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

.action-icon {
  width: 14px;
  height: 14px;
}

.action-text {
  white-space: nowrap;
}

.player-titleblock {
  display: grid;
  gap: 0.25rem;
}

.player-title {
  margin: 0;
  font-size: clamp(1.35rem, 1.05rem + 1.2vw, 1.8rem);
  line-height: 1.12;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text);
  word-break: break-word;
}

.title-loading {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.title-loading-spinner {
  width: 0.95rem;
  height: 0.95rem;
  border-radius: 999px;
  border: 2px solid var(--accent);
  border-top-color: transparent;
  animation: spin 0.8s linear infinite;
}

.player-filename {
  margin: 0;
  color: var(--text-soft);
  font-size: 0.84rem;
  font-family:
    "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filename-placeholder {
  display: inline-block;
  width: min(20ch, 72%);
  height: 0.82em;
  border-radius: 999px;
  vertical-align: middle;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--surface-3) 90%, transparent),
    color-mix(in srgb, var(--surface-2) 96%, white),
    color-mix(in srgb, var(--surface-3) 90%, transparent)
  );
  animation: placeholderPulse 1.1s ease-in-out infinite;
}

.player-controls {
  display: grid;
  grid-template-columns: 1fr repeat(3, auto);
  gap: 0.55rem;
  align-items: center;
  order: 1;
}

.control-play {
  min-height: 44px;
  font-size: 0.875rem;
  font-weight: 800;
  gap: 0.55rem;
}

.control-play-icon {
  width: 22px;
  height: 22px;
}

.control-play-text {
  letter-spacing: 0.01em;
}

.control-mode {
  padding-inline: 0.75rem;
  min-height: 44px;
}

.control-mode-icon,
.control-next-icon,
.control-like-icon {
  width: 20px;
  height: 20px;
}

.control-mode-text,
.control-next-text,
.control-like-text {
  white-space: nowrap;
}

.control-next,
.control-like {
  width: 44px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.slider-stack {
  margin-top: 0;
  display: grid;
  gap: 0.3rem;
  padding: 0.2rem 0.1rem;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.slider-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 0.55rem;
  align-items: center;
  padding: 0.18rem 0.32rem;
  border-radius: 10px;
  position: relative;
  overflow: visible;
}

.slider-row + .slider-row {
  border-top: 0;
  padding-top: 0.18rem;
  margin-top: 0;
}

.slider-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--text-soft);
  opacity: 0.85;
}

.slider-icon svg {
  width: 16px;
  height: 16px;
}

.slider-volume .slider-icon {
  color: color-mix(in srgb, var(--accent-2, #f97316) 88%, var(--text));
}

.slider-progress .slider-icon {
  color: color-mix(in srgb, var(--accent, #2563eb) 88%, var(--text));
}

.slider-row .player-range {
  margin: 0;
  height: var(--slider-height);
}

.slider-row .slider::-webkit-slider-thumb {
  width: var(--slider-thumb-size);
  height: var(--slider-thumb-size);
}

.slider-row .slider::-moz-range-thumb {
  width: var(--slider-thumb-size);
  height: var(--slider-thumb-size);
}

.slider-value.compact {
  min-width: 42px;
  text-align: center;
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  padding: 0.12rem 0.42rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 80%, transparent);
  border: 1px solid var(--border);
  letter-spacing: 0.02em;
}

.slider-value.compact.slider-value-time {
  min-width: 96px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.legacy-interop {
  display: none;
}

.player-pattern {
  display: grid;
}

.pattern-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.pattern-title {
  font-size: 0.86rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text);
}

.pattern-highlight:empty {
  display: none;
}

.pattern-view {
  min-height: 120px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes placeholderPulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 0.9;
  }
}

@media (max-width: 720px) {
  .player-controls {
    grid-template-columns: 1fr repeat(3, auto);
  }
}

@media (max-width: 400px) {
  .control-play-text,
  .control-mode-text {
    display: none;
  }

  .control-play {
    gap: 0;
  }

  .control-mode {
    padding-inline: 0;
    width: 44px;
    display: flex;
    justify-content: center;
  }

  .player-controls {
    grid-template-columns: 1fr repeat(3, auto);
    gap: 0.55rem;
  }
}
</style>
