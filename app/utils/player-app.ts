// @ts-nocheck
import type { NuxtApp } from '#app';
import { $fetch as ofetch } from 'ofetch';
import { ScopeWebGLRenderer, PatternWebGLRenderer, showWebGLErrorBanner } from './webgl-visualizer';

declare const JSONH: {
  parse(text: string): unknown;
  stringify(value: unknown): string;
};
declare const BassoonTracker: {
  init: (useWorker?: boolean) => void;
  audio: {
    context: AudioContext | null;
    masterVolume: GainNode;
    cutOffVolume: GainNode;
  };
  getBPM: () => number;
  getAmigaSpeed: () => number;
  togglePlay: () => void;
  stop: () => void;
  isPlaying: () => boolean;
  load: (url: string, bypassCache: boolean, callback: () => void) => void;
  getStateAtTime: (time: number) => any;
  getSong: () => any;
  getTrackCount: () => number;
  setCurrentSongPosition: (position: number) => void;
};
declare const NOTEPERIOD: Record<string, any>;
declare const FTNOTEPERIOD: Record<string, any>;

declare global {
  interface Window {
    __playerUiState?: Record<string, unknown>;
    __playerAppInitialized?: boolean;
    resetSettings?: () => void;
    clearHistory?: () => void;
    clearCachedPlaylist?: () => void;
    togglePlay?: () => void;
    toNewSong?: () => void;
    toPrevSong?: () => void;
    play?: (url: string) => void;
    bindSettingsUI?: () => void;
    updateUiSettings?: () => void;
    applyScopeSettings?: (setScope: boolean, setTotalScope: boolean, setChannelScope: boolean) => void;
    applyGeneralSettings?: (partial: Record<string, unknown>) => void;
  }
}

let playerAppInitialized = false;

export function setupPlayerApp(nuxtApp: NuxtApp) {
  if (typeof window === 'undefined' || playerAppInitialized) return;
  playerAppInitialized = true;
  window.__playerAppInitialized = true;

  function safeJsonParse(value, fallback) {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function safeJsonhParse(value, fallback) {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }
    if (typeof JSONH !== 'undefined' && JSONH && typeof JSONH.parse === 'function') {
      try {
        return JSONH.parse(value);
      } catch (error) {
        return fallback;
      }
    }
    return safeJsonParse(value, fallback);
  }

  let togglePlayImpl: (() => void) | undefined;
  let startMediaBridgeImpl: ((url?: string) => void) | undefined;
  window.togglePlay = () => {
    if (togglePlayImpl) {
      togglePlayImpl();
    } else {
      console.warn("Player is not ready yet.");
    }
  };

  const baseFetch =
    nuxtApp && typeof nuxtApp.$fetch === "function" ? nuxtApp.$fetch : ofetch;
  const nuxtFetch = (input: RequestInfo, init?: RequestInit) =>
    baseFetch(input, { ...init, credentials: "include" });
  const nuxtFetchText = (input: RequestInfo, init?: RequestInit) =>
    baseFetch(input, { ...init, responseType: "text" });

  // FormatFilterPanel 的隐藏 input 延迟查询——组件可能在 setupPlayerApp 之后挂载
  function getExtensionsVal() {
    const el = document.querySelector("#extensionsInput");
    return el ? (el as HTMLInputElement).value : "";
  }

  var isNavigatingHistory = false;
  var historyCursor = 0;
  var playItem;
  var playlistdata = [];
  var matchedData = [];
  var processData = [];
  var serverTotalItems = 0;
  var serverTotalPages = 0;
  var autoPlay = true;
  var firstplay = false;
  var numno;
  var currentPlayTrackId = null;
  var listNo;
  var renderHistoryPlaylist;
  var sortType = 0;
  var oppChange = 0;
  var oppRepet = 0;
  var fileNameplaying;
  var fileExtensionPlaying;
  var pendingUrl = "";
  var isTrackReady = false;
  var fmusicList;
  var fmusicListActive = 0;
  var username = "";
  var titlekeyWords = " " + t("player.untitled", null, "untitled");
  var playlistLookupMap = new Map(); // 文件名到ID的快速查找映射
  var percentage;
  var lastElapsedSeconds = 0;
  var lastDurationSeconds = 0;
  var historyPlaylist = safeJsonParse(localStorage.getItem("historyPlaylist"), []);
  if (!Array.isArray(historyPlaylist)) {
    historyPlaylist = [];
  }
  var storedSettings = safeJsonParse(localStorage.getItem("player_settings"), null);
  if (!storedSettings || typeof storedSettings !== "object" || Array.isArray(storedSettings)) {
    storedSettings = null;
  }
  // 默认使用本地 API 端点提供音乐文件
  var mainFilePath = "/api/music/";
  // 如果设置了自定义音乐源，则使用自定义源
  if (storedSettings && storedSettings.setMusicSource) {
    mainFilePath = storedSettings.setMusicSource;
    // 确保路径以 / 结尾
    if (!mainFilePath.endsWith("/")) {
      mainFilePath += "/";
    }
  }
  var isPlayingUi = false;
  var songName: HTMLElement | null = null;
  var defaultSettings = {
    setNav: true,
    setScope: true,
    setTotalScope: false,
    setChannelScope: true,
    setPattern: true,
    setComment: true,
    setIntroduce: true,
    forcedVolume: false,
    setVolume: 10,
    setLooptimes: 2,
    playmode: 1,
    setMusicSource: "",
    setEngine: 2,
    loudnessEq: false,
  };
  if (storedSettings) {
    for (var key in defaultSettings) {
      if (!(key in storedSettings)) {
        storedSettings[key] = defaultSettings[key];
      }
    }
    localStorage.setItem("player_settings", JSON.stringify(storedSettings));
  } else {
    storedSettings = defaultSettings;
    localStorage.setItem("player_settings", JSON.stringify(storedSettings));
  }
  var playmode = storedSettings.playmode;
  var looptime = storedSettings.setLooptimes;
  var svolume = storedSettings.setVolume;
  var scopeActive = storedSettings.setScope;

  // ── 响度均衡 (Loudness Normalization / AGC) state ─────────────────
  var _normGainNode: GainNode | null = null;     // currently active AGC gain node
  var _normMeasurer: AnalyserNode | null = null; // currently active RMS measurement node
  var currentNormGain = 1.0;                     // smoothed AGC gain value
  var normTargetRMS = 0.15;                      // target RMS level (~-16.5 dBFS linear)
  var normAttackAlpha = 0.04;                    // smoothing alpha when boosting (faster)
  var normReleaseAlpha = 0.003;                  // smoothing alpha when cutting (slower)

  function getI18nApi() {
    if (typeof window === "undefined") return null;
    if (window.__i18n && typeof window.__i18n.t === "function") {
      return window.__i18n;
    }
    return null;
  }

  function formatTemplate(text, params) {
    if (!params) return text;
    return String(text).replace(/\{(\w+)\}/g, function (match, key) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) return match;
      var value = params[key];
      if (value === undefined || value === null) return "";
      return String(value);
    });
  }

  function t(key, params, fallback) {
    var api = getI18nApi();
    if (api) {
      var value = api.t(key, params);
      if (value !== undefined && value !== null) return String(value);
    }
    var safeFallback = fallback || key;
    return formatTemplate(safeFallback, params);
  }

  function getElementByIdSafe(id) {
    return document.getElementById(id);
  }

  function parseSongRoute(pathname) {
    if (!pathname || typeof pathname !== "string") return null;
    const segments = pathname.split("/").filter(Boolean);
    const songIndex = segments.indexOf("song");
    if (songIndex === -1) return null;
    const idSegment = segments[songIndex + 1];
    if (!idSegment) return null;
    const id = parseInt(idSegment, 10);
    if (!Number.isFinite(id)) return null;
    const fileSegment = segments[songIndex + 2];
    const fileName = fileSegment ? safeDecode(fileSegment) : null;
    return { id, fileName };
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function getTrackFromLocation() {
    if (typeof window === "undefined") return null;
    const fromPath = parseSongRoute(window.location.pathname);
    if (fromPath && Number.isFinite(fromPath.id)) {
      return fromPath;
    }
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("id");
    if (!idParam) return null;
    const id = parseInt(idParam, 10);
    if (!Number.isFinite(id)) return null;
    return { id, fileName: null };
  }

  function buildSongPath(trackNumber, fileName) {
    const id = Number(trackNumber);
    if (!Number.isFinite(id) || id < 1) return null;
    if (!fileName) return `/song/${id}`;
    return `/song/${id}/${encodeURIComponent(fileName)}`;
  }

  function updateTrackUrl(trackNumber, fileName) {
    if (typeof window === "undefined") return;
    const path = buildSongPath(trackNumber, fileName);
    if (!path) return;
    const nextUrl = `${window.location.origin}${path}`;
    history.pushState(null, "", nextUrl);
  }

  var playerUiState = window.__playerUiState || {};
  window.__playerUiState = playerUiState;

  function emitPlayerUiEvent(type, detail) {
    try {
      if (detail && typeof detail === "object") {
        playerUiState = Object.assign(playerUiState, detail);
        window.__playerUiState = playerUiState;
      }
      window.dispatchEvent(
        new CustomEvent("player:" + type, {
          detail: detail,
        }),
      );
    } catch (error) {
      // No-op: UI events should never break playback.
    }
  }

  function getCheckboxValue(id) {
    var el = getElementByIdSafe(id);
    return !!(el && el.checked);
  }

  function setCheckboxValue(id, value) {
    var el = getElementByIdSafe(id);
    if (el) {
      el.checked = !!value;
    }
  }

  function getInputValue(id) {
    var el = getElementByIdSafe(id);
    if (!el) return undefined;
    return el.value;
  }

  function setInputValue(id, value) {
    var el = getElementByIdSafe(id);
    if (!el) return;
    if (value === undefined || value === null) {
      el.value = "";
    } else {
      el.value = value;
    }
  }

  function setElementDisplayValue(id, displayValue) {
    var el = getElementByIdSafe(id);
    if (!el) return;
    el.style.display = displayValue;
  }

  var toastViewportId = "playerToastViewport";
  var toastTimers = new Map();
  var toastCounter = 0;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getToastTitle(variant) {
    if (variant === "success") return t("toast.success", null, "Success");
    if (variant === "info") return t("toast.notice", null, "Notice");
    return t("toast.warning", null, "Warning");
  }

  function getToastViewport() {
    var viewport = document.getElementById(toastViewportId);
    if (viewport) return viewport;

    viewport = document.createElement("div");
    viewport.id = toastViewportId;
    viewport.className = "player-alerts player-toast-viewport";
    viewport.setAttribute("aria-live", "polite");
    document.body.appendChild(viewport);
    return viewport;
  }

  function dismissToast(toastId) {
    var selector = '[data-toast-id="' + toastId + '"]';
    var toast = document.querySelector(selector);
    if (!toast) return;

    var timer = toastTimers.get(toastId);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(toastId);
    }

    toast.classList.add("is-leaving");
    window.setTimeout(function () {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 180);
  }

  function scheduleToastRemoval(toastEl, toastId, duration) {
    if (!duration || duration <= 0) return;
    var timer = window.setTimeout(function () {
      dismissToast(toastId);
    }, duration);
    toastTimers.set(toastId, timer);
  }

  function showToast(message, options) {
    if (!message) return;
    var opts = options || {};
    var variant = opts.variant || "danger";
    var title = opts.title || getToastTitle(variant);
    var duration = Number.isFinite(opts.duration) ? opts.duration : 3200;
    var toastId = opts.id || "toast-" + ++toastCounter;
    var viewport = getToastViewport();

    var toast = document.createElement("div");
    toast.className = "player-toast player-toast--" + variant;
    toast.dataset.toastId = toastId;
    toast.setAttribute("role", "status");

    var safeTitle = escapeHtml(title);
    var safeMessage = escapeHtml(message);

    toast.innerHTML =
      '<div class="player-toast__body">' +
      '<div class="player-toast__title">' +
      safeTitle +
      "</div>" +
      '<div class="player-toast__message">' +
      safeMessage +
      "</div>" +
      "</div>" +
      '<button type="button" class="player-toast__close" aria-label="' +
      escapeHtml(t("toast.dismiss", null, "Dismiss notification")) +
      '">&times;</button>';

    var closeButton = toast.querySelector(".player-toast__close");
    if (closeButton) {
      closeButton.addEventListener("click", function () {
        dismissToast(toastId);
      });
    }

    viewport.appendChild(toast);
    scheduleToastRemoval(toast, toastId, duration);
    return toastId;
  }

  function initPlayer() {
    var playButton = document.getElementById("play");
    var modeButton = document.getElementById("modeButton");
    var likeButton = document.getElementById("likeButton");
    var progressBar = document.getElementById("progress");
    var volumeBar = document.getElementById("volume");
    var volumeLabel = document.getElementById("volumeLabel");
    var progressLabel = document.getElementById("progressLabel");
    songName = document.getElementById("songname") as HTMLElement | null;
    var notitle = document.getElementById("notitle");
    var currentfileName = document.getElementById("filename");
    var patternView = document.getElementById("patternview");
    var likeBoxBtn = document.getElementById("likeBoxBtn");
    var likeBoxSpinner = document.getElementById("likeBoxSpinner");
    var loading001 = document.getElementById("loading001");
    var submitjson = document.getElementById("submitjson");
    var authModal = document.getElementById("authModal");
    var authStatus = document.getElementById("authStatus");
    var authLoginForm = document.getElementById("authLoginForm");
    var authRegisterForm = document.getElementById("authRegisterForm");
    var authOpenLogin = document.getElementById("authOpenLogin");
    var authOpenRegister = document.getElementById("authOpenRegister");
    var authLogout = document.getElementById("authLogout");
    var authUserLabel = document.getElementById("authUserLabel");
    var useVueAuth =
      typeof window !== "undefined" && window.__useVueAuth === true;

    function setAuthMessage(message, kind) {
      if (useVueAuth || !authStatus) return;
      authStatus.textContent = message || "";
      authStatus.className = message
        ? "mt-3 alert alert-" + (kind || "danger")
        : "mt-3";
    }

    function setAuthState(name) {
      username = name || "";
      if (useVueAuth) {
        return;
      }
      if (authUserLabel) {
        authUserLabel.textContent = username
          ? t(
            "auth.signedInAs",
            { username: username },
            "Signed in as {username}",
          )
          : t("auth.notSignedIn", null, "Not signed in");
      }
      if (authLogout) authLogout.classList.toggle("d-none", !username);
      if (authOpenLogin) authOpenLogin.classList.toggle("d-none", !!username);
      if (authOpenRegister)
        authOpenRegister.classList.toggle("d-none", !!username);
      if (authOpenRegister)
        authOpenRegister.classList.toggle("d-none", !!username);
    }

    async function refreshAuth() {
      // First try to read from the global Vue auth store (single source of truth)
      if (typeof window !== "undefined" && window.__authStore) {
        var store = window.__authStore;
        const wasLoggedIn = !!username;
        setAuthState(store.loggedIn ? (store.username || "") : "");
        if (!wasLoggedIn && store.loggedIn) {
          syncLocalStorageHistoryToServer();
        }
        return;
      }
      // Fallback: fetch from server (only during initial load before Vue store is ready)
      try {
        const data = await nuxtFetch("/api/auth/me");
        if (data && data.loggedIn) {
          const wasLoggedIn = !!username;
          setAuthState(data.username || "");
          if (!wasLoggedIn && data.loggedIn) {
            syncLocalStorageHistoryToServer();
          }
        } else {
          setAuthState("");
        }
      } catch (error) {
        setAuthState("");
      }
    }

    async function submitAuth(path, payload) {
      try {
        return await nuxtFetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (error: any) {
        const errorMessage =
          error?.data?.statusMessage ||
          error?.data?.message ||
          t("errors.requestFailed", null, "Request failed.");
        throw new Error(errorMessage);
      }
    }

    if (!useVueAuth && authOpenLogin) {
      authOpenLogin.addEventListener("click", function () {
        setAuthMessage("");
        var loginTab = document.getElementById("authLoginTab");
        if (loginTab) loginTab.click();
      });
    }

    if (!useVueAuth && authOpenRegister) {
      authOpenRegister.addEventListener("click", function () {
        setAuthMessage("");
        var registerTab = document.getElementById("authRegisterTab");
        if (registerTab) registerTab.click();
      });
    }

    if (!useVueAuth && authLogout) {
      authLogout.addEventListener("click", async function () {
        try {
          await nuxtFetch("/api/auth/logout", {
            method: "POST",
            credentials: "include",
          });
        } finally {
          setAuthState("");
        }
      });
    }

    if (!useVueAuth && authLoginForm) {
      authLoginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        setAuthMessage("");
        var formData = new FormData(authLoginForm);
        var loginUser = String(formData.get("username") || "").trim();
        var loginPass = String(formData.get("password") || "");
        try {
          var data = await submitAuth("/api/auth/login", {
            username: loginUser,
            password: loginPass,
          });
          setAuthState(data.username || loginUser);
          setAuthMessage(
            t("auth.status.loggedIn", null, "Logged in."),
            "success",
          );
          if (window.closeAuthModal) {
            window.closeAuthModal();
          }

          authLoginForm.reset();
        } catch (error) {
          setAuthMessage(
            error.message || t("auth.status.loginFailed", null, "Login failed."),
            "danger",
          );
        }
      });
    }

    if (!useVueAuth && authRegisterForm) {
      authRegisterForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        setAuthMessage("");
        var formData = new FormData(authRegisterForm);
        var registerUser = String(formData.get("username") || "").trim();
        var registerPass = String(formData.get("password") || "");
        var registerPass2 = String(formData.get("passwordConfirm") || "");
        if (registerPass !== registerPass2) {
          setAuthMessage(
            t("auth.status.passwordMismatch", null, "Passwords do not match."),
            "danger",
          );
          return;
        }
        try {
          var data = await submitAuth("/api/auth/register", {
            username: registerUser,
            password: registerPass,
          });
          setAuthState(data.username || registerUser);
          setAuthMessage(
            t("auth.status.accountCreated", null, "Account created."),
            "success",
          );
          if (window.closeAuthModal) {
            window.closeAuthModal();
          }

          authRegisterForm.reset();
        } catch (error) {
          setAuthMessage(
            error.message ||
            t("auth.status.registrationFailed", null, "Registration failed."),
            "danger",
          );
        }
      });
    }

    refreshAuth();

    // Listen for auth state changes from the Vue auth store
    // This keeps the legacy username variable in sync with login/logout
    if (typeof window !== "undefined") {
      window.addEventListener("auth:state-changed", function (event) {
        var detail = event && event.detail;
        if (detail) {
          const wasLoggedIn = !!username;
          setAuthState(detail.loggedIn ? (detail.username || "") : "");
          // If currently viewing favorites and musicList changed, auto-refresh
          if (fmusicListActive === 1 && Array.isArray(detail.musicList)) {
            fmusicList = detail.musicList;
            matchedData = fmusicList;
            scheduleRenderPlaylist(currentPage);
          }
          // 如果之前未登录，现在登录了，则自动同步本地播放历史到服务端
          if (!wasLoggedIn && detail.loggedIn) {
            syncLocalStorageHistoryToServer();
          }
        }
      });
    }

    let currentPage = 1; // Initialize current page
    const itemsPerPage = 50; // Number of items per page
    const playlistTable = document.querySelector("#playlist tbody");
    const pageInput = document.querySelector("#pageInput");
    const totalPagesSpan = document.querySelector("#totalPages");
    const pageRangeSummary = document.querySelector("#pageRangeSummary");
    const sortSelect = document.querySelector("#sortSelect");
    const channelsSelect = document.querySelector("#channelsSelect");
    const sizeSelect = document.querySelector("#sizeSelect");
    const searchInput = document.querySelector("#searchInput");
    const pagePrevButton = document.querySelector("#pagePrev");
    const pageMinus10Button = document.querySelector("#pageMinus10");
    const pagePlus10Button = document.querySelector("#pagePlus10");
    const pageNextButton = document.querySelector("#pageNext");
    const pageStepButtons = Array.from(
      document.querySelectorAll("[data-page-step]"),
    );
    let isPageInputEditing = false;
    let lastRenderSignature = {
      page: null,
      sortType: null,
      dataRef: null,
      totalPages: null,
      totalItems: null,
    };

    function formatCount(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return "0";
      return Math.max(0, Math.floor(num)).toLocaleString();
    }

    function formatTime(seconds) {
      var totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
      var minutes = Math.floor(totalSeconds / 60);
      var secs = totalSeconds % 60;
      return minutes + ":" + String(secs).padStart(2, "0");
    }

    function getProgressTimeText() {
      var durationText =
        lastDurationSeconds > 0 ? formatTime(lastDurationSeconds) : "--:--";
      return formatTime(lastElapsedSeconds) + " / " + durationText;
    }

    function updateProgressLabel(progressPct) {
      if (!progressLabel) return;
      var pct = Math.round(clampProgress(progressPct));
      var timeText = getProgressTimeText();
      progressLabel.textContent = t(
        "player.progressLabel",
        { value: pct, time: timeText },
        "Progress: {value}%. {time}",
      );
    }

    function updateVolumeLabel(value) {
      if (!volumeLabel) return;
      var pct = Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
      volumeLabel.textContent = t(
        "player.volumeLabel",
        { value: pct },
        "Volume: {value}%",
      );
    }

    function btSetVolume() {
      if (!volumeBar) return;
      var svolume = Number(volumeBar.value);
      if (isChiptune3Mode && chiptune3Player) {
        chiptune3Player.setVolume(svolume / 100);
      }
      if (
        !BassoonTracker ||
        !BassoonTracker.audio ||
        !BassoonTracker.audio.masterVolume
      ) {
        return;
      }
      BassoonTracker.audio.masterVolume.gain.cancelScheduledValues(0);
      BassoonTracker.audio.masterVolume.gain.setValueAtTime(
        svolume / 100,
        0,
      );
    }

    if (sortSelect) {
      sortSelect.value = String(sortType);
    }
    if (channelsSelect) {
      channelsSelect.value = "all";
    }
    if (sizeSelect) {
      sizeSelect.value = "all";
    }

    var volume = (volumeBar.value = svolume);
    var periodNoteTable = {};
    var periodFinetuneTable = {};
    var nameNoteTable = {};
    var noteNames = [];
    var FTNotes = [];
    var FTPeriods = [];
    var lastProgressEmit = 0;
    var lastPatternRender = 0;
    var lastTimeEmit = 0;
    var durationFixedSeconds = 0;
    var timelineTotalRows = 0;
    var timelineTotalSeconds = 0;
    var timelineRowOffsets = [];
    var timelineRowCounts = [];
    var timelineCumulativeSeconds = [0];
    var timelineReady = false;

    function resetTimeline() {
      timelineTotalRows = 0;
      timelineTotalSeconds = 0;
      timelineRowOffsets = [];
      timelineRowCounts = [];
      timelineCumulativeSeconds = [0];
      timelineReady = false;
      durationFixedSeconds = 0;
    }

    function getInitialTempo() {
      var bpm =
        typeof BassoonTracker.getBPM === "function"
          ? Number(BassoonTracker.getBPM())
          : 125;
      var speed =
        typeof BassoonTracker.getAmigaSpeed === "function"
          ? Number(BassoonTracker.getAmigaSpeed())
          : 6;

      if (!Number.isFinite(bpm) || bpm <= 0) bpm = 125;
      if (!Number.isFinite(speed) || speed <= 0) speed = 6;

      return { bpm: bpm, speed: speed };
    }

    function applyTempoChangesForRow(rowData, bpm, speed) {
      if (!Array.isArray(rowData)) {
        return { bpm: bpm, speed: speed };
      }

      var nextBpm = bpm;
      var nextSpeed = speed;
      for (var ch = 0; ch < rowData.length; ch++) {
        var cell = rowData[ch];
        if (!cell || cell.effect !== 0x0f || typeof cell.param !== "number") {
          continue;
        }
        var param = cell.param;
        if (param > 0 && param <= 32) {
          nextSpeed = param;
        } else if (param > 32) {
          nextBpm = param;
        }
      }

      if (!Number.isFinite(nextBpm) || nextBpm <= 0) nextBpm = bpm || 125;
      if (!Number.isFinite(nextSpeed) || nextSpeed <= 0) nextSpeed = speed || 6;
      return { bpm: nextBpm, speed: nextSpeed };
    }

    function buildTimelineFromSong(song) {
      resetTimeline();
      if (
        !song ||
        !Array.isArray(song.patternTable) ||
        !Array.isArray(song.patterns)
      ) {
        return;
      }

      var tempo = getInitialTempo();
      var bpm = tempo.bpm;
      var speed = tempo.speed;
      var songPositions = Number(song.length) || song.patternTable.length || 0;

      for (var songPos = 0; songPos < songPositions; songPos++) {
        var patternIndex = song.patternTable[songPos];
        var pattern = song.patterns[patternIndex];
        if (!Array.isArray(pattern) || pattern.length === 0) {
          timelineRowOffsets[songPos] = timelineTotalRows;
          timelineRowCounts[songPos] = 0;
          continue;
        }

        timelineRowOffsets[songPos] = timelineTotalRows;
        timelineRowCounts[songPos] = pattern.length;

        for (var row = 0; row < pattern.length; row++) {
          var rowData = pattern[row];
          var nextTempo = applyTempoChangesForRow(rowData, bpm, speed);
          bpm = nextTempo.bpm;
          speed = nextTempo.speed;

          var tickSeconds = 2.5 / bpm;
          var rowSeconds = speed * tickSeconds;
          if (!Number.isFinite(rowSeconds) || rowSeconds < 0) rowSeconds = 0;

          timelineTotalRows += 1;
          timelineCumulativeSeconds[timelineTotalRows] =
            (timelineCumulativeSeconds[timelineTotalRows - 1] || 0) + rowSeconds;
        }
      }

      timelineTotalSeconds = timelineCumulativeSeconds[timelineTotalRows] || 0;
      durationFixedSeconds = timelineTotalSeconds;
      timelineReady = timelineTotalRows > 0 && timelineTotalSeconds > 0;
    }

    function clampProgress(progressPct) {
      return Math.max(0, Math.min(100, Number(progressPct) || 0));
    }

    function getRowIndexFromProgress(progressPct) {
      if (!timelineTotalRows) return 0;
      var pct = clampProgress(progressPct);
      var rawIndex = Math.round((timelineTotalRows * pct) / 100);
      if (rawIndex < 0) return 0;
      if (rawIndex > timelineTotalRows) return timelineTotalRows;
      return rawIndex;
    }

    function getRowIndexFromState(state) {
      if (!timelineReady || !state) return null;
      var songPos = Number(state.songPos);
      var patternPos = Number(state.patternPos);
      if (
        !Number.isFinite(songPos) ||
        songPos < 0 ||
        songPos >= timelineRowOffsets.length
      ) {
        return null;
      }

      var baseRow = timelineRowOffsets[songPos] || 0;
      var rowCount = timelineRowCounts[songPos] || 0;
      if (rowCount <= 0) return baseRow;

      if (!Number.isFinite(patternPos)) patternPos = 0;
      if (patternPos < 0) patternPos = 0;
      if (patternPos >= rowCount) patternPos = rowCount - 1;
      return baseRow + patternPos;
    }

    function getElapsedSecondsForRowIndex(rowIndex) {
      if (!timelineReady) return 0;
      var idx = Number(rowIndex);
      if (!Number.isFinite(idx)) idx = 0;
      idx = Math.max(0, Math.min(timelineTotalRows, Math.floor(idx)));
      return timelineCumulativeSeconds[idx] || 0;
    }

    function emitTimeUpdateFromProgress(
      progressPct,
      isScrubbing,
      rowIndexOverride,
    ) {
      var pct = clampProgress(progressPct);
      var now = Date.now();
      if (!isScrubbing && now - lastTimeEmit < 200) return;

      var duration =
        timelineTotalSeconds > 0 ? timelineTotalSeconds : durationFixedSeconds;
      var rowIndex =
        typeof rowIndexOverride === "number"
          ? rowIndexOverride
          : getRowIndexFromProgress(pct);
      var elapsed = timelineReady
        ? getElapsedSecondsForRowIndex(rowIndex)
        : duration > 0
          ? (duration * pct) / 100
          : 0;
      var remaining = duration > 0 ? Math.max(0, duration - elapsed) : 0;
      emitPlayerUiEvent("time-update", {
        elapsedSeconds: elapsed,
        durationSeconds: duration,
        remainingSeconds: remaining,
      });
      lastElapsedSeconds = elapsed;
      lastDurationSeconds = duration;
      updateProgressLabel(pct);

      if (!isScrubbing) lastTimeEmit = now;
    }

    function getModeLabel(mode) {
      switch (mode) {
        case 0:
          return t("player.mode.stopAfter", null, "Stop");
        case 2:
          return t("player.mode.inOrder", null, "In Order");
        case 3:
          return t("player.mode.loopOne", null, "Loop One");
        case 1:
        default:
          return t("player.mode.shuffle", null, "Shuffle");
      }
    }

    function applyLocaleToUi() {
      if (authUserLabel) {
        authUserLabel.textContent = username
          ? t(
            "auth.signedInAs",
            { username: username },
            "Signed in as {username}",
          )
          : t("auth.notSignedIn", null, "Not signed in");
      }
      if (playButton) {
        playButton.innerHTML = isPlayingUi
          ? t("player.pause", null, "Pause")
          : t("player.play", null, "Play");
      }
      if (modeButton) {
        modeButton.textContent = getModeLabel(playmode);
        emitPlayerUiEvent("mode-change", {
          playmode: playmode,
          modeLabel: modeButton.textContent,
        });
      }
      updateProgressLabel(progressBar ? progressBar.value : 0);
      updateVolumeLabel(volumeBar ? volumeBar.value : svolume);
      if (typeof updatePagerUi === "function") {
        var totalPages = getTotalPages();
        var safeTotalPages = Math.max(1, totalPages);
        updatePagerUi(totalPages, safeTotalPages);
      }
      clearScope();
    }

    switchMode();
    updateUiSettings();
    emitPlayerUiEvent("volume-change", {
      volume: Number(volumeBar ? volumeBar.value : svolume),
    });
    emitPlayerUiEvent("progress-change", {
      progress: Number(progressBar ? progressBar.value : 0),
      isScrubbing: false,
    });
    emitPlayerUiEvent("play-state", { isPlaying: false });
    emitPlayerUiEvent("track-loading", { isTrackLoading: false });
    emitTimeUpdateFromProgress(progressBar ? progressBar.value : 0, false);
    applyLocaleToUi();
    if (typeof window !== "undefined") {
      window.addEventListener("i18n:changed", applyLocaleToUi);
    }
    // builds a lookup table to get the displayed note for each period

    for (var i = -8; i < 8; i++) {
      periodFinetuneTable[i] = {};
    }

    for (var key in NOTEPERIOD) {
      if (NOTEPERIOD.hasOwnProperty(key)) {
        var note = NOTEPERIOD[key];
        periodNoteTable[note.period] = note;
        nameNoteTable[note.name] = note;
        noteNames.push(note.name);

        // build fineTune table
        if (note.tune) {
          for (i = -8; i < 8; i++) {
            var table = periodFinetuneTable[i];
            var index = i + 8;
            table[note.tune[index]] = note.period;
          }
        }
      }
    }

    var ftCounter = 0;
    for (key in FTNOTEPERIOD) {
      if (FTNOTEPERIOD.hasOwnProperty(key)) {
        var ftNote = FTNOTEPERIOD[key];
        if (!ftNote.period) ftNote.period = 1;
        FTNotes.push(ftNote);
        FTPeriods[ftNote.period] = ftCounter;
        if (ftNote.modPeriod) FTPeriods[ftNote.modPeriod] = ftCounter;
        ftCounter++;
      }
    }

    // scope canvas
    var container = document.getElementById("scope");
    var scopeCanvas = document.getElementById("scopeCanvas");
    var scopeFillContainer = scopeCanvas && scopeCanvas.dataset && scopeCanvas.dataset.fill === "true";
    var scopeCssWidth, scopeCssHeight;
    if (scopeFillContainer) {
      scopeCssWidth = Math.max(1, scopeCanvas.clientWidth || (container.clientWidth - 20));
      scopeCssHeight = Math.max(1, scopeCanvas.clientHeight || 110);
    } else {
      scopeCssWidth = container.clientWidth - 20;
      scopeCssHeight = 110;
    }
    var scopeIsIdle = false;
    var scopeDpr = Math.min(window.devicePixelRatio || 1, 2);
    var lastScopeTickTime = 0;
    var scopeWidth = (scopeCanvas.width = Math.max(1, Math.floor(scopeCssWidth * scopeDpr)));
    var scopeHeight = (scopeCanvas.height = Math.max(1, Math.floor(scopeCssHeight * scopeDpr)));
    if (!scopeFillContainer) {
      scopeCanvas.style.width = "100%";
      scopeCanvas.style.height = scopeCssHeight + "px";
    }
    var scope = scopeCanvas.getContext("2d", { alpha: true, desynchronized: true });

    // ── Performance caching for renderScope ─────────────────────────────
    var cachedScopeCssW = scopeCssWidth;
    var cachedScopeCssH = scopeCssHeight;
    var cachedScopeDpr = scopeDpr;
    var cachedThemeColors = null as { spectrumStart: string; spectrumEnd: string; waveformColor: string; borderColor: string; } | null;
    var cachedThemeReadAt = 0;

    function updateScopeDimensions() {
      if (!scopeCanvas || !container) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var nextCssW, nextCssH;
      if (scopeFillContainer) {
        nextCssW = scopeCanvas.clientWidth || (container.clientWidth - 20);
        nextCssH = scopeCanvas.clientHeight || scopeCssHeight;
      } else {
        nextCssW = container.clientWidth - 20;
        nextCssH = scopeCssHeight;
      }
      if (nextCssW < 1) nextCssW = 1;
      if (nextCssH < 1) nextCssH = 1;

      cachedScopeCssW = nextCssW;
      cachedScopeCssH = nextCssH;
      cachedScopeDpr = dpr;
    }

    var scopeResizeObserver = null;
    if (typeof ResizeObserver !== "undefined" && container) {
      scopeResizeObserver = new ResizeObserver(function () {
        updateScopeDimensions();
      });
      scopeResizeObserver.observe(container);
    }
    window.addEventListener("resize", updateScopeDimensions);

    // ── WebGL pattern renderer (lazy-init) ──────────────────────────────────
    var patternGLRenderer: InstanceType<typeof PatternWebGLRenderer> | null = null;
    var patternGLFailed = false;
    function cleanupPatternGL() {
      if (patternGLRenderer) {
        try {
          patternGLRenderer.destroy();
        } catch (e) {
          console.error("Failed to destroy patternGLRenderer:", e);
        }
        patternGLRenderer = null;
      }
    }

    // ── WebGL renderer (lazy-init) ──────────────────────────────────────
    var scopeGLRenderer: InstanceType<typeof ScopeWebGLRenderer> | null = null;
    var scopeGLFailed = false; // once set, never retry WebGL
    function tryInitScopeGL() {
      if (scopeGLFailed || scopeGLRenderer) return;
      var glCanvas = null;
      try {
        // Create a separate canvas for WebGL to keep the 2D ctx alive for fallback
        glCanvas = document.createElement("canvas");
        glCanvas.width = scopeCanvas.width;
        glCanvas.height = scopeCanvas.height;
        glCanvas.style.cssText = scopeCanvas.style.cssText;
        glCanvas.style.position = "absolute";
        glCanvas.style.inset = "0";
        glCanvas.style.width = "100%";
        glCanvas.style.height = "100%";
        glCanvas.style.zIndex = "2";
        glCanvas.id = "scopeCanvasGL";
        glCanvas.className = scopeCanvas.className;
        glCanvas.dataset.fill = scopeCanvas.dataset.fill || "false";
        scopeCanvas.parentNode?.insertBefore(glCanvas, scopeCanvas.nextSibling);
        // Hide original canvas but keep it alive for fallback
        scopeCanvas.style.display = "none";

        scopeGLRenderer = ScopeWebGLRenderer.create(glCanvas);
      } catch (e) {
        console.error("[webgl-vis] ScopeGL init failed, falling back to 2D canvas. Error:", e);
        showWebGLErrorBanner("主示波器 WebGL 初始化错误 (ScopeGL Init)", e);
        if (glCanvas) glCanvas.remove();
        scopeGLFailed = true;
        scopeGLRenderer = null;
        scopeCanvas.style.display = "";
      }
    }

    // Attempt lazy init on first scope render
    // ────────────────────────────────────────────────────────────────────

    clearScope();

    scopeCanvas.onclick = function () {
      scopeActive = !scopeActive;
      clearScope();
    };
    // Also bind click on GL canvas overlay
    var glOverlay = document.getElementById("scopeCanvasGL");
    if (glOverlay) {
      glOverlay.onclick = function () {
        scopeActive = !scopeActive;
        clearScope();
      };
    }

    function buildPlaylistLookupMap() {
      playlistLookupMap.clear();
      if (Array.isArray(playlistdata)) {
        playlistdata.forEach((entry) => {
          if (entry && entry.fn) {
            playlistLookupMap.set(entry.fn, entry.id);
          }
        });
      }
    }

    function getTotalPages() {
      return serverTotalPages;
    }

    function clampPage(page, safeTotalPages) {
      const next = Number(page);
      if (!Number.isFinite(next)) return 1;
      return Math.min(safeTotalPages, Math.max(1, Math.floor(next)));
    }

    function setPagerDisabled(button, disabled) {
      if (!button) return;
      button.disabled = Boolean(disabled);
      button.setAttribute("aria-disabled", disabled ? "true" : "false");
    }

    function updatePagerUi(totalPages, safeTotalPages) {
      const totalItems = serverTotalItems;
      const hasResults = totalPages > 0 && totalItems > 0;
      const atFirst = !hasResults || currentPage <= 1;
      const atLast = !hasResults || currentPage >= safeTotalPages;

      if (totalPagesSpan) {
        totalPagesSpan.textContent = hasResults
          ? `/ ${formatCount(safeTotalPages)}`
          : "/ 0";
      }
      if (pageInput) {
        pageInput.max = safeTotalPages;
        if (!isPageInputEditing) {
          pageInput.value = hasResults ? currentPage : 1;
        }
      }
      if (pageRangeSummary) {
        if (!hasResults) {
          pageRangeSummary.textContent = t(
            "playlist.pageRangeEmpty",
            null,
            "0 / 0",
          );
        } else {
          const startItem = (currentPage - 1) * itemsPerPage + 1;
          const endItem = Math.min(totalItems, currentPage * itemsPerPage);
          pageRangeSummary.textContent = t(
            "playlist.pageRange",
            {
              start: formatCount(startItem),
              end: formatCount(endItem),
              total: formatCount(totalItems),
            },
            `${formatCount(startItem)}-${formatCount(endItem)} / ${formatCount(
              totalItems,
            )}`,
          );
        }
      }

      setPagerDisabled(pagePrevButton, atFirst);
      setPagerDisabled(pageMinus10Button, atFirst);
      setPagerDisabled(pageNextButton, atLast);
      setPagerDisabled(pagePlus10Button, atLast);
    }

    function setListModeLoading(isLoading) {
      const loading = Boolean(isLoading);
      if (likeBoxBtn) likeBoxBtn.disabled = loading;
      if (likeBoxSpinner) {
        likeBoxSpinner.classList.toggle("hidden", !loading);
      }
      emitPlayerUiEvent("playlist-loading", {
        isPlaylistLoading: loading,
        playlistMode: fmusicListActive,
      });
    }

    // 使用 requestAnimationFrame 优化渲染时机
    let renderScheduled = false;
    let pendingRenderPage = null;

    // 异步向服务端请求当前页的歌曲列表
    async function loadSongsFromServer(page) {
      setListModeLoading(true);
      try {
        const search = searchInput ? searchInput.value.trim() : "";
        const sortVal = sortSelect ? sortSelect.value : "0";
        const extensionsVal = getExtensionsVal();
        const channelsVal = channelsSelect ? channelsSelect.value : "all";
        const sizeVal = sizeSelect ? sizeSelect.value : "all";
        const trackerNameInput = document.querySelector("#trackerNameInput");
        const trackerNameVal = trackerNameInput ? trackerNameInput.value.trim() : "";
        const modeVal = fmusicListActive; // 0 全部, 1 收藏, 2 历史记录

        let filenamesParam = "";
        if (modeVal === 2) {
          const hist = getAllHistory() || [];
          filenamesParam = hist.map(item => item.fn).join(',');
        }

        const params = new URLSearchParams({
          page: String(page),
          limit: String(itemsPerPage),
          search,
          sort: sortVal,
          extensions: extensionsVal,
          channels: channelsVal,
          size: sizeVal,
          tracker_name: trackerNameVal,
          mode: String(modeVal),
          filenames: filenamesParam
        });

        const res = await nuxtFetch(`/api/songs?${params.toString()}`);

        if (res.songs && Array.isArray(res.songs) && typeof window !== "undefined") {
          const cache = (window as any).__tmaCache || {};
          res.songs.forEach((song: any) => {
            if (song.tma_metadata && song.fn) {
              cache[song.fn] = song.tma_metadata;
            }
          });
        }

        serverTotalItems = res.total;
        serverTotalPages = res.totalPages;
        currentPage = res.page;
        playlistdata = matchedData = res.songs;

        renderPlaylistSync();
      } catch (error) {
        console.error("Failed to load songs from server", error);
      } finally {
        setListModeLoading(false);
      }
    }

    function formatBytes(bytes) {
      if (bytes === null || bytes === undefined || isNaN(bytes)) return "-";
      if (bytes === 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    function renderPlaylistSync() {
      if (!playlistTable || !Array.isArray(matchedData)) return;

      const totalPages = serverTotalPages;
      const safeTotalPages = Math.max(1, totalPages);
      const totalItems = serverTotalItems;
      currentPage = clampPage(currentPage, safeTotalPages);

      const sameRender =
        lastRenderSignature.page === currentPage &&
        lastRenderSignature.sortType === sortType &&
        lastRenderSignature.dataRef === matchedData &&
        lastRenderSignature.totalPages === totalPages &&
        lastRenderSignature.totalItems === totalItems;

      if (sameRender) {
        updatePagerUi(totalPages, safeTotalPages);
        return;
      }

      lastRenderSignature = {
        page: currentPage,
        sortType: sortType,
        dataRef: matchedData,
        totalPages: totalPages,
        totalItems: totalItems,
      };

      processData = matchedData.slice();
      const pageItems = processData;

      const fragment = document.createDocumentFragment();
      pageItems.forEach((file) => {
        const row = document.createElement("tr");
        const numCell = document.createElement("td");
        const contentCell = document.createElement("td");
        const filePath = mainFilePath + file.fn;

        // 序号列（使序号文本在左侧居中对齐）
        numCell.className = "text-center font-bold text-text-muted/80 align-middle py-3";
        const num = document.createElement("span");
        num.textContent = file.id !== undefined ? file.id : "";
        numCell.appendChild(num);

        // 内容列
        contentCell.className = "py-2";

        // 上行：歌名或文件名替代
        const titleDiv = document.createElement("div");
        titleDiv.className = "font-medium text-[0.88rem] text-text truncate max-w-full leading-snug";
        titleDiv.textContent = file.title ? file.title.trim() : file.fn;
        titleDiv.title = titleDiv.textContent;
        contentCell.appendChild(titleDiv);

        // 下行：其它信息小字
        const infoDiv = document.createElement("div");
        infoDiv.className = "text-text-muted text-[0.72rem] mt-1 truncate max-w-full font-mono flex flex-wrap items-center gap-x-2 gap-y-0.5";

        const formatVal = file.tracker_format || (file.extension || "").toUpperCase();
        const channelsVal = file.channels !== null ? `${file.channels} Ch` : "";
        const sizeVal = formatBytes(file.file_size);

        // 解析乐器和备注文本 (Internal Texts)
        let insts: string[] = [];
        try {
          if (file.instruments) {
            insts = typeof file.instruments === 'string' ? JSON.parse(file.instruments) : file.instruments;
          } else {
            const metaObj = typeof file.metadata === 'string' ? JSON.parse(file.metadata) : (file.metadata || {});
            insts = Array.isArray(metaObj.instruments) ? metaObj.instruments : [];
          }
        } catch (e) {
          // 容错
        }

        // 元数据标签样式包装
        if (formatVal) {
          const badge = document.createElement("span");
          badge.className = "bg-surface-3 text-text-soft px-1 rounded text-[0.65rem] font-bold shrink-0";
          badge.textContent = formatVal;
          infoDiv.appendChild(badge);
        }

        if (channelsVal) {
          const badge = document.createElement("span");
          badge.className = "text-text-muted shrink-0";
          badge.textContent = channelsVal;
          infoDiv.appendChild(badge);
        }

        if (sizeVal) {
          const sep = document.createElement("span");
          sep.className = "text-border-strong select-none shrink-0";
          sep.textContent = "|";
          infoDiv.appendChild(sep);

          const badge = document.createElement("span");
          badge.className = "text-text-muted shrink-0";
          badge.textContent = sizeVal;
          infoDiv.appendChild(badge);
        }



        // 如果第一行显示了歌名，在下行把文件名也显示为附加信息
        if (file.title && file.fn) {
          const sep = document.createElement("span");
          sep.className = "text-border-strong select-none shrink-0";
          sep.textContent = "|";
          infoDiv.appendChild(sep);

          const fileSpan = document.createElement("span");
          fileSpan.className = "text-text-muted/70 truncate";
          fileSpan.textContent = file.fn;
          fileSpan.title = file.fn;
          infoDiv.appendChild(fileSpan);
        }

        contentCell.appendChild(infoDiv);

        row.setAttribute("onclick", `play('${filePath}', ${file.id})`);
        row.appendChild(numCell);
        row.appendChild(contentCell);
        fragment.appendChild(row);
      });

      playlistTable.innerHTML = "";
      playlistTable.appendChild(fragment);

      updatePagerUi(totalPages, safeTotalPages);
    }

    function renderPlaylist(page) {
      loadSongsFromServer(page);
    }

    // 优化的异步渲染函数，使用 requestAnimationFrame
    function scheduleRenderPlaylist(page) {
      pendingRenderPage = page;
      if (!renderScheduled) {
        renderScheduled = true;
        requestAnimationFrame(() => {
          renderScheduled = false;
          if (pendingRenderPage !== null) {
            renderPlaylist(pendingRenderPage);
            pendingRenderPage = null;
          }
        });
      }
    }

    function handleJumpToPageClick() {
      if (!pageInput) return;
      const requestedPage = parseInt(pageInput.value, 10);
      const totalPages = getTotalPages();
      const safeTotalPages = Math.max(1, totalPages);
      currentPage = clampPage(requestedPage, safeTotalPages);
      scheduleRenderPlaylist(currentPage);
    }

    function handlePagerStep(step) {
      const totalPages = getTotalPages();
      const safeTotalPages = Math.max(1, totalPages);
      let targetPage = currentPage;

      if (step === "first") {
        targetPage = 1;
      } else if (step === "last") {
        targetPage = safeTotalPages;
      } else {
        const delta = parseInt(step, 10);
        if (Number.isFinite(delta)) {
          targetPage = currentPage + delta;
        }
      }

      currentPage = clampPage(targetPage, safeTotalPages);
      scheduleRenderPlaylist(currentPage);
    }

    pageStepButtons.forEach((button) => {
      button.addEventListener("click", () => {
        handlePagerStep(button.dataset.pageStep);
      });
    });

    // First Load
    function firstLoadRender() {
      setListModeLoading(false);
      if (loading001) {
        loading001.style.display = "none";
      }
      currentPage = 1;
      loadSongsFromServer(currentPage).then(() => {
        const initialTrack = getTrackFromLocation();
        const initialId = initialTrack ? Number(initialTrack.id) : NaN;
        if (Number.isFinite(initialId) && initialId > 0) {
          nuxtFetch(`/api/song/${initialId}`).then(res => {
            if (res && res.fileName) {
              if (currentfileName) {
                currentfileName.innerHTML =
                  res.fileName +
                  " " +
                  t("player.loadedSuffix", null, "Loaded");
              }
              if (songName) {
                songName.innerHTML = res.fileName;
              }
            }
          }).catch(err => {
            console.error("Failed to load initial song name", err);
          });
        }
      });
    }

    firstLoadRender();

    // fetch('playlist.json')
    //     .then(response => response.json())
    //     .then(data => {
    //         playlistdata = data;
    //         matchedData = data;
    //         renderPlaylist(currentPage);
    //         pageInput.value = currentPage;
    //     })
    //     .catch(error => console.error('Error loading playlist:', error));

    var analyser = BassoonTracker.audio.context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.15;
    var scopeFreqBuf = new Uint8Array(analyser.frequencyBinCount);
    var scopeTimeBuf = new Float32Array(analyser.fftSize);
    // Pre-allocated mix buffers — reused every frame to avoid GC pressure.
    var scopeMixBuf = new Float32Array(analyser.fftSize);
    var scopeChBuf = new Float32Array(analyser.fftSize);
    var SCOPE_BARS = 56;
    var scopeBarSnapshot = new Float32Array(SCOPE_BARS);
    var scopeBarPeaks = new Float32Array(SCOPE_BARS);
    var glBarVals = new Float32Array(SCOPE_BARS);
    var glPeakVals = new Float32Array(SCOPE_BARS);
    var scopeCachedSpectrumGrad: CanvasGradient | null = null;
    var scopeCachedWaveGrad: CanvasGradient | null = null;
    var scopeCachedThemeKey = "";
    var scopeCachedBgKey = 0;

    BassoonTracker.init(true);

    // ── 响度均衡: create BassoonTracker normalization nodes ──────────
    var ctx: AudioContext = BassoonTracker.audio.context;
    var btNormGainNode = ctx.createGain();
    btNormGainNode.gain.value = 1.0;
    var btMeasurerNode = ctx.createAnalyser();
    btMeasurerNode.fftSize = 2048;
    btMeasurerNode.smoothingTimeConstant = 0; // instant RMS, smoothing handled by AGC

    // Set as active nodes (BassoonTracker is the default initial engine)
    _normGainNode = btNormGainNode;
    _normMeasurer = btMeasurerNode;

    function setupChannelAnalysers() {
      try {
        if (isChiptune3Mode || isNativeMode) return;
        var ctx = BassoonTracker.audio && BassoonTracker.audio.context;
        var chains = BassoonTracker.audio && (BassoonTracker.audio as any).filterChains;
        if (!ctx || !Array.isArray(chains) || chains.length === 0) return;

        var activeCount = chains.length;
        if (typeof BassoonTracker.getTrackCount === "function") {
          var tc = Number(BassoonTracker.getTrackCount());
          if (Number.isFinite(tc) && tc > 0) {
            activeCount = Math.min(chains.length, tc);
          }
        }

        var existing = (window as any).__channelAnalysers || [];
        var nextList = [];
        for (var ci = 0; ci < activeCount; ci++) {
          var chain = chains[ci];
          if (!chain || typeof chain.output !== "function") continue;
          var slot = existing[ci];
          if (slot && slot.analyser && slot.chain === chain) {
            nextList.push(slot);
            continue;
          }
          var chAnalyser = ctx.createAnalyser();
          chAnalyser.fftSize = 4096;
          chAnalyser.smoothingTimeConstant = 0.25;
          try {
            chain.output().connect(chAnalyser);
          } catch (err) {
            // already connected or unsupported — skip
          }
          nextList.push({ analyser: chAnalyser, chain: chain });
        }

        // Disconnect analysers we no longer need so silenced chains stop driving them.
        for (var di = 0; di < existing.length; di++) {
          var oldSlot = existing[di];
          if (!oldSlot || !oldSlot.analyser) continue;
          var stillUsed = false;
          for (var nj = 0; nj < nextList.length; nj++) {
            if (nextList[nj] === oldSlot) {
              stillUsed = true;
              break;
            }
          }
          if (!stillUsed && oldSlot.chain && typeof oldSlot.chain.output === "function") {
            try {
              oldSlot.chain.output().disconnect(oldSlot.analyser);
            } catch (err) {
              // already disconnected
            }
          }
        }

        (window as any).__channelAnalysers = nextList;
        emitPlayerUiEvent("channels-ready", { count: nextList.length });
      } catch (err) {
        // never let scope wiring break playback
      }
    }
    setupChannelAnalysers();
    window.addEventListener("player:track-change", function () {
      setupChannelAnalysers();
      // setTrackCount may finalize a tick later; re-sync once the song settles.
      setTimeout(setupChannelAnalysers, 80);
    });
    if (!BassoonTracker.audio.context) {
      songName.innerHTML = t(
        "player.webAudioUnsupported",
        null,
        "Sorry<br>Your browser does not support WebAudio.<br>Supported browsers are Chrome, Firefox, Safari, and Edge",
      );
    } else {
      // var demoMod = "../demomods/StardustMemories.mod";

      var startTime;
      var wasPlaying;
      var patternLength;
      var songLength;
      var currentSong;

      // ─── 现代音频格式（MP3/OGG/WAV/FLAC）双引擎支持 ───────────────────
      var NATIVE_AUDIO_EXTS = new Set(['mp3', 'ogg', 'wav', 'flac']);
      var nativeAudioEl: HTMLAudioElement | null = null;
      var nativeAudioSource: MediaElementAudioSourceNode | null = null;
      var nativeAudioGain: GainNode | null = null;
      var nativeAudioRafId: number | null = null;
      var isNativeMode = false; // true 时表示当前播放的是现代格式
      var nativeScrubbing = false; // 拖动进度条时为 true，阻止 rAF 覆盖进度条值
      var nativeWasPlaying = false; // native 模式专用的拖动前播放状态

      // ─── Chiptune3 引擎（.it / .s3m / .umx）三引擎支持 ─────────────────
      var CHIPTUNE_EXTS = new Set(['it', 's3m', 'umx', 'mptm', 'stm', 'mtm', 'ptm', 'far', 'ult', '669', 'amf', 'dsm', 'mdl', 'med', 'okt', 'psm', 'dbm', 'imf', 'j2b', 'mo3', 'gdm', 'stp', 'sfx', 'sfx2', 'itp', 'dtm', 'mt2', 'symmod', 'c67', 'ams', 'stx', '667', 'cba', 'digi', 'dmf', 'dsym', 'etx', 'fc', 'fc13', 'fc14', 'fmt', 'ftm', 'gmc', 'gt2', 'gtk', 'ice', 'ims', 'm15', 'mms', 'mus', 'oxm', 'plm', 'pt36', 'puma', 'rtm', 'smod', 'st26', 'stk', 'wow', 'xmf', 'mdz', 's3z', 'xmz', 'itz', 'mptmz', 'mdr']);
      var isChiptune3Mode = false;
      var chiptune3Player: any = null;
      var chiptune3PendingUrl = '';
      var chiptune3Scrubbing = false;
      var chiptune3WasPlaying = false;

      class DummyAnalyser {
        _fftSize: number;
        smoothingTimeConstant: number;
        vuVal: number;
        waveformIntensity: number;
        noteVal: number;
        phase: number;
        pcmData: number[] | null;
        realWaveData: Float32Array | null;
        constructor() {
          this._fftSize = 4096;
          this.smoothingTimeConstant = 0.25;
          this.vuVal = 0;
          this.waveformIntensity = 0;
          this.noteVal = 0;
          this.phase = Math.random() * Math.PI * 2;
          this.pcmData = null;
          this.realWaveData = null;
        }
        get fftSize() { return this._fftSize; }
        set fftSize(val) { this._fftSize = val; }
        getFloatTimeDomainData(buf: Float32Array) {
          var len = buf.length;
          var vu = this.vuVal;
          // 优先使用从 Wasm 发送过来的真实子通道音频数据
          // (must come before VU gate so real data is never blocked)
          if (this.realWaveData && this.realWaveData.length > 0) {
            var dataLen = this.realWaveData.length; // 512 (WAVEFORM_SAMPLES)
            // Match computeEnvelope() view window: stretch 512 samples
            // to fill the central ~3000-sample region so the trigger
            // search range [halfView..len-halfView] sees real data.
            var viewLen = Math.min(3000, Math.floor(len * 0.95));
            var offset = Math.floor((len - viewLen) / 2);
            for (var i = 0; i < viewLen; i++) {
              var srcPos = (i / (viewLen - 1)) * (dataLen - 1);
              var srcIdx = Math.floor(srcPos);
              var frac = srcPos - srcIdx;
              var v0 = this.realWaveData[srcIdx];
              var v1 = srcIdx + 1 < dataLen ? this.realWaveData[srcIdx + 1] : v0;
              buf[offset + i] = v0 + (v1 - v0) * frac;
            }
            if (offset > 0) buf.fill(0, 0, offset);
            if (offset + viewLen < len) buf.fill(0, offset + viewLen);
            return;
          }
          if (!isPlayingUi || vu < 0.005) {
            buf.fill(0);
            return;
          }
          if (this.pcmData && this.pcmData.length > 0) {
            var pcmLen = this.pcmData.length;
            var maxVal = 0;
            for (var k = 0; k < pcmLen; k++) {
              var abs = Math.abs(this.pcmData[k]);
              if (abs > maxVal) maxVal = abs;
            }
            if (maxVal > 1e-5) {
              var note = this.noteVal || 0;
              var freqHz = note > 0 ? 16.35159783 * Math.pow(2, (note - 12) / 12) : 261.63;
              if (freqHz > 15000) freqHz = 15000;
              var step = (2 * Math.PI * freqHz) / 44100;

              for (var i = 0; i < len; i++) {
                this.phase += step;
                if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;

                var phaseRatio = this.phase / (2 * Math.PI);
                var pos = phaseRatio * pcmLen;
                var idx = Math.floor(pos);
                var frac = pos - idx;
                var val1 = this.pcmData[idx % pcmLen];
                var val2 = this.pcmData[(idx + 1) % pcmLen];
                var interpolated = val1 * (1 - frac) + val2 * frac;
                buf[i] = (interpolated / maxVal) * vu;
              }
              return;
            }
          }
          var note = this.noteVal || 0;
          if (note === 0) {
            var lastVal = 0;
            for (var i = 0; i < len; i++) {
              var white = Math.random() - 0.5;
              lastVal = lastVal * 0.72 + white * 0.28;
              buf[i] = lastVal * 1.5 * vu;
            }
            return;
          }
          var freqHz = 16.35159783 * Math.pow(2, (note - 12) / 12);
          if (freqHz > 15000) freqHz = 15000;
          var step = (2 * Math.PI * freqHz) / 44100;
          if (note < 40) {
            for (var i = 0; i < len; i++) {
              this.phase += step;
              if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
              buf[i] = ((this.phase / Math.PI) - 1.0) * vu;
            }
          } else if (note >= 40 && note < 72) {
            for (var i = 0; i < len; i++) {
              this.phase += step;
              if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
              var val = this.phase < Math.PI ? 0.55 : -0.55;
              var noise = (Math.random() - 0.5) * 0.08;
              buf[i] = (val + noise) * vu;
            }
          } else {
            for (var i = 0; i < len; i++) {
              this.phase += step;
              if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
              buf[i] = Math.sin(this.phase) * vu;
            }
          }
        }
      }

      function createChiptune3Player(ctx: AudioContext) {
        var processNode: any = null;
        var gainNode = ctx.createGain();
        // 初始化时从 volumeBar 读取实际设置的音量，避免首次播放音量不正确
        gainNode.gain.value = volumeBar ? (Number(volumeBar.value) / 100) : 1;
        // ── 响度均衡: AGC nodes for Chiptune3 ────────────────────────
        var normGainNode = ctx.createGain();
        normGainNode.gain.value = 1.0;
        var measurerNode = ctx.createAnalyser();
        measurerNode.fftSize = 2048;
        measurerNode.smoothingTimeConstant = 0;
        var handlers: Record<string, Function[]> = {};
        var currentTime = 0;
        var duration = 0;
        var isPlaying = false;
        var metadata: any = null;
        var generation = 0;

        function fireEvent(name: string, data?: any) {
          if (handlers[name]) {
            handlers[name].forEach(function (h) { h(data); });
          }
        }

        ctx.audioWorklet.addModule('/script/chiptune3.worklet.js')
          .then(function () {
            processNode = new AudioWorkletNode(ctx, 'libopenmpt-processor', {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [2]
            });
            processNode.port.onmessage = function (msg: any) {
              var msgGen = msg.data.gen || 0;
              // Ignore messages from stale generations (old track that was stopped)
              if (msgGen > 0 && msgGen !== generation) return;
              var cmd = msg.data.cmd;
              if (cmd === 'meta') {
                metadata = msg.data.meta;
                duration = msg.data.meta.dur || 0;
                fireEvent('onMetadata', metadata);
              } else if (cmd === 'pos') {
                currentTime = msg.data.pos || 0;
                fireEvent('onProgress', msg.data);
              } else if (cmd === 'channel-waves') {
                var waves = msg.data.waves;
                var intensities = msg.data.intensities;
                var analysers = (window as any).__channelAnalysers;
                if (analysers && Array.isArray(waves)) {
                  var limit = Math.min(analysers.length, waves.length);
                  for (var i = 0; i < limit; i++) {
                    analysers[i].analyser.realWaveData = waves[i] || null;
                    // C-side dB-scaled RMS intensity [0,1] — drives LED/glow
                    if (intensities && i < intensities.length) {
                      analysers[i].analyser.waveformIntensity = intensities[i] || 0;
                    }
                  }
                }
              } else if (cmd === 'end') {
                isPlaying = false;
                var analysers = (window as any).__channelAnalysers;
                if (analysers) {
                  for (var i = 0; i < analysers.length; i++) {
                    analysers[i].analyser.realWaveData = null;
                  }
                }
                fireEvent('onEnded');
              } else if (cmd === 'err') {
                fireEvent('onError', msg.data);
              }
            };
            processNode.connect(normGainNode);
            normGainNode.connect(gainNode);
            gainNode.connect(ctx.destination);
            gainNode.connect(analyser); // scope reads post-user-volume
            processNode.connect(measurerNode); // RMS measurement pre-gain
            fireEvent('onInitialized');
          })
          .catch(function (err) {
            console.error('Failed to load chiptune3 worklet:', err);
            fireEvent('onError', err);
          });

        return {
          load: function (url: string) {
            isPlaying = true;
            generation++;
            var myGen = generation;
            fetch(url)
              .then(function (res) { return res.arrayBuffer(); })
              .then(function (buf) {
                if (processNode && myGen === generation) {
                  processNode.port.postMessage({ cmd: 'play', val: buf, gen: myGen });
                }
              })
              .catch(function (err) {
                if (myGen === generation) {
                  fireEvent('onError', { type: 'Load', error: err });
                }
              });
          },
          stop: function () {
            isPlaying = false;
            if (processNode) processNode.port.postMessage({ cmd: 'stop' });
            var analysers = (window as any).__channelAnalysers;
            if (analysers) {
              for (var i = 0; i < analysers.length; i++) {
                analysers[i].analyser.realWaveData = null;
              }
            }
          },
          pause: function () {
            isPlaying = false;
            if (processNode) processNode.port.postMessage({ cmd: 'pause' });
          },
          unpause: function () {
            isPlaying = true;
            if (processNode) processNode.port.postMessage({ cmd: 'unpause' });
          },
          seek: function (seconds: number) {
            if (processNode) processNode.port.postMessage({ cmd: 'setPos', val: seconds });
          },
          setVolume: function (vol: number) {
            gainNode.gain.value = vol;
          },
          on: function (name: string, handler: Function) {
            if (!handlers[name]) handlers[name] = [];
            handlers[name].push(handler);
          },
          getDuration: function () { return duration; },
          getCurrentTime: function () { return currentTime; },
          getMetadata: function () { return metadata; },
          getIsPlaying: function () { return isPlaying; },
          getGeneration: function () { return generation; },
          getNormGainNode: function () { return normGainNode; },
          getMeasurerNode: function () { return measurerNode; }
        };
      }

      function initChiptune3Player() {
        if (chiptune3Player) return;
        var ctx = BassoonTracker.audio.context;
        chiptune3Player = createChiptune3Player(ctx);

        chiptune3Player.on('onInitialized', function () {
          // 同步当前音量（AudioWorklet 节点在 addModule 异步完成后才就绪）
          if (volumeBar) {
            chiptune3Player.setVolume(Number(volumeBar.value) / 100);
          }
          if (chiptune3PendingUrl) {
            var url = chiptune3PendingUrl;
            chiptune3PendingUrl = '';
            chiptune3Player.load(url);
          }
        });

        chiptune3Player.on('onMetadata', function (meta: any) {
          if (!meta || !meta.song) return;
          var song = meta.song;
          var songTitle = meta.title || meta.name || fileNameplaying;
          if (songName) songName.innerHTML = songTitle;
          titlekeyWords = songTitle + '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0';

          if (notitle) notitle.innerHTML = t('player.trackNumber', { number: numno }, 'No. {number}');
          if (currentfileName) currentfileName.innerHTML = '';
          updateHeart();
          updateTrackUrl(numno, fileNameplaying);
          addToHistory(fileNameplaying);

          var chNum = song.channels.length || 0;
          var dummyChannels: any[] = [];
          for (var i = 0; i < chNum; i++) {
            dummyChannels.push({
              analyser: new DummyAnalyser(),
              chain: null
            });
          }
          (window as any).__channelAnalysers = dummyChannels;
          emitPlayerUiEvent("channels-ready", { count: chNum });

          var mappedPatterns = song.patterns.map(function (pat: any) {
            return pat.rows.map(function (row: any) {
              return row.map(function (ch: any) {
                return {
                  note: ch[0],
                  instrument: ch[1],
                  volEffect: ch[2],
                  effect: ch[3],
                  volVal: ch[4],
                  param: ch[5]
                };
              });
            });
          });

          currentSong = {
            title: songTitle,
            patterns: mappedPatterns,
            patternTable: song.orders.map(function (o: any) { return o.pat; }),
            typeId: 'chiptune3'
          };

          var modArchiveUrl = 'https://modarchive.org/index.php?request=search&query=' +
            encodeURIComponent(fileNameplaying) + '&submit=Find&search_type=filename_or_songtitle';
          var gameUrl = '/music/musicGame/?ml=\'' + encodeURIComponent(fileNameplaying) + "'";
          var downloadUrl = '/api/music/' + encodeURIComponent(fileNameplaying);

          emitPlayerUiEvent('track-meta', {
            channels: song.channels || [],
            instruments: song.instruments || [],
            samples: song.samples || [],
            orders: song.orders || [],
            patterns: song.patterns || [],
            numSubsongs: song.numSubsongs || 0,
            songs: meta.songs || [],
            dur: meta.dur || 0,
            title: songTitle,
            type: meta.type || '',
            tracker: meta.tracker || '',
            artist: meta.artist || '',
            date: meta.date || '',
            message: meta.message || '',
            container: meta.container || '',
          });

          emitPlayerUiEvent('track-change', {
            trackNumber: numno,
            songTitle: songTitle,
            fileName: fileNameplaying,
            fileUrl: chiptune3PendingUrl || '',
            downloadUrl: downloadUrl,
            gameUrl: gameUrl,
            modArchiveUrl: modArchiveUrl,
          });
          emitPlayerUiEvent('track-loading', { isTrackLoading: false });

          var dur = meta.dur || 0;
          emitPlayerUiEvent('time-update', { elapsedSeconds: 0, durationSeconds: Math.floor(dur), remainingSeconds: Math.floor(dur) });
          if (progressBar) progressBar.value = '0';
          emitPlayerUiEvent('progress-change', { progress: 0, isScrubbing: false });

          if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
          isPlayingUi = true; // 确保示波器 DummyAnalyser 可以输出波形数据
          emitPlayerUiEvent('play-state', { isPlaying: true });
          isTrackReady = true;
        });

        chiptune3Player.on('onProgress', function (data: any) {
          if (chiptune3Scrubbing) return;
          var dur = chiptune3Player.getDuration() || 0;
          var current = data.pos || 0;
          var pct = dur > 0 ? (current / dur) * 100 : 0;
          percentage = pct; // 同步进度，使网页标题正确显示"进度% | 滚动歌名"

          if (progressBar) progressBar.value = String(pct);
          var now = Date.now();
          if (now - lastProgressEmit > 150) {
            emitPlayerUiEvent('progress-change', { progress: pct, isScrubbing: false });
            var elapsedSec = Math.floor(current);
            var durationSec = Math.floor(dur);
            var remainSec = Math.max(0, durationSec - elapsedSec);
            emitPlayerUiEvent('time-update', {
              elapsedSeconds: elapsedSec,
              durationSeconds: durationSec,
              remainingSeconds: remainSec,
            });
            lastProgressEmit = now;
          }

          if (data.chVol && Array.isArray(data.chVol)) {
            var analysers = (window as any).__channelAnalysers;
            if (analysers) {
              var patternIdx = (currentSong && currentSong.patternTable) ? currentSong.patternTable[data.order] : -1;
              var pattern = (currentSong && currentSong.patterns) ? currentSong.patterns[patternIdx] : null;
              var row = pattern ? pattern[data.row] : null;
              var limit = Math.min(analysers.length, data.chVol.length);
              var hasPCM = data.chPCM && Array.isArray(data.chPCM);
              for (var i = 0; i < limit; i++) {
                var left = data.chVol[i].left || 0;
                var right = data.chVol[i].right || 0;
                var vu = Math.max(left, right);
                analysers[i].analyser.vuVal = vu;

                if (hasPCM) {
                  analysers[i].analyser.pcmData = data.chPCM[i] || null;
                } else {
                  analysers[i].analyser.pcmData = null;
                }

                if (row && row[i]) {
                  var noteVal = row[i].note || 0;
                  if (noteVal > 0 && noteVal <= 120) {
                    analysers[i].analyser.noteVal = noteVal;
                  } else if (noteVal === 121 || noteVal === 254 || noteVal === 255) {
                    analysers[i].analyser.noteVal = 0;
                  }
                }
              }
            }
          }

          if (currentSong && currentSong.typeId === 'chiptune3') {
            var pNow = Date.now();
            if (pNow - lastPatternRender > 100) {
              renderPattern({
                songPos: data.order,
                patternPos: data.row
              });
              lastPatternRender = pNow;
            }
          }
        });

        chiptune3Player.on('onEnded', function () {
          isPlayingUi = false;
          if (playButton) playButton.innerHTML = t('player.play', null, 'Play');
          emitPlayerUiEvent('play-state', { isPlaying: false });
          toNewSong();
        });

        chiptune3Player.on('onError', function (err: any) {
          console.error('Chiptune3 error:', err);
          isTrackReady = false;
          emitPlayerUiEvent('track-loading', { isTrackLoading: false });
          if (songName) songName.innerHTML = t('errors.requestFailed', null, 'Request failed.');
          showToast(t('errors.requestFailed', null, 'Request failed.'), { variant: 'error', title: t('toast.error', null, 'Error'), duration: 2400 });
        });
      }

      function playChiptune3(url: string) {
        if (progressBar) progressBar.value = '0';
        chiptune3Scrubbing = false;
        chiptune3WasPlaying = false;
        lastPatternRender = 0;
        percentage = 0; // 新歌从0进度开始，避免显示旧引擎残留百分比
        cleanupChiptune3();
        cleanupNativeAudio();
        if (typeof BassoonTracker !== 'undefined' && BassoonTracker.isPlaying()) {
          BassoonTracker.stop();
        }

        var ctx = BassoonTracker.audio.context;
        if (ctx && ctx.state === 'suspended') {
          ctx.resume();
        }

        isChiptune3Mode = true;
        firstplay = true;
        currentNormGain = 1.0; // ── 响度均衡: reset AGC for new track
        isTrackReady = false;
        pendingUrl = url;
        emitPlayerUiEvent('track-loading', { isTrackLoading: true });
        cleanupPatternGL();
        if (patternView) patternView.innerHTML = '';
        var patternElement = document.getElementById('pattern');
        if (patternElement) patternElement.classList.remove('loaded');

        var fileNameCh = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
        var fileNameCh = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
        fileNameplaying = fileNameCh;
        fileExtensionPlaying = fileNameCh.substring(fileNameCh.lastIndexOf('.') + 1);
        titlekeyWords = fileNameCh + '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0';

        var curPlayItem = playlistdata ? playlistdata.find(function (item) { return item.fn === fileNameCh; }) : null;
        numno = currentPlayTrackId || (curPlayItem ? curPlayItem.id : '');
        listNo = matchedData ? matchedData.findIndex(function (item) { return item.fn === fileNameCh; }) : -1;

        chiptune3PendingUrl = url;
        var wasFirstInit = !chiptune3Player;
        if (wasFirstInit) {
          initChiptune3Player();
        } else {
          // 切换曲目时同步当前音量
          if (volumeBar) {
            chiptune3Player.setVolume(Number(volumeBar.value) / 100);
          }
          chiptune3Player.load(url);
        }
        // ── 响度均衡: activate Chiptune3 norm nodes ─────────────────
        if (chiptune3Player && chiptune3Player.getNormGainNode) {
          _normGainNode = chiptune3Player.getNormGainNode();
          _normMeasurer = chiptune3Player.getMeasurerNode();
        }
      }

      function cleanupChiptune3() {
        chiptune3Scrubbing = false;
        chiptune3WasPlaying = false;
        if (chiptune3Player) {
          chiptune3Player.stop();
        }
        isChiptune3Mode = false;
        (window as any).__channelAnalysers = [];
        emitPlayerUiEvent("channels-ready", { count: 0 });
        // ── 响度均衡: reset to BassoonTracker nodes ─────────────────
        _normGainNode = btNormGainNode;
        _normMeasurer = btMeasurerNode;
      }

      function cleanupNativeAudio() {
        if (nativeAudioRafId !== null) {
          cancelAnimationFrame(nativeAudioRafId);
          nativeAudioRafId = null;
        }
        if (nativeAudioEl) {
          nativeAudioEl.pause();
          nativeAudioEl.onloadedmetadata = null;
          nativeAudioEl.oncanplaythrough = null;
          nativeAudioEl.onended = null;
          nativeAudioEl.onerror = null;
          // 清空 src 前先移除监听器，避免 error 事件
          nativeAudioEl.src = '';
        }
        if (nativeAudioSource) {
          try { nativeAudioSource.disconnect(); } catch (e) { }
          nativeAudioSource = null;
        }
        if (nativeAudioGain) {
          try { nativeAudioGain.disconnect(); } catch (e) { }
          nativeAudioGain = null;
        }
        // 注意：不将 nativeAudioEl 赋 null，避免 GC 前旧引用问题
        nativeAudioEl = null;
        isNativeMode = false;
        nativeScrubbing = false;
        nativeWasPlaying = false;
        // ── 响度均衡: reset to BassoonTracker nodes ─────────────────
        _normGainNode = btNormGainNode;
        _normMeasurer = btMeasurerNode;
        (window as any).__nativeNormGain = null;
        (window as any).__nativeNormMeasurer = null;
      }

      // native 音频模式下同步音量到 gainNode
      function syncNativeVolume() {
        if (!nativeAudioGain || !volumeBar) return;
        var vol = Number(volumeBar.value) / 100;
        nativeAudioGain.gain.cancelScheduledValues(0);
        nativeAudioGain.gain.setValueAtTime(vol, 0);
      }

      function startNativeAudioRaf() {
        if (nativeAudioRafId !== null) cancelAnimationFrame(nativeAudioRafId);
        function tick() {
          if (!nativeAudioEl || !isNativeMode) return;
          var duration = nativeAudioEl.duration || 0;
          var current = nativeAudioEl.currentTime || 0;
          var pct = (duration > 0 && isFinite(duration)) ? (current / duration) * 100 : 0;
          percentage = pct; // 同步进度，使网页标题正确显示"进度% | 滚动歌名"
          // 拖动期间不覆盖用户设置的进度条值
          if (!nativeScrubbing && progressBar) progressBar.value = pct;
          var now = Date.now();
          if (!nativeScrubbing && now - lastProgressEmit > 150) {
            emitPlayerUiEvent('progress-change', { progress: pct, isScrubbing: false });
            var elapsedSec = Math.floor(current);
            var durationSec = isFinite(duration) ? Math.floor(duration) : 0;
            var remainSec = Math.max(0, durationSec - elapsedSec);
            emitPlayerUiEvent('time-update', {
              elapsedSeconds: elapsedSec,
              durationSeconds: durationSec,
              remainingSeconds: remainSec,
            });
            lastProgressEmit = now;
          }
          if (!nativeAudioEl.paused && !nativeAudioEl.ended) {
            nativeAudioRafId = requestAnimationFrame(tick);
          } else {
            nativeAudioRafId = null;
          }
        }
        nativeAudioRafId = requestAnimationFrame(tick);
      }

      function playNativeAudio(url) {
        // 1. 清理旧 native 音频（不调用 BassoonTracker.stop，避免干扰音频图）
        cleanupNativeAudio();
        percentage = 0; // 新歌从0进度开始，避免显示旧引擎残留百分比
        // 停止 BassoonTracker 播放（不调 stop，防止其断开音频节点）
        if (typeof BassoonTracker !== 'undefined' && BassoonTracker.isPlaying()) {
          BassoonTracker.stop();
        }

        isNativeMode = true;
        firstplay = true;
        currentNormGain = 1.0; // ── 响度均衡: reset AGC for new track
        isTrackReady = false;
        pendingUrl = url;
        emitPlayerUiEvent('track-loading', { isTrackLoading: true });
        cleanupPatternGL();
        if (patternView) patternView.innerHTML = '';
        var patternElement = document.getElementById('pattern');
        if (patternElement) patternElement.classList.remove('loaded');

        // 2. 创建 audio 元素（不设置 crossOrigin，同源请求不需要 CORS）
        var audio = new Audio();
        audio.preload = 'auto';
        nativeAudioEl = audio;

        var ctx = BassoonTracker.audio.context;

        // 3. 先设置监听器，再设置 src（避免赚取 HAVE_METADATA 状态时错过事件）
        var fileNameNative = url.substring(url.lastIndexOf('/') + 1);
        fileNameplaying = fileNameNative;
        fileExtensionPlaying = fileNameNative.substring(fileNameNative.lastIndexOf('.') + 1);
        titlekeyWords = fileNameNative + '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0';

        var curPlayItem = playlistdata ? playlistdata.find(function (item) { return item.fn === fileNameNative; }) : null;
        numno = currentPlayTrackId || (curPlayItem ? curPlayItem.id : '');
        listNo = matchedData ? matchedData.findIndex(function (item) { return item.fn === fileNameNative; }) : -1;

        var modArchiveUrl = 'https://modarchive.org/index.php?request=search&query=' +
          encodeURIComponent(fileNameNative) + '&submit=Find&search_type=filename_or_songtitle';
        var gameUrl = '/music/musicGame/?ml=\'' + encodeURIComponent(fileNameNative) + "'";
        var downloadUrl = url;
        var nativeSongTitle = (curPlayItem && curPlayItem.title) ? curPlayItem.title : fileNameNative;
        if (nativeSongTitle) {
          titlekeyWords = nativeSongTitle + '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0';
        }

        function doConnectAndPlay() {
          if (nativeAudioEl !== audio) return; // stale check

          // 4. 创建 Web Audio 节点：必须在 audio 可播放后创建（CORS 策略）
          var src;
          try {
            src = ctx.createMediaElementSource(audio);
          } catch (e) {
            console.warn('createMediaElementSource failed:', e);
            // 降级处理：直接播放，无示波器
            src = null;
          }
          nativeAudioSource = src;

          var gainNode = ctx.createGain();
          nativeAudioGain = gainNode;

          // ── 响度均衡: AGC nodes for Native audio ──────────────────
          var normGainNode = ctx.createGain();
          normGainNode.gain.value = 1.0;
          var measurerNode = ctx.createAnalyser();
          measurerNode.fftSize = 2048;
          measurerNode.smoothingTimeConstant = 0;
          // Store for AGC loop to pick up
          (window as any).__nativeNormGain = normGainNode;
          (window as any).__nativeNormMeasurer = measurerNode;

          if (src) {
            // ── 响度均衡 routing ──────────────────────────────────
            // src → normGainNode → gainNode → destination  (AGC before user volume)
            // gainNode → analyser                           (scope post-user-volume)
            // src → measurerNode                            (RMS pre-gain)
            src.connect(normGainNode);
            normGainNode.connect(gainNode);
            gainNode.connect(ctx.destination);
            gainNode.connect(analyser);
            src.connect(measurerNode);
          }

          // 5. 同步音量
          syncNativeVolume();

          // ── 响度均衡: activate Native norm nodes ─────────────────
          _normGainNode = (window as any).__nativeNormGain || null;
          _normMeasurer = (window as any).__nativeNormMeasurer || null;

          // 6. 上报 UI 事件
          isTrackReady = true;
          if (songName) songName.innerHTML = nativeSongTitle;
          if (notitle) notitle.innerHTML = t('player.trackNumber', { number: numno }, 'No. {number}');
          if (currentfileName) currentfileName.innerHTML = '';
          updateHeart();
          updateTrackUrl(numno, fileNameNative);
          addToHistory(fileNameNative);
          emitPlayerUiEvent('track-change', {
            trackNumber: numno,
            songTitle: nativeSongTitle,
            fileName: fileNameNative,
            fileUrl: url,
            downloadUrl: downloadUrl,
            gameUrl: gameUrl,
            modArchiveUrl: modArchiveUrl,
          });
          emitPlayerUiEvent('track-loading', { isTrackLoading: false });
          var dur = isFinite(audio.duration) ? Math.floor(audio.duration) : 0;
          emitPlayerUiEvent('time-update', { elapsedSeconds: 0, durationSeconds: dur, remainingSeconds: dur });
          if (progressBar) progressBar.value = 0;
          emitPlayerUiEvent('progress-change', { progress: 0, isScrubbing: false });

          // 7. 恢复 AudioContext 并播放
          function doPlay() {
            if (nativeAudioEl !== audio) return;
            var playPromise = audio.play();
            if (playPromise) {
              playPromise.then(function () {
                isPlayingUi = true;
                if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
                emitPlayerUiEvent('play-state', { isPlaying: true });
                startNativeAudioRaf();
              }).catch(function (e) {
                console.warn('native audio play() rejected:', e);
                // 播放失败时保持 UI 状态为停止
                isPlayingUi = false;
                if (playButton) playButton.innerHTML = t('player.play', null, 'Play');
                emitPlayerUiEvent('play-state', { isPlaying: false });
              });
            } else {
              isPlayingUi = true;
              if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
              emitPlayerUiEvent('play-state', { isPlaying: true });
              startNativeAudioRaf();
            }
          }

          if (autoPlay) {
            if (ctx.state === 'suspended') {
              ctx.resume().then(doPlay).catch(doPlay);
            } else {
              doPlay();
            }
          }
        }

        audio.onerror = function () {
          if (nativeAudioEl !== audio) return;
          isTrackReady = false;
          firstplay = false;
          isNativeMode = false;
          emitPlayerUiEvent('track-loading', { isTrackLoading: false });
          if (songName) songName.innerHTML = t('errors.requestFailed', null, 'Request failed.');
          showToast(t('errors.requestFailed', null, 'Request failed.'), { variant: 'error', title: t('toast.error', null, 'Error'), duration: 2400 });
        };

        audio.onended = function () {
          if (nativeAudioEl !== audio) return;
          isPlayingUi = false;
          if (playButton) playButton.innerHTML = t('player.play', null, 'Play');
          emitPlayerUiEvent('play-state', { isPlaying: false });
          if (nativeAudioRafId !== null) { cancelAnimationFrame(nativeAudioRafId); nativeAudioRafId = null; }
          // 播放结束，根据 playmode 处理
          if (playmode === 2) {
            // 循环单曲
            audio.currentTime = 0;
            var ctx2 = BassoonTracker.audio.context;
            function loopPlay() {
              var pp = audio.play();
              if (pp) {
                pp.then(function () {
                  isPlayingUi = true;
                  if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
                  emitPlayerUiEvent('play-state', { isPlaying: true });
                  startNativeAudioRaf();
                }).catch(function (e) { console.warn(e); });
              }
            }
            if (ctx2.state === 'suspended') {
              ctx2.resume().then(loopPlay).catch(loopPlay);
            } else {
              loopPlay();
            }
          } else {
            toNewSong();
          }
        };

        // 8. 使用 canplaythrough 以确保充足缓冲再创建 Web Audio 节点
        //    canplaythrough: 表示浏览器认为可以不中断地播放到结尾
        //    使用 loadedmetadata 作为备用（某些格式可能不触发 canplaythrough）
        var connected = false;
        function onFirstReady() {
          if (connected || nativeAudioEl !== audio) return;
          connected = true;
          doConnectAndPlay();
        }
        audio.addEventListener('canplay', onFirstReady, { once: true });
        audio.addEventListener('loadedmetadata', function () {
          // 强制触发数据更新，确保时长显示正确
          var dur = isFinite(audio.duration) ? Math.floor(audio.duration) : 0;
          emitPlayerUiEvent('time-update', { elapsedSeconds: 0, durationSeconds: dur, remainingSeconds: dur });
        }, { once: true });

        // 9. 设置 src 并加载
        audio.src = url;
        audio.load();
      }
      // ─── FFmpeg 转换播放（引擎3：所有格式转为MP3后播放）───────────────
      var ffmpegFallbackActive = false; // 标记当前是否为降级到FFmpeg的播放

      function playFFmpeg(url: string) {
        cleanupChiptune3();
        cleanupNativeAudio();
        if (typeof BassoonTracker !== 'undefined' && BassoonTracker.isPlaying()) {
          BassoonTracker.stop();
        }
        isNativeMode = false;
        isChiptune3Mode = false;
        ffmpegFallbackActive = true;

        var fileNameFf = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
        fileNameplaying = fileNameFf;
        fileExtensionPlaying = fileNameFf.substring(fileNameFf.lastIndexOf('.') + 1);
        titlekeyWords = fileNameFf + '            ';

        var curPlayItem = playlistdata ? playlistdata.find(function (item: any) { return item.fn === fileNameFf; }) : null;
        numno = currentPlayTrackId || (curPlayItem ? curPlayItem.id : '');
        listNo = matchedData ? matchedData.findIndex(function (item: any) { return item.fn === fileNameFf; }) : -1;

        var modArchiveUrl = 'https://modarchive.org/index.php?request=search&query=' +
          encodeURIComponent(fileNameFf) + '&submit=Find&search_type=filename_or_songtitle';
        var gameUrl = '/music/musicGame/?ml=\'' + encodeURIComponent(fileNameFf) + "'";
        var downloadUrl = url;

        firstplay = true;
        isTrackReady = false;
        pendingUrl = url;
        emitPlayerUiEvent('track-loading', { isTrackLoading: true });
        cleanupPatternGL();
        if (patternView) patternView.innerHTML = '';
        var patternElement = document.getElementById('pattern');
        if (patternElement) patternElement.classList.remove('loaded');

        // Build the convert-mp3 API URL
        var musicPath = url;
        var prefix = '/api/music/';
        var prefixIdx = musicPath.indexOf(prefix);
        if (prefixIdx >= 0) {
          musicPath = musicPath.substring(prefixIdx + prefix.length);
        }
        var mp3Url = '/api/music/convert-mp3?path=' + encodeURIComponent(musicPath);

        // Fetch the converted MP3 and play via native audio
        fetch(mp3Url)
          .then(function (res) {
            if (!res.ok) throw new Error('Conversion failed: HTTP ' + res.status);
            return res.blob();
          })
          .then(function (blob) {
            ffmpegFallbackActive = false;
            var blobUrl = URL.createObjectURL(blob);
            // Reuse native audio playback with the blob URL
            playNativeAudio(blobUrl);
            // Clean up the blob URL after it's loaded
            if (nativeAudioEl) {
              var origOnError = nativeAudioEl.onerror;
              nativeAudioEl.onerror = function () {
                URL.revokeObjectURL(blobUrl);
                if (origOnError) origOnError.call(this);
              };
              var origOnEnded = nativeAudioEl.onended;
              nativeAudioEl.onended = function () {
                URL.revokeObjectURL(blobUrl);
                if (origOnEnded) origOnEnded.call(this);
              };
            }
          })
          .catch(function (err) {
            ffmpegFallbackActive = false;
            console.error('FFmpeg playback failed:', err);
            isTrackReady = false;
            firstplay = false;
            emitPlayerUiEvent('track-loading', { isTrackLoading: false });
            if (songName) songName.innerHTML = t('errors.requestFailed', null, 'Request failed.');
            showToast(t('errors.requestFailed', null, 'Request failed.'), { variant: 'error', title: t('toast.error', null, 'Error'), duration: 2400 });
          });
      }

      // ─── 引擎降级：纯格式驱动，不支持该格式则降级到下一引擎 ──────────
      // Engine 1 (BassoonTracker): 只支持 .xm .mod → 不支持则降级 Engine 2 → 3
      // Engine 2 (Chiptune3):       支持 .xm .mod .it .s3m .umx → 不支持则降级 Engine 3
      // Engine 3 (FFmpeg):          支持几乎所有格式，无降级

      function getEngine(): number {
        return Number(storedSettings.setEngine) || 2;
      }

      // Chiptune3 支持的格式（引擎2模式包括 xm/mod）
      // Chiptune3 (libopenmpt) 支持的全部 tracker 模块格式
      var CHIPTUNE3_ALL_EXTS = new Set([
        'xm', 'mod', 'it', 's3m', 'umx', 'mptm', 'stm', 'mtm', 'ptm', 'far', 'ult',
        '669', 'amf', 'dsm', 'mdl', 'med', 'okt', 'psm', 'dbm', 'imf', 'j2b', 'mo3',
        'gdm', 'stp', 'sfx', 'sfx2', 'itp', 'dtm', 'mt2', 'symmod', 'c67', 'ams', 'stx',
        '667', 'cba', 'digi', 'dmf', 'dsym', 'etx', 'fc', 'fc13', 'fc14', 'fmt', 'ftm',
        'gmc', 'gt2', 'gtk', 'ice', 'ims', 'm15', 'mms', 'mus', 'oxm', 'plm', 'pt36',
        'puma', 'rtm', 'smod', 'st26', 'stk', 'wow', 'xmf', 'mdz', 's3z', 'xmz', 'itz',
        'mptmz', 'mdr'
      ]);
      // BassoonTracker 支持的格式
      var BASSOON_EXTS = new Set(['xm', 'mod']);

      // ────────────────────────────────────────────────────────────────────

      playItem = function (url) {
        ffmpegFallbackActive = false;
        var urlExt = url.substring(url.lastIndexOf('.') + 1).toLowerCase().split('?')[0];
        var engine = getEngine();

        // 原生音频格式始终使用原生播放（不参与引擎降级）
        if (NATIVE_AUDIO_EXTS.has(urlExt)) {
          cleanupChiptune3();
          playNativeAudio(url);
          return;
        }

        // Engine 3: FFmpeg — 几乎所有格式都转为MP3播放
        if (engine === 3) {
          playFFmpeg(url);
          return;
        }

        // Engine 1: BassoonTracker — 只支持 .xm .mod
        if (engine === 1) {
          if (BASSOON_EXTS.has(urlExt)) {
            // BassoonTracker 原生播放
            cleanupNativeAudio();
            cleanupChiptune3();
            playBassoonWithFallback(url);
            return;
          }
          if (CHIPTUNE3_ALL_EXTS.has(urlExt)) {
            // 降级到 Engine 2 (Chiptune3)
            cleanupNativeAudio();
            playChiptune3(url);
            return;
          }
          // 降级到 Engine 3 (FFmpeg)
          playFFmpeg(url);
          return;
        }

        // Engine 2: Chiptune3（默认）— 支持 .xm .mod .it .s3m .umx
        if (engine === 2) {
          if (CHIPTUNE3_ALL_EXTS.has(urlExt)) {
            cleanupNativeAudio();
            playChiptune3(url);
            return;
          }
          // 降级到 Engine 3 (FFmpeg)
          playFFmpeg(url);
          return;
        }

        // 兜底：FFmpeg
        playFFmpeg(url);
      };

      // BassoonTracker 播放（带降级）
      function playBassoonWithFallback(url: string) {
        cleanupNativeAudio();
        cleanupChiptune3();
        stopPlay();
        resetTimeline();
        lastTimeEmit = 0;
        emitTimeUpdateFromProgress(0, false);
        firstplay = true;
        currentNormGain = 1.0; // ── 响度均衡: reset AGC for new track
        isTrackReady = false;
        pendingUrl = url;
        emitPlayerUiEvent("track-loading", {
          isTrackLoading: true,
        });
        cleanupPatternGL();
        if (patternView) {
          patternView.innerHTML = "";
        }
        var patternElement = document.getElementById("pattern");
        if (patternElement) {
          patternElement.classList.remove("loaded");
        }
        BassoonTracker.load(url, false, function () {
          currentSong =
            typeof BassoonTracker !== "undefined" &&
              typeof BassoonTracker.getSong === "function"
              ? BassoonTracker.getSong()
              : null;
          if (!currentSong || !Array.isArray(currentSong.patterns)) {
            isTrackReady = false;
            firstplay = false;
            emitPlayerUiEvent("track-loading", { isTrackLoading: false });
            if (songName) {
              songName.innerHTML = t(
                "errors.requestFailed",
                null,
                "Request failed.",
              );
            }
            showToast(t("errors.requestFailed", null, "Request failed."), {
              variant: "error",
              title: t("toast.error", null, "Error"),
              duration: 2400,
            });
            return;
          }
          isTrackReady = true;
          songName.innerHTML = currentSong.title;

          fileNameplaying = url.substring(url.lastIndexOf("/") + 1);
          fileExtensionPlaying = fileNameplaying.substring(
            fileNameplaying.lastIndexOf(".") + 1,
          );

          titlekeyWords =
            fileNameplaying +
            "\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0";
          if (currentSong.title) {
            titlekeyWords =
              currentSong.title +
              "\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0";
          }

          const curPlayItem = playlistdata ? playlistdata.find((item) => item.fn === fileNameplaying) : null;
          numno = currentPlayTrackId || (curPlayItem ? curPlayItem.id : "");
          listNo = matchedData ? matchedData.findIndex((item) => item.fn === fileNameplaying) : -1;
          var modArchiveUrl =
            "https://modarchive.org/index.php?request=search&query=" +
            encodeURIComponent(fileNameplaying) +
            "&submit=Find&search_type=filename_or_songtitle";
          var gameUrl =
            "/music/musicGame/?ml='" + encodeURIComponent(fileNameplaying) + "'";
          var downloadUrl = url;
          var songTitle =
            currentSong && currentSong.title
              ? currentSong.title
              : fileNameplaying;

          emitPlayerUiEvent("track-change", {
            trackNumber: numno,
            songTitle: songTitle,
            fileName: fileNameplaying,
            fileUrl: url,
            downloadUrl: downloadUrl,
            gameUrl: gameUrl,
            modArchiveUrl: modArchiveUrl,
          });
          emitPlayerUiEvent("track-loading", { isTrackLoading: false });

          notitle.innerHTML = t(
            "player.trackNumber",
            { number: numno },
            "No. {number}",
          );
          currentfileName.innerHTML = "";
          addToHistory(fileNameplaying);
          var modlink = document.createElement("a");

          var Downloadlink = document.createElement("a");
          Downloadlink.setAttribute("href", encodeURIComponent(url));
          Downloadlink.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-download" viewBox="0 0 16 16"> <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/> <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/> </svg>&nbsp;&nbsp;';
          Downloadlink.setAttribute("target", "_blank");
          Downloadlink.style.textDecoration = "none";
          currentfileName.appendChild(Downloadlink);

          var gameLink = document.createElement("a");
          gameLink.setAttribute(
            "href",
            "/music/musicGame/?ml='" + encodeURIComponent(fileNameplaying) + "'",
          );
          gameLink.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-controller" viewBox="0 0 16 16"><path d="M11.5 6.027a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm-1.5 1.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm2.5-.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm-1.5 1.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm-6.5-3h1v1h1v1h-1v1h-1v-1h-1v-1h1v-1z"/><path d="M3.051 3.26a.5.5 0 0 1 .354-.613l1.932-.518a.5.5 0 0 1 .62.39c.655-.079 1.35-.117 2.043-.117.72 0 1.443.041 2.12.126a.5.5 0 0 1 .622-.399l1.932.518a.5.5 0 0 1 .306.729c.14.09.266.19.373.297.408.408.78 1.05 1.095 1.772.32.733.599 1.591.805 2.466.206.875.34 1.78.364 2.606.024.816-.059 1.602-.328 2.21a1.42 1.42 0 0 1-1.445.83c-.636-.067-1.115-.394-1.513-.773-.245-.232-.496-.526-.739-.808-.126-.148-.25-.292-.368-.423-.728-.804-1.597-1.527-3.224-1.527-1.627 0-2.496.723-3.224 1.527-.119.131-.242.275-.368.423-.243.282-.494.575-.739.808-.398.38-.877.706-1.513.773a1.42 1.42 0 0 1-1.445-.83c-.27-.608-.352-1.395-.329-2.21.024-.826.16-1.73.365-2.606.206-.875.486-1.733.805-2.466.315-.722.687-1.364 1.094-1.772a2.34 2.34 0 0 1 .433-.335.504.504 0 0 1-.028-.079zm2.036.412c-.877.185-1.469.443-1.733.708-.276.276-.587.783-.885 1.465a13.748 13.748 0 0 0-.748 2.295 12.351 12.351 0 0 0-.339 2.406c-.022.755.062 1.368.243 1.776a.42.42 0 0 0 .426.24c.327-.034.61-.199.929-.502.212-.202.4-.423.615-.674.133-.156.276-.323.44-.504C4.861 9.969 5.978 9.027 8 9.027s3.139.942 3.965 1.855c.164.181.307.348.44.504.214.251.403.472.615.674.318.303.601.468.929.503a.42.42 0 0 0 .426-.241c.18-.408.265-1.02.243-1.776a12.354 12.354 0 0 0-.339-2.406 13.753 13.753 0 0 0-.748-2.295c-.298-.682-.61-1.19-.885-1.465-.264-.265-.856-.523-1.733-.708-.85-.179-1.877-.27-2.913-.27-1.036 0-2.063.091-2.913.27z"/></svg>&nbsp;&nbsp;';
          // gameLink.setAttribute('target', '_blank');
          gameLink.style.textDecoration = "none";
          currentfileName.appendChild(gameLink);

          modlink.setAttribute("href", modArchiveUrl);
          modlink.innerHTML = fileNameplaying;
          modlink.setAttribute("target", "_blank");
          modlink.style.textDecoration = "none";
          currentfileName.appendChild(modlink);

          updateHeart();

          updateTrackUrl(numno, fileNameplaying);
          patternLength =
            currentSong.patterns[currentSong.patternTable[0]].length;
          // songLength = 0
          // for (let i = 0; i < currentSong.length; i++) {
          //     songLength += currentSong.patterns[currentSong.patternTable[i]].length;
          // }
          var sPatterns = [];
          for (let i = 0; i < currentSong.length; i++) {
            for (
              let j = 0;
              j < currentSong.patterns[currentSong.patternTable[i]].length;
              j++
            ) {
              sPatterns.push(
                currentSong.patterns[currentSong.patternTable[i]][j],
              );
            }
          }
          songLength = sPatterns.length;
          // songLength -= 1
          buildTimelineFromSong(currentSong);
          lastTimeEmit = 0;
          emitTimeUpdateFromProgress(0, false);

          // show initial pattern
          var patternElement = document.getElementById("pattern");
          if (patternElement) {
            patternElement.classList.add("loaded");
          }
          renderPattern({ patternPos: 0, songPos: 0 });
          // only autostart
          if (autoPlay) togglePlay();
        });
      };

      // setup UI
      function bindSettingsUI() {
        submitjson = document.getElementById("submitjson");
        if (!submitjson) return;
        submitjson.onclick = function () {
          // Persist settings.
          storedSettings.setNav = getCheckboxValue("setNav");
          storedSettings.setScope = getCheckboxValue("setScope");
          storedSettings.setTotalScope = getCheckboxValue("setTotalScope");
          storedSettings.setChannelScope = getCheckboxValue("setChannelScope");
          storedSettings.setPattern = getCheckboxValue("setPattern");
          storedSettings.setComment = getCheckboxValue("setComment");
          storedSettings.setIntroduce = getCheckboxValue("setIntroduce");
          storedSettings.forcedVolume = getCheckboxValue("setForcedVolume");
          storedSettings.setVolume = getInputValue("setVolume");
          storedSettings.setLooptimes = getInputValue("setLooptimes");
          storedSettings.setMusicSource = getInputValue("setMusicSource");
          storedSettings.setEngine = getInputValue("setEngine");
          localStorage.setItem("player_settings", JSON.stringify(storedSettings));
          // 更新音乐文件路径
          if (storedSettings.setMusicSource) {
            mainFilePath = storedSettings.setMusicSource;
            if (!mainFilePath.endsWith("/")) {
              mainFilePath += "/";
            }
          } else {
            mainFilePath = "/api/music/";
          }
          updateUiSettings();
        };
      }
      window.bindSettingsUI = bindSettingsUI;
      bindSettingsUI();

      playButton.onclick = function () {
        if (startMediaBridgeImpl) startMediaBridgeImpl();
        autoPlay = true;
        if (!firstplay) {
          const initialTrack = getTrackFromLocation();
          const initialId = initialTrack ? Number(initialTrack.id) : NaN;
          if (Number.isFinite(initialId) && initialId > 0) {
            emitPlayerUiEvent('track-loading', { isTrackLoading: true });
            if (songName) songName.innerHTML =
              t('player.loadingSong', null, 'Loading song ...') +
              ' <span class="spinner-border text-primary" role="status" aria-hidden="true" style="border-width: 4px;"></span>';
            nuxtFetch(`/api/song/${initialId}`).then(res => {
              if (res && res.fileName) {
                play(mainFilePath + res.fileName, initialId);
              } else {
                randomPlay();
              }
            }).catch(() => {
              randomPlay();
            });
          } else {
            randomPlay();
          }
        } else {
          if (!isTrackReady) {
            if (pendingUrl) {
              play(pendingUrl);
            } else {
              randomPlay();
            }
            return;
          }
          togglePlay();
        }
      };

      modeButton.onclick = function () {
        playmode++;
        if (playmode >= 4) playmode = 0;
        switchMode();
      };

      if (sortSelect) {
        sortSelect.addEventListener("change", () => {
          const nextSortType = parseInt(sortSelect.value, 10);
          switchSortType(nextSortType);
        });
      }

      // 格式筛选用事件委托——FormatFilterPanel 的隐藏 input 可能在当前脚本之后才挂载
      document.addEventListener("change", (e) => {
        const target = e.target;
        if (target && target.id === "extensionsInput") {
          currentPage = 1;
          if (pageInput) pageInput.value = currentPage;
          loadSongsFromServer(currentPage);
        }
      });

      if (channelsSelect) {
        channelsSelect.addEventListener("change", () => {
          currentPage = 1;
          if (pageInput) pageInput.value = currentPage;
          loadSongsFromServer(currentPage);
        });
      }

      if (sizeSelect) {
        sizeSelect.addEventListener("change", () => {
          currentPage = 1;
          if (pageInput) pageInput.value = currentPage;
          loadSongsFromServer(currentPage);
        });
      }

      const trackerNameInput = document.querySelector("#trackerNameInput");
      if (trackerNameInput) {
        trackerNameInput.addEventListener("change", () => {
          currentPage = 1;
          if (pageInput) pageInput.value = currentPage;
          loadSongsFromServer(currentPage);
        });
      }

      if (pageInput) {
        pageInput.addEventListener("focus", () => {
          isPageInputEditing = true;
        });
        pageInput.addEventListener("blur", () => {
          isPageInputEditing = false;
          handleJumpToPageClick();
        });
        pageInput.addEventListener("change", () => {
          isPageInputEditing = false;
          handleJumpToPageClick();
        });
        pageInput.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          isPageInputEditing = false;
          handleJumpToPageClick();
        });
      }

      // 搜索防抖
      let searchTimeout = null;
      searchInput.oninput = function () {
        if (searchTimeout) {
          clearTimeout(searchTimeout);
        }
        searchTimeout = setTimeout(() => {
          currentPage = 1;
          pageInput.value = currentPage;
          renderFilteredPlaylist();
          searchTimeout = null;
        }, 200); // 200ms 防抖延迟
      };

      function normalizeListMode(value) {
        const next = Number(value);
        if (!Number.isFinite(next)) return 0;
        return Math.max(0, Math.min(2, Math.floor(next)));
      }

      // 防抖计时器
      let listModeChangeTimeout = null;

      async function handleListModeChange(nextValue) {
        // 取消之前的待处理切换
        if (listModeChangeTimeout) {
          clearTimeout(listModeChangeTimeout);
        }

        // 立即更新UI状态
        currentPage = 1;
        pageInput.value = currentPage;
        fmusicListActive = normalizeListMode(nextValue);

        if (username === "" && fmusicListActive === 1) {
          fmusicListActive = 2;
          if (likeBoxBtn) likeBoxBtn.value = String(fmusicListActive);
          showAlert(
            t("alerts.loginRequired", null, "Please log in to favorite tracks."),
          );
        }

        // 显示加载状态
        setListModeLoading(true);

        // 使用防抖延迟实际的数据加载和渲染
        listModeChangeTimeout = setTimeout(async () => {
          try {
            if (fmusicListActive === 1) {
              await fetchUserMusicList();
            } else {
              setListModeLoading(false);
              switch (fmusicListActive) {
                case 0:
                  renderFilteredPlaylist();
                  break;
                case 2:
                  renderHistoryPlaylist();
                  break;
              }
            }
          } catch (error) {
            console.error("Error in handleListModeChange:", error);
            setListModeLoading(false);
          }
          listModeChangeTimeout = null;
        }, 100); // 100ms 防抖延迟
      }

      if (likeBoxBtn) {
        likeBoxBtn.value = String(fmusicListActive);
        likeBoxBtn.addEventListener("change", () => {
          handleListModeChange(likeBoxBtn.value);
        });
      }

      function renderFilteredPlaylist() {
        const searchTerm = searchInput.value.trim().toLowerCase();
        matchedData = playlistdata.filter((file) =>
          file.fn.toLowerCase().includes(searchTerm),
        );
        scheduleRenderPlaylist(currentPage);
        fmusicListActive = 0;
        if (likeBoxBtn) likeBoxBtn.value = "0";
        setListModeLoading(false);
      }

      async function fetchUserInfo() {
        try {
          return await nuxtFetch("/api/user");
        } catch (error) {
          console.error(error);
          return null;
        }
      }

      async function fetchUserMusicList() {
        setListModeLoading(true);
        try {
          const response = await fetchUserInfo();
          if (!response || !Array.isArray(response.musicList)) {
            fmusicListActive = 0;
            if (likeBoxBtn) likeBoxBtn.value = "0";
            setListModeLoading(false);
            renderFilteredPlaylist();
            return;
          }
          fmusicList = response.musicList;
          matchedData = fmusicList;
          scheduleRenderPlaylist(currentPage);
          fmusicListActive = 1;
          if (likeBoxBtn) likeBoxBtn.value = "1";
        } finally {
          setListModeLoading(false);
        }
      }

      renderHistoryPlaylist = function () {
        matchedData = getAllHistory();
        scheduleRenderPlaylist(currentPage);
        fmusicListActive = 2;
        if (likeBoxBtn) likeBoxBtn.value = "2";
        setListModeLoading(false);
      };

      // 进度条拖动开始：oninput 实时更新显示，不要频繁暂停音频
      progressBar.oninput = function () {
        if (isChiptune3Mode && chiptune3Player) {
          if (!chiptune3Scrubbing) {
            chiptune3Scrubbing = true;
            chiptune3WasPlaying = chiptune3Player.getIsPlaying();
            if (chiptune3WasPlaying) chiptune3Player.pause();
          }
          var dur = chiptune3Player.getDuration() || 0;
          var seekSec = (Number(progressBar.value) / 100) * dur;
          updateProgressLabel(progressBar.value);
          emitPlayerUiEvent('progress-change', { progress: Number(progressBar.value), isScrubbing: true });
          if (dur > 0) {
            var elapsedSec = Math.floor(seekSec);
            var remainSec = Math.max(0, Math.floor(dur) - elapsedSec);
            emitPlayerUiEvent('time-update', { elapsedSeconds: elapsedSec, durationSeconds: Math.floor(dur), remainingSeconds: remainSec });
          }
          return;
        }
        if (isNativeMode && nativeAudioEl) {
          // 第一次进入拖动
          if (!nativeScrubbing) {
            nativeScrubbing = true;
            // 记录拖动前是否正在播放
            nativeWasPlaying = !nativeAudioEl.paused;
            // 拖动期间暂停播放（避免 seek 期间音频撒出）
            if (nativeWasPlaying) nativeAudioEl.pause();
          }
          // 实时更新时间显示（不实际 seek，避免频繁网络请求）
          var dur = nativeAudioEl.duration || 0;
          var seekSec = (progressBar.value / 100) * (isFinite(dur) ? dur : 0);
          updateProgressLabel(progressBar.value);
          emitPlayerUiEvent('progress-change', { progress: Number(progressBar.value), isScrubbing: true });
          if (isFinite(dur) && dur > 0) {
            var elapsedSec = Math.floor(seekSec);
            var remainSec = Math.max(0, Math.floor(dur) - elapsedSec);
            emitPlayerUiEvent('time-update', { elapsedSeconds: elapsedSec, durationSeconds: Math.floor(dur), remainingSeconds: remainSec });
          }
          return;
        }
        // tracker 模式
        wasPlaying = wasPlaying || BassoonTracker.isPlaying();
        stopPlay();
        updateProgressLabel(progressBar.value);
        emitPlayerUiEvent("progress-change", {
          progress: Number(progressBar.value),
          isScrubbing: true,
        });
        emitTimeUpdateFromProgress(progressBar.value, true);
      };

      // 拖动结束：onchange 执行实际 seek
      progressBar.onchange = function () {
        if (isChiptune3Mode && chiptune3Player) {
          if (!isTrackReady) {
            chiptune3Scrubbing = false;
            return;
          }
          chiptune3Scrubbing = false;
          var dur = chiptune3Player.getDuration() || 0;
          var targetTime = (Number(progressBar.value) / 100) * dur;
          chiptune3Player.seek(targetTime);
          if (chiptune3WasPlaying) {
            chiptune3Player.unpause();
            isPlayingUi = true;
            if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
            emitPlayerUiEvent('play-state', { isPlaying: true });
          } else {
            isPlayingUi = false;
          }
          chiptune3WasPlaying = false;
          emitPlayerUiEvent('progress-change', { progress: Number(progressBar.value), isScrubbing: false });
          return;
        }
        if (isNativeMode && nativeAudioEl) {
          nativeScrubbing = false;
          var dur = nativeAudioEl.duration || 0;
          if (isFinite(dur) && dur > 0) {
            var targetTime = (progressBar.value / 100) * dur;
            nativeAudioEl.currentTime = targetTime;
          }
          if (nativeWasPlaying) {
            // 恢复播放，带 AudioContext resume 保障
            var nativeCtxC = BassoonTracker.audio.context;
            var doResumePlay = function () {
              if (!nativeAudioEl) return;
              var rp = nativeAudioEl.play();
              if (rp) {
                rp.then(function () {
                  isPlayingUi = true;
                  if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
                  emitPlayerUiEvent('play-state', { isPlaying: true });
                  startNativeAudioRaf();
                }).catch(function (e) { console.warn('seek resume play failed:', e); });
              } else {
                isPlayingUi = true;
                if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
                emitPlayerUiEvent('play-state', { isPlaying: true });
                startNativeAudioRaf();
              }
            };
            if (nativeCtxC && nativeCtxC.state === 'suspended') {
              nativeCtxC.resume().then(doResumePlay).catch(doResumePlay);
            } else {
              doResumePlay();
            }
          } else {
            // 之前就是暂停状态，保持暂停
            isPlayingUi = false;
          }
          nativeWasPlaying = false;
          emitPlayerUiEvent('progress-change', { progress: Number(progressBar.value), isScrubbing: false });
          return;
        }
        // tracker 模式
        var songPos = Math.floor(
          (songLength * progressBar.value) / 100 / patternLength,
        );
        BassoonTracker.setCurrentSongPosition(songPos);
        if (wasPlaying) togglePlay();
        wasPlaying = false;
        oppChange = 0;
        oppRepet = 0;
        emitPlayerUiEvent("progress-change", {
          progress: Number(progressBar.value),
          isScrubbing: false,
        });
        emitTimeUpdateFromProgress(progressBar.value, false);
      };

      // setup progress bar to seek into the song
      volumeBar.oninput = volumeBar.onchange = function () {
        updateVolumeLabel(volumeBar.value);
        btSetVolume();
        // native 音频模式下同时更新 gainNode 音量
        if (isNativeMode) syncNativeVolume();
        emitPlayerUiEvent("volume-change", {
          volume: Number(volumeBar.value),
        });
      };

      // ── 响度均衡: Re-route cutOffVolume through AGC gain node ─────
      // cutOffVolume was internally connected to destination — disconnect
      // and interpose btNormGainNode for loudness normalization.
      BassoonTracker.audio.cutOffVolume.disconnect();
      BassoonTracker.audio.cutOffVolume.connect(btNormGainNode);
      btNormGainNode.connect(ctx.destination);
      // Scope analyser reads post-AGC signal (shows normalized output)
      btNormGainNode.connect(analyser);
      // RMS measurer reads pre-AGC signal (raw source level)
      BassoonTracker.audio.cutOffVolume.connect(btMeasurerNode);

      // this has nothing to do with audio playback, it's only used to update the UI once in a while;
      async function playAdjacentTrack(direction) {
        if (!fileNameplaying) {
          stopPlay();
          return;
        }
        try {
          const search = searchInput ? searchInput.value.trim() : "";
          const sortVal = sortSelect ? sortSelect.value : "0";
          const extensionsVal = getExtensionsVal();
          const channelsVal = channelsSelect ? channelsSelect.value : "all";
          const sizeVal = sizeSelect ? sizeSelect.value : "all";
          const modeVal = fmusicListActive;

          let filenamesParam = "";
          if (modeVal === 2) {
            const hist = getAllHistory() || [];
            filenamesParam = hist.map(item => item.fn).join(',');
          }

          const params = new URLSearchParams({
            currentFilename: fileNameplaying,
            direction: direction,
            search,
            sort: sortVal,
            extensions: extensionsVal,
            channels: channelsVal,
            size: sizeVal,
            mode: String(modeVal),
            filenames: filenamesParam
          });

          const res = await nuxtFetch(`/api/songs/adjacent?${params.toString()}`);
          if (res && res.song) {
            play(mainFilePath + res.song.fn, res.song.id);
          } else {
            stopPlay();
          }
        } catch (error) {
          console.error("Failed to get adjacent track", error);
          stopPlay();
        }
      }

      function toNewSong() {
        if (playmode === 0) {
          // Stop (停止播放)
          stopPlay();
          return;
        }

        emitPlayerUiEvent('track-loading', { isTrackLoading: true });
        if (songName) songName.innerHTML =
          t('player.loadingSong', null, 'Loading song ...') +
          ' <span class="spinner-border text-primary" role="status" aria-hidden="true" style="border-width: 4px;"></span>';

        if (playmode === 2) {
          // 单曲循环：如果存在正在播放的 URL，则重新播放
          if (pendingUrl) {
            play(pendingUrl);
          } else {
            playAdjacentTrack("next");
          }
          return;
        }

        if (playmode === 1) {
          isNavigatingHistory = false;
          historyCursor = 0;
          playAdjacentTrack("next");
        } else if (playmode === 3) {
          // 随机模式下：如果当前处于历史导航中，优先向后播放历史中的下一首
          if (isNavigatingHistory && historyCursor > 0) {
            const nextHistoryIndex = historyCursor - 1;
            historyCursor = nextHistoryIndex;
            // 如果已经回到最新歌曲 (index 0)，退出历史导航状态（但仍播放 index 0）
            if (historyCursor === 0) {
              isNavigatingHistory = false;
            }
            const targetSong = historyPlaylist[historyCursor];
            play(mainFilePath + targetSong.fn, undefined, true);
          } else {
            // 没有更新的历史了，正常生成一首全新的随机歌曲
            isNavigatingHistory = false;
            historyCursor = 0;
            randomPlay();
          }
        }
      }
      window.toNewSong = toNewSong;

      function toPrevSong() {
        if (playmode === 0) {
          stopPlay();
          return;
        }

        emitPlayerUiEvent('track-loading', { isTrackLoading: true });
        if (songName) {
          songName.innerHTML =
            t('player.loadingSong', null, 'Loading song ...') +
            ' <span class="spinner-border text-primary" role="status" aria-hidden="true" style="border-width: 4px;"></span>';
        }

        if (playmode === 2) {
          if (pendingUrl) {
            play(pendingUrl);
          } else {
            playAdjacentTrack("prev");
          }
          return;
        }

        if (playmode === 1) {
          playAdjacentTrack("prev");
        } else if (playmode === 3) {
          const nextHistoryIndex = historyCursor + 1;
          if (historyPlaylist && historyPlaylist[nextHistoryIndex]) {
            isNavigatingHistory = true;
            historyCursor = nextHistoryIndex;
            const targetSong = historyPlaylist[nextHistoryIndex];
            play(mainFilePath + targetSong.fn, undefined, true);
          } else {
            if (pendingUrl) {
              play(pendingUrl);
            } else {
              playAdjacentTrack("prev");
            }
          }
        }
      }
      window.toPrevSong = toPrevSong;
      function loop() {
        if (startTime || isNativeMode || isChiptune3Mode) {
          if (isNativeMode) {
            // native 音频模式：进度由 rAF 负责，这里仅维护示波器和强制音量
            if (storedSettings.forcedVolume) {
              btSetVolume();
            }
          } else if (isChiptune3Mode) {
            // Chiptune3 模式：进度由 AudioWorklet 推送，这里仅维护示波器和强制音量
            if (storedSettings.forcedVolume) {
              btSetVolume();
            }
          } else {
            if (BassoonTracker.isPlaying()) {
              var state = BassoonTracker.getStateAtTime(
                BassoonTracker.audio.context.currentTime,
              );
              if (state) {
                if (storedSettings.forcedVolume) {
                  btSetVolume();
                }
                var currentPos = state.songPos * patternLength + state.patternPos;
                percentage = (currentPos * 100) / songLength;
                if (oppChange > currentPos + patternLength) {
                  oppRepet += 1;
                } else if (oppChange > currentPos) {
                  oppRepet += 0.2;
                }
                if (
                  percentage >= 100 ||
                  oppChange > currentPos + songLength * 0.5 ||
                  oppRepet >= looptime
                ) {
                  oppRepet = 0;
                  toNewSong();
                } else {
                  oppChange = currentPos;
                  progressBar.value = percentage;
                  var timelineRowIndex = getRowIndexFromState(state);

                  var now = Date.now();
                  if (now - lastProgressEmit > 200) {
                    emitPlayerUiEvent("progress-change", {
                      progress: Number(percentage),
                      isScrubbing: false,
                    });
                    emitTimeUpdateFromProgress(
                      percentage,
                      false,
                      typeof timelineRowIndex === "number"
                        ? timelineRowIndex
                        : undefined,
                    );
                    lastProgressEmit = now;
                  }
                  renderPattern(state);
                }
              }
            } else if (!wasPlaying && isPlayingUi) {
              toNewSong();
            }
          }
        }
        setTimeout(loop, 15);
      }

      loop();

      var scopeRafId: number | null = null;

      // ── 响度均衡: RMS-based AGC update, called every rAF frame ─────
      function updateLoudnessNormalization() {
        var eqEnabled = storedSettings && storedSettings.loudnessEq;

        if (!eqEnabled || !_normMeasurer || !_normGainNode || !isPlayingUi) {
          // AGC disabled or not playing — smooth reset to unity gain
          if (Math.abs(currentNormGain - 1.0) > 0.001) {
            currentNormGain += (1.0 - currentNormGain) * 0.1;
            if (Math.abs(currentNormGain - 1.0) < 0.001) currentNormGain = 1.0;
            _normGainNode.gain.value = currentNormGain;
          }
          return;
        }

        // Read time-domain data from the pre-gain measurer
        var buf = new Float32Array(_normMeasurer.fftSize);
        _normMeasurer.getFloatTimeDomainData(buf);

        // Compute RMS
        var sumSq = 0;
        for (var i = 0; i < buf.length; i++) {
          sumSq += buf[i] * buf[i];
        }
        var rms = Math.sqrt(sumSq / buf.length);

        // For BassoonTracker: measurement is post-user-volume (from cutOffVolume).
        // Compensate by dividing by user gain to estimate source level.
        var effectiveRms = rms;
        if (!isChiptune3Mode && !isNativeMode) {
          var userGain = Math.max(Number(volumeBar ? volumeBar.value : 10) / 100, 0.01);
          effectiveRms = rms / userGain;
        }

        // Compute target gain, clamp to safe range [0.1, 5.0]
        var targetGain = effectiveRms > 0.0001 ? (normTargetRMS / effectiveRms) : 3.0;
        targetGain = Math.max(0.1, Math.min(5.0, targetGain));

        // Smooth with separate attack/release time constants
        var alpha = targetGain > currentNormGain ? normAttackAlpha : normReleaseAlpha;
        currentNormGain += (targetGain - currentNormGain) * alpha;
        currentNormGain = Math.max(0.1, Math.min(5.0, currentNormGain));

        // Apply gain
        _normGainNode.gain.value = currentNormGain;
      }

      function tickScope() {
        if (scopeActive && !document.hidden && (!scopeIsIdle || isPlayingUi)) {
          renderScope();
        }
        // ── 响度均衡: update AGC every frame regardless of scope visibility ──
        updateLoudnessNormalization();
        scopeRafId = requestAnimationFrame(tickScope);
      }
      scopeRafId = requestAnimationFrame(tickScope);
      setInterval(titleChange, 400);
      // load first song
      // playItem(demoMod);
    }

    function togglePlay() {
      if (!isTrackReady) {
        return;
      }
      if (isChiptune3Mode && chiptune3Player) {
        if (chiptune3Player.getIsPlaying()) {
          chiptune3Player.pause();
          isPlayingUi = false;
          if (playButton) playButton.innerHTML = t('player.play', null, 'Play');
          emitPlayerUiEvent('play-state', { isPlaying: false });
        } else {
          chiptune3Scrubbing = false;
          var ctx = BassoonTracker.audio.context;
          var doChiptunePlay = function () {
            if (chiptune3Player) {
              chiptune3Player.unpause();
              isPlayingUi = true;
              if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
              emitPlayerUiEvent('play-state', { isPlaying: true });
            }
          };
          if (ctx && ctx.state === 'suspended') {
            ctx.resume().then(doChiptunePlay).catch(doChiptunePlay);
          } else {
            doChiptunePlay();
          }
        }
        return;
      }
      if (isNativeMode && nativeAudioEl) {
        // native 音频模式：直接控制 HTMLAudioElement
        var nativeCtx = BassoonTracker.audio.context;
        if (nativeAudioEl.paused) {
          var doNativePlay = function () {
            var pp = nativeAudioEl.play();
            if (pp) {
              pp.then(function () {
                isPlayingUi = true;
                if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
                emitPlayerUiEvent('play-state', { isPlaying: true });
                startNativeAudioRaf();
              }).catch(function (e) {
                console.warn('native play failed:', e);
              });
            } else {
              isPlayingUi = true;
              if (playButton) playButton.innerHTML = t('player.pause', null, 'Pause');
              emitPlayerUiEvent('play-state', { isPlaying: true });
              startNativeAudioRaf();
            }
          };
          if (nativeCtx && nativeCtx.state === 'suspended') {
            nativeCtx.resume().then(doNativePlay).catch(doNativePlay);
          } else {
            doNativePlay();
          }
        } else {
          nativeAudioEl.pause();
          isPlayingUi = false;
          if (playButton) playButton.innerHTML = t('player.play', null, 'Play');
          if (nativeAudioRafId !== null) { cancelAnimationFrame(nativeAudioRafId); nativeAudioRafId = null; }
          emitPlayerUiEvent('play-state', { isPlaying: false });
        }
        return;
      }
      BassoonTracker.togglePlay();
      btSetVolume();
      // var songPos = Math.floor((songLength * progressBar.value / 100) / patternLength);
      // BassoonTracker.setCurrentSongPosition(songPos);
      if (BassoonTracker.isPlaying()) {
        startTime = new Date().getTime();
        playButton.innerHTML = t("player.pause", null, "Pause");
      } else {
        playButton.innerHTML = t("player.play", null, "Play");
      }
      isPlayingUi = BassoonTracker.isPlaying();

      emitPlayerUiEvent("play-state", {
        isPlaying: BassoonTracker.isPlaying(),
      });
      emitTimeUpdateFromProgress(progressBar.value, false);
    }

    togglePlayImpl = togglePlay;

    // ── Media Session API 集成 ──
    if (typeof window !== 'undefined' && 'mediaSession' in navigator) {
      // 动态生成一个 10 秒的正规静音 WAV 音频，用于在移动端稳定维持 Audio Focus。
      // Chrome/Safari 不会对极短且空的 Base64 data URI 或 MediaStream 激活 Media Session，
      // 所以我们必须向 <audio> 提供一个具备合法时长的真实静音音频 Blob。
      function generateSilentWavUrl() {
        try {
          var sampleRate = 8000;
          var duration = 10; // 10 秒
          var numSamples = sampleRate * duration;
          var dataSize = numSamples * 2; // 16-bit
          var buffer = new ArrayBuffer(44 + dataSize);
          var v = new DataView(buffer);
          function ws(offset: number, str: string) {
            for (var i = 0; i < str.length; i++) v.setUint8(offset + i, str.charCodeAt(i));
          }
          ws(0, 'RIFF');
          v.setUint32(4, 36 + dataSize, true);
          ws(8, 'WAVE');
          ws(12, 'fmt ');
          v.setUint32(16, 16, true);
          v.setUint16(20, 1, true); // PCM
          v.setUint16(22, 1, true); // Mono
          v.setUint32(24, sampleRate, true);
          v.setUint32(28, sampleRate * 2, true); // ByteRate
          v.setUint16(32, 2, true); // BlockAlign
          v.setUint16(34, 16, true); // BitsPerSample
          ws(36, 'data');
          v.setUint32(40, dataSize, true);
          // 填充近静音数据（振幅 1，物理输出不可闻，但保留数字信号）
          for (var i = 0; i < numSamples; i++) {
            v.setInt16(44 + i * 2, 1, true);
          }
          var blob = new Blob([buffer], { type: 'audio/wav' });
          return URL.createObjectURL(blob);
        } catch (e) {
          console.warn("Failed to generate silent WAV", e);
          return "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA";
        }
      }

      let silentAudio: HTMLAudioElement | null = null;
      try {
        silentAudio = document.createElement('audio');
        silentAudio.src = generateSilentWavUrl();
        silentAudio.loop = true;
        silentAudio.setAttribute('playsinline', '');
        silentAudio.setAttribute('webkit-playsinline', '');
        // 隐藏在文档中，绝对定位以避免影响布局，但不设为 display:none 阻止浏览器挂起它
        silentAudio.style.position = 'fixed';
        silentAudio.style.left = '-9999px';
        silentAudio.style.top = '-9999px';
        silentAudio.style.width = '1px';
        silentAudio.style.height = '1px';
        silentAudio.style.opacity = '0.01';
        silentAudio.style.pointerEvents = 'none';
        document.body.appendChild(silentAudio);
      } catch (e) {
        console.warn("Failed to create silent Audio object", e);
      }

      var mediaBridgePlaying = false;
      const startMediaBridge = (url?: string) => {
        // 如果传入了 url，判定是否属于 native 原生格式
        if (url) {
          var ext = url.substring(url.lastIndexOf('.') + 1).toLowerCase().split('?')[0];
          if (NATIVE_AUDIO_EXTS.has(ext)) {
            stopMediaBridge();
            return;
          }
        } else {
          if (isNativeMode) {
            stopMediaBridge();
            return;
          }
        }

        if (!silentAudio || mediaBridgePlaying) return;
        var p = silentAudio.play();
        if (p) {
          p.then(function () {
            mediaBridgePlaying = true;
            console.log('[MediaBridge] Active');
          }).catch(function (e) {
            console.warn('[MediaBridge] Play rejected:', e);
          });
        }
      };

      const stopMediaBridge = () => {
        if (!silentAudio || !mediaBridgePlaying) return;
        silentAudio.pause();
        mediaBridgePlaying = false;
        console.log('[MediaBridge] Paused');
      };

      // 绑定到外层作用域，供用户手势同步调用
      startMediaBridgeImpl = startMediaBridge;

      const mediaSessionSeek = (timeInSeconds: number) => {
        if (!isTrackReady) return;
        if (isChiptune3Mode && chiptune3Player) {
          var dur = chiptune3Player.getDuration() || 0;
          var pct = dur > 0 ? (timeInSeconds / dur) * 100 : 0;
          if (progressBar) progressBar.value = String(pct);
          chiptune3Player.seek(timeInSeconds);
          emitPlayerUiEvent('progress-change', { progress: pct, isScrubbing: false });
        } else if (isNativeMode && nativeAudioEl) {
          nativeAudioEl.currentTime = timeInSeconds;
          var dur = nativeAudioEl.duration || 0;
          var pct = dur > 0 ? (timeInSeconds / dur) * 100 : 0;
          if (progressBar) progressBar.value = String(pct);
          emitPlayerUiEvent('progress-change', { progress: pct, isScrubbing: false });
        } else {
          // tracker 模式
          var dur = window.__playerUiState?.durationSeconds || 0;
          if (dur > 0) {
            var pct = (timeInSeconds / dur) * 100;
            if (progressBar) progressBar.value = String(pct);
            var songPos = Math.floor((songLength * pct) / 100 / patternLength);
            BassoonTracker.setCurrentSongPosition(songPos);
            emitPlayerUiEvent("progress-change", { progress: pct, isScrubbing: false });
            emitTimeUpdateFromProgress(pct, false);
          }
        }
      };

      try {
        navigator.mediaSession.setActionHandler('play', () => {
          startMediaBridge();
          if (window.togglePlay) window.togglePlay();
          navigator.mediaSession.playbackState = 'playing';
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          stopMediaBridge();
          if (window.togglePlay) window.togglePlay();
          navigator.mediaSession.playbackState = 'paused';
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          if (window.toPrevSong) window.toPrevSong();
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          if (window.toNewSong) window.toNewSong();
        });
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (typeof details.seekTime === 'number') {
            mediaSessionSeek(details.seekTime);
          }
        });
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
          const offset = details.seekOffset || 10;
          const current = window.__playerUiState?.elapsedSeconds || 0;
          const duration = window.__playerUiState?.durationSeconds || 0;
          const target = Math.min(duration, current + offset);
          mediaSessionSeek(target);
        });
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
          const offset = details.seekOffset || 10;
          const current = window.__playerUiState?.elapsedSeconds || 0;
          const target = Math.max(0, current - offset);
          mediaSessionSeek(target);
        });
      } catch (error) {
        console.warn("Failed to set Media Session action handlers:", error);
      }

      const generateAsciiArtworkImage = (title: string, artist: string): string => {
        if (typeof document === 'undefined') return '/cover.png';
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '/cover.png';

        // 单词折行算法 (高清字体单行允许更多字符)
        const wrapTextToLines = (text: string, maxCharsPerLine = 14): string[] => {
          const clean = (text || 'Unknown').trim();
          const words = clean.split(/\s+/).filter(Boolean);
          const lines: string[] = [];
          let currentLine = "";

          for (const word of words) {
            if (word.length > maxCharsPerLine) {
              if (currentLine) {
                lines.push(currentLine);
                currentLine = "";
              }
              lines.push(word);
              continue;
            }
            if (currentLine === "") {
              currentLine = word;
            } else if (currentLine.length + 1 + word.length <= maxCharsPerLine) {
              currentLine += " " + word;
            } else {
              lines.push(currentLine);
              currentLine = word;
            }
          }
          if (currentLine) {
            lines.push(currentLine);
          }
          return lines.slice(0, 3); // 最多 3 行大字，保证舒适留白
        };

        // 1. 获取当前播放器的主题颜色 (从 #scope 元素计算)
        let themeStart = '#3b82f6';
        let themeEnd = '#8b5cf6';
        let waveformColor = '#16a34a';
        const scopeEl = document.getElementById('scope');
        if (scopeEl) {
          try {
            const computedStyle = window.getComputedStyle(scopeEl);
            themeStart = computedStyle.getPropertyValue('--scope-spectrum-start').trim() || themeStart;
            themeEnd = computedStyle.getPropertyValue('--scope-spectrum-end').trim() || themeEnd;
            waveformColor = computedStyle.getPropertyValue('--scope-waveform').trim() || waveformColor;
          } catch (e) {
            // Ignore error
          }
        }

        // 2. 绘制深色高科技背景
        const bgGrad = ctx.createRadialGradient(512, 512, 20, 512, 512, 720);
        bgGrad.addColorStop(0, '#0f172a'); // slate-900
        bgGrad.addColorStop(1, '#020617'); // slate-950
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, 1024, 1024);

        // 绘制复古扫描网格
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.012)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 1024; i += 32) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, 1024);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(1024, i);
          ctx.stroke();
        }

        // 3. 绘制 Siri 风格的电子交织正弦波形背景
        ctx.save();
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.12;

        // 绘制第一条正弦波 (themeStart)
        ctx.strokeStyle = themeStart;
        ctx.beginPath();
        for (let x = 0; x <= 1024; x += 10) {
          const y = 390 + Math.sin(x * 0.008) * 110 + Math.cos(x * 0.015) * 40;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 绘制第二条余弦波 (waveformColor)
        ctx.strokeStyle = waveformColor;
        ctx.beginPath();
        for (let x = 0; x <= 1024; x += 10) {
          const y = 390 + Math.cos(x * 0.007) * 90 + Math.sin(x * 0.012) * 50;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // 4. 精确折行并计算自适应缩放字号
        const safeTitle = (title || 'Unknown').trim();
        const textLines = wrapTextToLines(safeTitle, 14);
        const numLines = textLines.length;

        ctx.save();
        const baseFontSize = 120; // 放大基准字号
        ctx.font = `italic 900 ${baseFontSize}px "Arial Black", "Impact", "Outfit", "Inter", sans-serif`;

        // 测量最大宽度
        let maxLineWidth = 0;
        for (let i = 0; i < numLines; i++) {
          const w = ctx.measureText(textLines[i]).width;
          if (w > maxLineWidth) maxLineWidth = w;
        }

        const targetMaxWidth = 920; // 增加显示边界
        const targetMaxHeight = 420;
        const lineSpacing = baseFontSize * 1.25;
        const baseHeight = numLines * lineSpacing;

        const scaleX = targetMaxWidth / maxLineWidth;
        const scaleY = targetMaxHeight / baseHeight;
        let scale = Math.min(scaleX, scaleY);

        // 限制最大字号为 140px，防止极短歌名被放得太大
        const maxScale = 140 / baseFontSize;
        if (scale > maxScale) scale = maxScale;

        const finalFontSize = Math.floor(baseFontSize * scale);
        const finalLineSpacing = finalFontSize * 1.25;
        const actualTotalHeight = numLines * finalLineSpacing;

        ctx.font = `italic 900 ${finalFontSize}px "Arial Black", "Impact", "Outfit", "Inter", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 计算纵向精确居中的起始 Y 坐标
        const centerY = 390;
        const startY = centerY - (actualTotalHeight / 2) + (finalFontSize / 2);

        const extrusionDepth = Math.max(4, Math.floor(finalFontSize * 0.12)); // 3D 厚度

        const sideGrad = ctx.createLinearGradient(120, 200, 900, 600);
        sideGrad.addColorStop(0, themeStart + '77'); // 77 代表 45% 透明度
        sideGrad.addColorStop(0.5, themeEnd + '77');
        sideGrad.addColorStop(1, waveformColor + '77');

        const textGrad = ctx.createLinearGradient(120, 200, 900, 600);
        textGrad.addColorStop(0, themeStart);
        textGrad.addColorStop(0.5, themeEnd);
        textGrad.addColorStop(1, waveformColor);

        // 绘制 3D 投影侧壁 (从后往前)
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.5)'; // 侧壁层叠暗描边，增加 3D 层次结构
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        for (let d = extrusionDepth; d > 0; d--) {
          ctx.save();
          // 在最底层绘制时，叠加一层极为柔和的黑色大阴影，产生悬浮立体感
          if (d === extrusionDepth) {
            ctx.shadowColor = 'rgba(2, 6, 23, 0.95)';
            ctx.shadowBlur = 24;
            ctx.shadowOffsetX = 12;
            ctx.shadowOffsetY = 16;
          }
          ctx.fillStyle = sideGrad;
          let currentY = startY + d;
          for (let i = 0; i < numLines; i++) {
            ctx.strokeText(textLines[i], 512 + d, currentY);
            ctx.fillText(textLines[i], 512 + d, currentY);
            currentY += finalLineSpacing;
          }
          ctx.restore();
        }

        // 6. 强制且彻底清空 Canvas 级别的全部阴影渲染参数，防止对前景和底部小字造成边缘虚化污染
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // 7. 绘制前景正面 (高亮发光面，配以深色高反差描边)
        ctx.fillStyle = textGrad;
        ctx.strokeStyle = '#020617'; // 正面大字的深色切面边缘
        ctx.lineWidth = 5.5; // 稍宽的暗边界阻尼
        ctx.lineJoin = 'round';

        let currentY = startY;
        for (let i = 0; i < numLines; i++) {
          ctx.strokeText(textLines[i], 512, currentY);
          ctx.fillText(textLines[i], 512, currentY);
          currentY += finalLineSpacing;
        }
        ctx.restore();

        // 8. 绘制 Tracker 装饰数据 (28px monospaced)
        ctx.save();
        ctx.font = '28px "Courier New", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';

        const decorYTop = 120;
        const decorYBottom = 680;
        const mockTracks = [
          `00: C-4 01 C20 | 00: --- -- --- | 00: G-3 02 C10`,
          `08: E-4 01 --- | 08: C-3 02 C20 | 08: --- -- ---`,
          `16: G-4 01 C20 | 16: --- -- --- | 16: E-3 02 C10`,
          `24: B-4 01 --- | 24: G-3 02 C20 | 24: --- -- ---`
        ];

        ctx.textAlign = 'center';
        ctx.fillText(`[ NATIVE AUDIO ENGINE ACTIVE ]`, 512, 90);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillText(mockTracks[0], 512, decorYTop);
        ctx.fillText(mockTracks[1], 512, decorYTop + 32);
        ctx.fillText(mockTracks[2], 512, decorYBottom);
        ctx.fillText(mockTracks[3], 512, decorYBottom + 32);
        ctx.restore();

        // 9. 绘制分割线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(80, 780);
        ctx.lineTo(944, 780);
        ctx.stroke();

        // 10. 绘制完整歌曲标题和艺术家
        ctx.save();
        ctx.textAlign = 'center';

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 52px system-ui, -apple-system, sans-serif';
        let displayTitle = safeTitle;
        if (ctx.measureText(displayTitle).width > 920) {
          while (ctx.measureText(displayTitle + '...').width > 920 && displayTitle.length > 0) {
            displayTitle = displayTitle.slice(0, -1);
          }
          displayTitle += '...';
        }
        ctx.fillText(displayTitle, 512, 855);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = '36px system-ui, -apple-system, sans-serif';
        let displayArtist = artist || 'Unknown Artist';
        if (ctx.measureText(displayArtist).width > 920) {
          while (ctx.measureText(displayArtist + '...').width > 920 && displayArtist.length > 0) {
            displayArtist = displayArtist.slice(0, -1);
          }
          displayArtist += '...';
        }
        ctx.fillText(displayArtist, 512, 920);
        ctx.restore();

        return canvas.toDataURL('image/png');
      };

      let currentSessionArtist = '';

      const updateMediaSessionMetadata = (title: string, artist: string) => {
        const artworkUrl = generateAsciiArtworkImage(title, artist);
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title || 'Unknown Title',
          artist: artist || 'Unknown Artist',
          album: 'ModFM Tracker Player',
          artwork: [
            { src: artworkUrl, sizes: '1024x1024', type: 'image/png' }
          ]
        });
      };

      window.addEventListener('player:track-change', (e: any) => {
        const detail = e.detail || {};
        const title = detail.songTitle || detail.fileName || '';
        currentSessionArtist = '';
        updateMediaSessionMetadata(title, '');
      });

      window.addEventListener('player:track-meta', (e: any) => {
        const detail = e.detail || {};
        const title = detail.title || window.__playerUiState?.songTitle || window.__playerUiState?.fileName || '';
        const artist = detail.artist || '';
        if (!currentSessionArtist) {
          currentSessionArtist = artist;
        }
        updateMediaSessionMetadata(title, currentSessionArtist);
      });

      window.addEventListener('player:tma-artist', (e: any) => {
        const detail = e.detail || {};
        const artist = detail.artist || '';
        if (artist) {
          currentSessionArtist = artist;
          const title = window.__playerUiState?.songTitle || window.__playerUiState?.fileName || '';
          updateMediaSessionMetadata(title, currentSessionArtist);
        }
      });

      window.addEventListener('player:play-state', (e: any) => {
        const detail = e.detail || {};
        navigator.mediaSession.playbackState = detail.isPlaying ? 'playing' : 'paused';
        if (detail.isPlaying) {
          startMediaBridge();
        } else {
          stopMediaBridge();
        }
      });

      window.addEventListener('player:time-update', (e: any) => {
        const detail = e.detail || {};
        const duration = detail.durationSeconds || 0;
        const position = detail.elapsedSeconds || 0;
        if (duration > 0 && position >= 0 && position <= duration) {
          if ('setPositionState' in navigator.mediaSession) {
            try {
              navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: 1.0,
                position: position
              });
            } catch (err) {
              // Ignore errors for invalid states
            }
          }
        }
      });
    }

    function stopPlay() {
      if (isChiptune3Mode && chiptune3Player) {
        chiptune3Player.stop();
        isPlayingUi = false;
        chiptune3Scrubbing = false;
        chiptune3WasPlaying = false;
        if (playButton) playButton.innerHTML = t('player.play', null, 'Play');
        emitPlayerUiEvent('play-state', { isPlaying: false });
        return;
      }
      if (isNativeMode && nativeAudioEl) {
        nativeAudioEl.pause();
        if (nativeAudioRafId !== null) { cancelAnimationFrame(nativeAudioRafId); nativeAudioRafId = null; }
        isPlayingUi = false;
        nativeScrubbing = false;
        nativeWasPlaying = false;
        if (playButton) playButton.innerHTML = t('player.play', null, 'Play');
        emitPlayerUiEvent('play-state', { isPlaying: false });
        return;
      }
      BassoonTracker.stop();
      playButton.innerHTML = t("player.play", null, "Play");
      isPlayingUi = false;
      emitPlayerUiEvent("play-state", { isPlaying: false });
      emitTimeUpdateFromProgress(progressBar.value, false);
    }

    function renderScope() {
      // Calculate delta time (dt) for framerate-independent decay
      var now = performance.now();
      var dt = 22.22;
      if (lastScopeTickTime > 0) {
        dt = now - lastScopeTickTime;
        if (dt > 100) dt = 22.22;
      }
      lastScopeTickTime = now;

      var rate = dt / 22.22;
      var barDecay = Math.pow(0.82, rate);
      var peakDecay = Math.pow(0.97, rate);

      // Use cached CSS layout dimensions to avoid Layout Thrashing
      var nextCssW = cachedScopeCssW;
      var nextCssH = cachedScopeCssH;
      var nextDpr = cachedScopeDpr;
      var nextW = Math.max(1, Math.floor(nextCssW * nextDpr));
      var nextH = Math.max(1, Math.floor(nextCssH * nextDpr));

      // Compute spectrum data (needed by both WebGL and 2D paths)
      analyser.getByteFrequencyData(scopeFreqBuf);
      var freqLen = scopeFreqBuf.length;
      var bars = SCOPE_BARS;
      var usableBins = (freqLen * 0.78) | 0;
      if (usableBins < bars) usableBins = bars;
      var binsPerBar = usableBins / bars;

      var allZero = true;
      for (var b = 0; b < bars; b++) {
        var bStart = (b * binsPerBar) | 0;
        var bEnd = ((b + 1) * binsPerBar) | 0;
        if (bEnd <= bStart) bEnd = bStart + 1;
        var maxBin = 0;
        for (var bs = bStart; bs < bEnd; bs++) {
          var bv = scopeFreqBuf[bs];
          if (bv > maxBin) maxBin = bv;
        }
        var prev = scopeBarSnapshot[b] || 0;
        var nextBar = maxBin > prev ? maxBin : prev * barDecay;
        scopeBarSnapshot[b] = nextBar;
        var prevPeak = scopeBarPeaks[b] || 0;
        scopeBarPeaks[b] = nextBar > prevPeak ? nextBar : prevPeak * peakDecay;

        if (nextBar > 0.05 || scopeBarPeaks[b] > 0.05) {
          allZero = false;
        }
      }

      if (!isPlayingUi && allZero) {
        for (var b = 0; b < bars; b++) {
          scopeBarSnapshot[b] = 0;
          scopeBarPeaks[b] = 0;
        }
        scopeIsIdle = true;
      } else {
        scopeIsIdle = false;
      }

      // Waveform envelope calculation removed (not used anymore)

      // Theme colors caching (1000ms throttled getComputedStyle)
      if (!cachedThemeColors || now - cachedThemeReadAt > 1000) {
        cachedThemeReadAt = now;
        var computedStyle = window.getComputedStyle(container);
        cachedThemeColors = {
          spectrumStart: computedStyle.getPropertyValue("--scope-spectrum-start").trim() || "#3b82f6",
          spectrumEnd: computedStyle.getPropertyValue("--scope-spectrum-end").trim() || "#8b5cf6",
          waveformColor: computedStyle.getPropertyValue("--scope-waveform").trim() || "#16a34a",
          borderColor: computedStyle.getPropertyValue("--border").trim() || "rgba(255,255,255,0.06)"
        };
      }
      var spectrumStart = cachedThemeColors.spectrumStart;
      var spectrumEnd = cachedThemeColors.spectrumEnd;
      var waveformColor = cachedThemeColors.waveformColor;
      var borderColor = cachedThemeColors.borderColor;

      // ── WebGL rendering path ────────────────────────────────────────────
      if (!scopeGLFailed) {
        tryInitScopeGL();
      }
      if (scopeGLRenderer) {
        try {
          // Resize GL canvas
          var glCanvas = scopeGLRenderer['canvas'] as HTMLCanvasElement;
          if (glCanvas.width !== nextW || glCanvas.height !== nextH) {
            glCanvas.width = nextW;
            glCanvas.height = nextH;
          }
          // Prepare bar/peak arrays as 0..1 sqrt-compressed values (Reuse outer Float32Arrays)
          for (var gi = 0; gi < bars; gi++) {
            glBarVals[gi] = Math.sqrt(Math.max(0, Math.min(1, scopeBarSnapshot[gi] / 255)));
            glPeakVals[gi] = Math.sqrt(Math.max(0, Math.min(1, scopeBarPeaks[gi] / 255)));
          }
          // Compute segment energies for Siri wave ripples
          var lowEnergy = 0, midEnergy = 0, highEnergy = 0;
          for (var ge = 0; ge < bars; ge++) {
            var val = glBarVals[ge] || 0;
            if (ge < 10) lowEnergy += val;
            else if (ge < 30) midEnergy += val;
            else highEnergy += val;
          }
          lowEnergy = lowEnergy / 10;
          midEnergy = midEnergy / 20;
          highEnergy = highEnergy / 26;

          scopeGLRenderer.render(
            glBarVals,
            glPeakVals,
            bars,
            !!scopeFillContainer,
            { spectrumStart, spectrumEnd, waveformColor, borderColor },
            nextDpr,
            performance.now() / 1000,
            lowEnergy,
            midEnergy,
            highEnergy,
          );
          return; // WebGL rendered successfully
        } catch (e) {
          console.error("[webgl-vis] renderScope WebGL runtime error, falling back to 2D:", e);
          showWebGLErrorBanner("主示波器 WebGL 运行时错误 (ScopeGL Render)", e);
          try {
            if (scopeGLRenderer) scopeGLRenderer.destroy();
          } catch (ex) { }
          scopeGLRenderer = null;
          scopeGLFailed = true;
          // Remove GL canvas, restore 2D canvas
          var deadGL = document.getElementById("scopeCanvasGL");
          if (deadGL) deadGL.remove();
          scopeCanvas.style.display = "";
        }
      }

      // ── 2D Canvas fallback path (original logic) ────────────────────────
      if (
        scopeCanvas.width !== nextW ||
        scopeCanvas.height !== nextH ||
        scopeDpr !== nextDpr
      ) {
        scopeCanvas.width = nextW;
        scopeCanvas.height = nextH;
        scopeWidth = nextW;
        scopeHeight = nextH;
        scopeDpr = nextDpr;
        scopeCssHeight = nextCssH;
        scopeCachedWaveGrad = null;
        scopeCachedSpectrumGrad = null;
      }

      var w = scopeWidth;
      var h = scopeHeight;
      var dpr = scopeDpr;
      scope.clearRect(0, 0, w, h);

      var themeKey = spectrumStart + "|" + spectrumEnd + "|" + waveformColor;
      var bgKey = w * 1024 + h;
      if (
        themeKey !== scopeCachedThemeKey ||
        bgKey !== scopeCachedBgKey ||
        !scopeCachedWaveGrad ||
        !scopeCachedSpectrumGrad
      ) {
        scopeCachedThemeKey = themeKey;
        scopeCachedBgKey = bgKey;
        var spec = scope.createLinearGradient(0, 0, 0, h);
        spec.addColorStop(0, hexWithAlpha(spectrumStart, 0.55));
        spec.addColorStop(0.5, hexWithAlpha(spectrumStart, 0.42));
        spec.addColorStop(1, hexWithAlpha(spectrumEnd, 0.22));
        scopeCachedSpectrumGrad = spec;
        var wave = scope.createLinearGradient(0, 0, 0, h);
        wave.addColorStop(0, hexWithAlpha(waveformColor, 0.0));
        wave.addColorStop(0.5, hexWithAlpha(waveformColor, 0.42));
        wave.addColorStop(1, hexWithAlpha(waveformColor, 0.0));
        scopeCachedWaveGrad = wave;
      }

      // Background grid
      scope.strokeStyle = borderColor;
      scope.lineWidth = 1;
      scope.globalAlpha = scopeFillContainer ? 0.15 : 0.5;
      scope.beginPath();
      for (var gy = 1; gy <= 3; gy++) {
        var y = (h * gy) / 4;
        scope.moveTo(0, y);
        scope.lineTo(w, y);
      }
      scope.stroke();
      scope.globalAlpha = 1;

      // Spectrum bars
      var barW = w / bars;
      var barGap = Math.max(1 * dpr, barW * 0.22);
      var barInner = Math.max(1 * dpr, barW - barGap);
      var maxBarH = h * 0.92;

      scope.fillStyle = scopeCachedSpectrumGrad as CanvasGradient;
      scope.globalAlpha = 0.62;
      for (var bi = 0; bi < bars; bi++) {
        var raw = scopeBarSnapshot[bi] / 255;
        var v = Math.sqrt(raw);
        if (v < 0) v = 0;
        if (v > 1) v = 1;
        var bh = v * maxBarH + 1;
        var bx = bi * barW + barGap * 0.5;
        var by = 0;
        var radius = Math.min(barInner * 0.5, 4 * dpr);
        roundedBottomRect(scope, bx, by, barInner, bh, radius);
      }
      scope.globalAlpha = 0.55;
      scope.fillStyle = hexWithAlpha(spectrumEnd, 0.55);
      for (var pi = 0; pi < bars; pi++) {
        var rawP = scopeBarPeaks[pi] / 255;
        var pv = Math.sqrt(rawP);
        if (pv < 0.04) continue;
        var ph = pv * maxBarH + 1;
        var px = pi * barW + barGap * 0.5;
        scope.fillRect(px, ph + 1 * dpr, barInner, Math.max(1, 1.5 * dpr));
      }
      scope.globalAlpha = 1;

      // Subtle center axis line (2D fallback)
      if (!scopeFillContainer) {
        var halfH = h * 0.5;
        scope.strokeStyle = hexWithAlpha(waveformColor, 0.15);
        scope.lineWidth = 1;
        scope.beginPath();
        scope.moveTo(0, halfH);
        scope.lineTo(w, halfH);
        scope.stroke();
      } // end !scopeFillContainer (2D fallback)

    }

    function roundedTopRect(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      r: number,
    ) {
      var rr = Math.min(r, width / 2, height);
      ctx.beginPath();
      ctx.moveTo(x, y + height);
      ctx.lineTo(x, y + rr);
      ctx.quadraticCurveTo(x, y, x + rr, y);
      ctx.lineTo(x + width - rr, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + rr);
      ctx.lineTo(x + width, y + height);
      ctx.closePath();
      ctx.fill();
    }

    function roundedBottomRect(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      r: number,
    ) {
      var rr = Math.min(r, width / 2, height);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height - rr);
      ctx.quadraticCurveTo(x + width, y + height, x + width - rr, y + height);
      ctx.lineTo(x + rr, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - rr);
      ctx.closePath();
      ctx.fill();
    }

    function hexWithAlpha(color: string, alpha: number) {
      if (!color) return "rgba(148,163,184," + alpha + ")";
      color = color.trim();
      if (color.charAt(0) === "#") {
        var h = color.slice(1);
        if (h.length === 3) {
          h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        }
        if (h.length >= 6) {
          var r = parseInt(h.slice(0, 2), 16);
          var g = parseInt(h.slice(2, 4), 16);
          var bl = parseInt(h.slice(4, 6), 16);
          return "rgba(" + r + "," + g + "," + bl + "," + alpha + ")";
        }
      }
      if (color.indexOf("rgb") === 0) {
        var inner = color.replace(/^rgba?\(|\)$/g, "");
        var parts = inner.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
        if (parts.length === 3)
          return "rgba(" + parts.join(",") + "," + alpha + ")";
      }
      return color;
    }

    var lastRenderedRow = -1;
    var lastRenderedSongPos = -1;
    var lastRenderedSongName = "";

    // render the pattern
    function renderPattern(position) {
      if (storedSettings.setPattern) {
        var currentSongName = fileNameplaying || "";
        if (
          position &&
          position.patternPos === lastRenderedRow &&
          position.songPos === lastRenderedSongPos &&
          currentSongName === lastRenderedSongName
        ) {
          return;
        }
        lastRenderedRow = position ? position.patternPos : -1;
        lastRenderedSongPos = position ? position.songPos : -1;
        lastRenderedSongName = currentSongName;

        // WebGL Pattern Renderer Init
        if (!patternGLFailed && !patternGLRenderer && patternView) {
          try {
            patternGLRenderer = PatternWebGLRenderer.create(patternView);
          } catch (e) {
            console.error("PatternWebGLRenderer init failed, falling back to DOM:", e);
            patternGLFailed = true;
            patternGLRenderer = null;
          }
        }

        var patternIndex = currentSong.patternTable[position.songPos];
        var pattern = currentSong.patterns[patternIndex];
        if (pattern) {
          var startRow = position.patternPos - 5;
          var endRow = startRow + 28;
          var patternWidth = isChiptune3Mode ? (pattern[0] ? pattern[0].length : 0) : BassoonTracker.getTrackCount();

          if (patternGLRenderer) {
            // WebGL rendering path
            // 1. 获取颜色
            function getCSSColor(name, fallback) {
              if (typeof window === "undefined" || !document.documentElement) {
                return parseHex(fallback);
              }
              const style = window.getComputedStyle(document.documentElement);
              let val = style.getPropertyValue(name).trim();
              if (!val && patternView) {
                val = window.getComputedStyle(patternView).getPropertyValue(name).trim();
              }
              if (!val) return parseHex(fallback);
              return parseColorString(val, fallback);
            }

            function parseColorString(str, fallback) {
              if (str.startsWith("#")) {
                return parseHex(str);
              }
              if (str.startsWith("rgb")) {
                const matches = str.match(/\d+/g);
                if (matches && matches.length >= 3) {
                  return {
                    r: parseInt(matches[0], 10),
                    g: parseInt(matches[1], 10),
                    b: parseInt(matches[2], 10)
                  };
                }
              }
              return parseHex(fallback);
            }

            function parseHex(hex) {
              let clean = hex.replace("#", "");
              if (clean.length === 3) {
                clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
              }
              const num = parseInt(clean, 16) || 0;
              return {
                r: (num >> 16) & 255,
                g: (num >> 8) & 255,
                b: num & 255
              };
            }

            const cDim = getCSSColor("--pattern-dim", "#94a3b8");
            const cNote = getCSSColor("--pattern-note", "#f43f5e");
            const cInst = getCSSColor("--pattern-inst", "#3b82f6");
            const cEffect = getCSSColor("--pattern-effect", "#10b981");
            const cAccent = getCSSColor("--accent", "#f43f5e");
            const cTextMuted = getCSSColor("--text-muted", "#94a3b8");
            const cBorderStrong = getCSSColor("--border-strong", "#475569");

            class GridRowBuilder {
              cells = [];
              append(text, color) {
                for (let i = 0; i < text.length; i++) {
                  this.cells.push({ char: text[i], ...color });
                }
              }
            }

            const rowsData = [];

            const isHorizontalMode = patternWidth > 7;

            if (isHorizontalMode) {
              // ==================== 横向模式网格构建 ====================
              // 0. Header (Row Numbers)
              const headerRow = new GridRowBuilder();
              headerRow.append("     ", cBorderStrong); // 5 个空格
              for (let c = 0; c < 29; c++) {
                const i = startRow + c;
                if (i < 0 || i >= pattern.length) {
                  headerRow.append("     ", cTextMuted); // 5 个空格
                } else {
                  let rowNumberStr = i.toString();
                  if (i < 10) rowNumberStr = "0" + rowNumberStr;
                  // 5 字符对齐: 1 空格 + 2 位数字 + 2 空格 = 5 字符
                  headerRow.append(" " + rowNumberStr + "  ", cTextMuted);
                }
              }
              rowsData.push(headerRow);

              // 1-N. Channel Rows (每一个通道占 3 行)
              for (let col = 0; col < patternWidth; col++) {
                const chnNum = (col + 1) < 10 ? "0" + (col + 1) : (col + 1);

                const noteRow = new GridRowBuilder();
                const instRow = new GridRowBuilder();
                const effRow = new GridRowBuilder();

                // 前缀 (5 字符)
                noteRow.append(" Chn ", cBorderStrong);
                instRow.append(" " + chnNum + "  ", cBorderStrong);
                effRow.append("     ", cBorderStrong);

                for (let c = 0; c < 29; c++) {
                  const i = startRow + c;
                  if (i < 0 || i >= pattern.length) {
                    noteRow.append("     ", cDim); // 5 个空格
                    instRow.append("     ", cDim); // 5 个空格
                    effRow.append("     ", cDim); // 5 个空格
                  } else {
                    const rowData = pattern[i];
                    const note = rowData[col];

                    // 拆分音符、乐器和效果器
                    let noteString = "---";
                    let instrumentString = "00";
                    let effectString = "...";

                    if (note) {
                      if (isChiptune3Mode) {
                        noteString = getOpenMptNoteName(note.note);
                        instrumentString = note.instrument > 0 ? formatHex(note.instrument, 2, "0") : "00";
                        if (note.effect > 0 || note.param > 0) {
                          var effectChar = ".";
                          if (note.effect > 0 && note.effect <= 26) {
                            effectChar = String.fromCharCode(64 + note.effect);
                          } else if (note.effect > 26) {
                            effectChar = String.fromCharCode(97 - 27 + note.effect);
                          }
                          effectString = effectChar + formatHex(note.param, 2, "0");
                        } else if (note.volEffect > 0) {
                          effectString = "v" + formatHex(note.volVal, 2, "0");
                        }
                      } else {
                        instrumentString = formatHex(note.instrument, 2, "0");
                        let effectHex = note.effect > 15
                          ? formatHexExtended(note.effect)
                          : formatHex(note.effect);
                        let effectParam = formatHex(note.param, 2, "0");
                        effectString = effectHex + effectParam;
                        if (effectString === "000") effectString = "...";

                        if (currentSong.typeId) {
                          const baseNote = periodNoteTable[note.period];
                          noteString = baseNote ? baseNote.name : "---";
                        } else {
                          if (note.index) {
                            let ftNote = FTNotes[note.index];
                            if (note.index === 97) ftNote = FTNotes[97];
                            noteString = ftNote ? ftNote.name : "???";
                          } else {
                            noteString = "---";
                            const baseNote = FTPeriods[note.period];
                            if (baseNote) {
                              const ftNote = FTNotes[baseNote];
                              if (ftNote) noteString = ftNote.name;
                            }
                          }
                        }
                      }
                    }

                    // 1. Note 行: 1空格 + Note + 1空格 (5 字符)
                    const nColor = (noteString === "---" || noteString === "???") ? cDim : cNote;
                    noteRow.append(" ", cDim);
                    noteRow.append(noteString, nColor);
                    noteRow.append(" ", cDim);

                    // 2. Inst 行: 2空格 + Inst + 1空格 (5 字符)
                    const iColor = (instrumentString === "00") ? cDim : cInst;
                    instRow.append("  ", cDim);
                    instRow.append(instrumentString, iColor);
                    instRow.append(" ", cDim);

                    // 3. Eff 行: 1空格 + Eff + 1空格 (5 字符)
                    const eColor = (effectString === "...") ? cDim : cEffect;
                    effRow.append(" ", cDim);
                    effRow.append(effectString, eColor);
                    effRow.append(" ", cDim);
                  }
                }

                rowsData.push(noteRow);
                rowsData.push(instRow);
                rowsData.push(effRow);
              }

            } else {
              // ==================== 纵向模式网格构建 ====================
              // 0. Header (Chn list)
              const headerRow = new GridRowBuilder();
              headerRow.append("       ", cBorderStrong);
              for (let i = 1; i <= patternWidth; i++) {
                const chnNum = i < 10 ? "0" + i : i;
                headerRow.append("   Chn " + chnNum + "   ", cBorderStrong);
              }
              rowsData.push(headerRow);

              // helper for notes
              function appendNoteDisplay(builder, note) {
                if (!note) {
                  builder.append("   --- .. ...  ", cDim);
                  return;
                }
                if (isChiptune3Mode) {
                  var noteStr = getOpenMptNoteName(note.note);
                  var instStr = note.instrument > 0 ? formatHex(note.instrument, 2, "0") : "00";
                  var effStr = "...";
                  if (note.effect > 0 || note.param > 0) {
                    var effectChar = ".";
                    if (note.effect > 0 && note.effect <= 26) {
                      effectChar = String.fromCharCode(64 + note.effect);
                    } else if (note.effect > 26) {
                      effectChar = String.fromCharCode(97 - 27 + note.effect);
                    }
                    effStr = effectChar + formatHex(note.param, 2, "0");
                  } else if (note.volEffect > 0) {
                    effStr = "v" + formatHex(note.volVal, 2, "0");
                  }

                  builder.append(" ", cDim);
                  if (noteStr === "---" || noteStr === "???") {
                    builder.append(noteStr, cDim);
                  } else {
                    builder.append(noteStr, cNote);
                  }
                  builder.append(" ", cDim);
                  if (instStr === "00") {
                    builder.append(instStr, cDim);
                  } else {
                    builder.append(instStr, cInst);
                  }
                  builder.append(" ", cDim);
                  if (effStr === "...") {
                    builder.append(effStr, cDim);
                  } else {
                    builder.append(effStr, cEffect);
                  }
                  builder.append(" ", cDim);
                  return;
                }

                let noteString = "";
                let instrumentString = formatHex(note.instrument, 2, "0");
                let effectHex = note.effect > 15
                  ? formatHexExtended(note.effect)
                  : formatHex(note.effect);
                let effectParam = formatHex(note.param, 2, "0");
                let effectString = effectHex + effectParam;
                if (effectString === "000") effectString = "...";

                if (currentSong.typeId) {
                  const baseNote = periodNoteTable[note.period];
                  noteString = baseNote ? baseNote.name : "---";
                } else {
                  if (note.index) {
                    let ftNote = FTNotes[note.index];
                    if (note.index === 97) ftNote = FTNotes[97];
                    noteString = ftNote ? ftNote.name : "???";
                  } else {
                    noteString = "---";
                    const baseNote = FTPeriods[note.period];
                    if (baseNote) {
                      const ftNote = FTNotes[baseNote];
                      if (ftNote) noteString = ftNote.name;
                    }
                  }
                }

                builder.append(" ", cDim);
                if (noteString === "---" || noteString === "???") {
                  builder.append(noteString, cDim);
                } else {
                  builder.append(noteString, cNote);
                }
                builder.append(" ", cDim);
                if (instrumentString === "00") {
                  builder.append(instrumentString, cDim);
                } else {
                  builder.append(instrumentString, cInst);
                }
                builder.append(" ", cDim);
                if (effectString === "...") {
                  builder.append(effectString, cDim);
                } else {
                  builder.append(effectString, cEffect);
                }
                builder.append(" ", cDim);
              }

              // 1-29. Note Rows
              for (var i = startRow; i <= endRow; i++) {
                const row = new GridRowBuilder();
                if (i < 0 || i >= pattern.length) {
                  row.append("       ", cDim);
                  for (let col = 0; col < patternWidth; col++) {
                    row.append("            ", cDim);
                  }
                } else {
                  const rowData = pattern[i];
                  const isCurrent = i === position.patternPos;
                  if (isCurrent) {
                    row.append("» ", cAccent);
                  } else {
                    row.append("  ", cDim);
                  }

                  let rowNumberStr = i.toString();
                  if (i < 10) rowNumberStr = "0" + rowNumberStr;
                  row.append(rowNumberStr + " ".repeat(5 - rowNumberStr.length), cTextMuted);

                  for (let col = 0; col < patternWidth; col++) {
                    appendNoteDisplay(row, rowData[col]);
                  }
                }
                rowsData.push(row);
              }
            }

            const cells = rowsData.map(r => r.cells);
            const colsCount = cells[0].length;
            const rowsCount = cells.length;
            const dpr = window.devicePixelRatio || 1;

            const highlightAlpha = (() => {
              const style = window.getComputedStyle(document.documentElement);
              let val = style.getPropertyValue("--pattern-row-highlight-alpha").trim();
              if (!val && patternView) {
                val = window.getComputedStyle(patternView).getPropertyValue("--pattern-row-highlight-alpha").trim();
              }
              const parsed = parseFloat(val);
              return isNaN(parsed) ? 0.12 : parsed;
            })();
            const curRowBgColor = { r: cAccent.r, g: cAccent.g, b: cAccent.b, a: highlightAlpha };
            const currentRowVal = isHorizontalMode
              ? (position.patternPos - startRow)
              : (position.patternPos - startRow + 1);

            patternGLRenderer.render(colsCount, rowsCount, cells, currentRowVal, curRowBgColor, cBorderStrong, isHorizontalMode, dpr);
            return;
          }

          // HTML DOM Fallback Path
          var patternRows = [];
          var patternViewLength = Math.floor((patternView.clientWidth - 16) / 64);
          const nbsp = "&nbsp;";
          const strI = `<span style="color: var(--border-strong); opacity: 0.4;">|</span>`;
          // Row Number Area (Indicator 2 + Num 3 + Spacer 2 = 7 characters total)
          // Header: 7 nbsp + |
          let channelLine = nbsp.repeat(7) + strI;
          for (let i = 1; i <= patternWidth; i++) {
            const chnNum = i < 10 ? "0" + i : i;
            channelLine += nbsp.repeat(3) + "Chn " + chnNum + nbsp.repeat(3) + strI;
          }

          patternRows.push(
            "<span style='font-size: 10px; opacity: 0.8;'>" + channelLine + "</span>",
          );

          for (var i = startRow; i <= endRow; i++) {
            if (i < 0 || i >= pattern.length) {
              patternRows.push(`<span class="pattern-row">${nbsp}</span>`);
            } else {
              const rowData = pattern[i];

              const isCurrent = i === position.patternPos;
              const rowClass = isCurrent ? "pattern-row pattern-row-current" : "pattern-row";

              // Indicator area (2 chars): "» " or "  "
              const indicator = isCurrent
                ? `<span class="pattern-indicator" style="color: var(--accent); font-weight: bold;">»</span>${nbsp}`
                : nbsp + nbsp;

              // Row number (up to 3 digits)
              let rowNumberStr = i.toString();
              if (i < 10) rowNumberStr = "0" + rowNumberStr;

              // Assemble start: [Indicator 2] [Num 2/3] [Padding to 7 total] [|]
              const rowNumHtml = `<span style="color: var(--text-muted); opacity: 0.7;">${rowNumberStr}</span>`;
              let rowHtml = indicator + rowNumHtml + nbsp.repeat(5 - rowNumberStr.length) + strI;

              for (let col = 0; col < patternWidth; col++) {
                rowHtml += getNoteDisplay(rowData[col]) + strI;
              }

              patternRows.push(
                `<span class="${rowClass}">${rowHtml}</span>`
              );
            }
          }
          patternView.innerHTML = patternRows.join("");
        }
      }
    }

    function getOpenMptNoteName(noteVal: number) {
      if (!noteVal || noteVal === 0) return "---";
      if (noteVal === 121) return "==="; // Note Off
      if (noteVal === 254) return "==="; // Note Cut
      if (noteVal === 255) return "^^^"; // Note Fade
      if (noteVal < 12 || noteVal > 120) return "???";

      var semitone = (noteVal - 12) % 12;
      var octave = Math.floor((noteVal - 12) / 12);
      var names = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
      return names[semitone] + octave;
    }

    function getNoteDisplay(note) {
      if (isChiptune3Mode) {
        var noteStr = getOpenMptNoteName(note.note);
        var instStr = note.instrument > 0 ? formatHex(note.instrument, 2, "0") : "00";
        var effStr = "...";
        if (note.effect > 0 || note.param > 0) {
          var effectChar = ".";
          if (note.effect > 0 && note.effect <= 26) {
            effectChar = String.fromCharCode(64 + note.effect);
          } else if (note.effect > 26) {
            effectChar = String.fromCharCode(97 - 27 + note.effect);
          }
          effStr = effectChar + formatHex(note.param, 2, "0");
        } else if (note.volEffect > 0) {
          effStr = "v" + formatHex(note.volVal, 2, "0");
        }

        const nbsp = "&nbsp;";
        let html = "";

        if (noteStr === "---" || noteStr === "???") {
          html += `<span style="color: var(--pattern-dim); opacity: 0.6;">${noteStr}</span>`;
        } else {
          html += `<span style="color: var(--pattern-note); font-weight: 600;">${noteStr}</span>`;
        }
        html += nbsp;
        if (instStr === "00") {
          html += `<span style="color: var(--pattern-dim); opacity: 0.5;">${instStr}</span>`;
        } else {
          html += `<span style="color: var(--pattern-inst);">${instStr}</span>`;
        }
        html += nbsp;
        if (effStr === "...") {
          html += `<span style="color: var(--pattern-dim); opacity: 0.5;">${effStr}</span>`;
        } else {
          html += `<span style="color: var(--pattern-effect);">${effStr}</span>`;
        }
        return nbsp + html + nbsp;
      }

      let noteString = "";
      let instrumentString = formatHex(note.instrument, 2, "0");
      let effectHex = note.effect > 15
        ? formatHexExtended(note.effect)
        : formatHex(note.effect);
      let effectParam = formatHex(note.param, 2, "0");
      let effectString = effectHex + effectParam;
      if (effectString === "000") effectString = "...";

      if (currentSong.typeId) {
        const baseNote = periodNoteTable[note.period];
        noteString = baseNote ? baseNote.name : "---";
      } else {
        if (note.index) {
          let ftNote = FTNotes[note.index];
          if (note.index === 97) ftNote = FTNotes[97];
          noteString = ftNote ? ftNote.name : "???";
        } else {
          noteString = "---";
          const baseNote = FTPeriods[note.period];
          if (baseNote) {
            const ftNote = FTNotes[baseNote];
            if (ftNote) noteString = ftNote.name;
          }
        }
      }

      const nbsp = "&nbsp;";
      let html = "";

      // Note (3 chars)
      if (noteString === "---" || noteString === "???") {
        html += `<span style="color: var(--pattern-dim); opacity: 0.6;">${noteString}</span>`;
      } else {
        html += `<span style="color: var(--pattern-note); font-weight: 600;">${noteString}</span>`;
      }

      html += nbsp; // 1 nbsp

      // Instrument (2 chars)
      if (instrumentString === "00") {
        html += `<span style="color: var(--pattern-dim); opacity: 0.5;">${instrumentString}</span>`;
      } else {
        html += `<span style="color: var(--pattern-inst);">${instrumentString}</span>`;
      }

      html += nbsp; // 1 nbsp

      // Effect (3 chars)
      if (effectString === "...") {
        html += `<span style="color: var(--pattern-dim); opacity: 0.5;">${effectString}</span>`;
      } else {
        html += `<span style="color: var(--pattern-effect);">${effectString}</span>`;
      }

      // Wrap with 1 nbsp on each side to reach 12 characters cell width
      return nbsp + html + nbsp;
    }

    function formatHex(i, length, padString) {
      let h = i.toString(16).toUpperCase();
      if (length && h.length < length) {
        padString = padString || "0";
        while (h.length < length) {
          h = padString + h;
        }
      }
      return h;
    }

    function formatHexExtended(i, length, padString) {
      let h = i.toString(36).toUpperCase();
      if (length && h.length < length) {
        padString = padString || "0";
        while (h.length < length) {
          h = padString + h;
        }
      }
      return h;
    }

    function clearScope() {
      // WebGL path: just clear GL canvas; show inactive label via overlay
      if (scopeGLRenderer) {
        scopeGLRenderer.clear();
        var inactiveLabel = document.getElementById("scopeInactiveLabel");
        if (inactiveLabel) {
          inactiveLabel.style.display = scopeActive ? "none" : "";
          inactiveLabel.textContent = t("player.scopeInactive", null, "inactive");
        }
        return;
      }
      // 2D fallback
      if (!scope || !scopeCanvas || !scopeWidth || !scopeHeight) return;
      scope.clearRect(0, 0, scopeWidth, scopeHeight);
      if (!scopeActive) {
        var dpr = scopeDpr || 1;
        var cs = window.getComputedStyle(container);
        var muted = cs.getPropertyValue("--text-soft").trim() || "#94a3b8";
        scope.fillStyle = hexWithAlpha(muted, 0.55);
        scope.font = (28 * dpr) + "px ui-monospace, SFMono-Regular, Menlo, monospace";
        scope.textBaseline = "middle";
        scope.textAlign = "center";
        scope.fillText(
          t("player.scopeInactive", null, "inactive"),
          scopeWidth / 2,
          scopeHeight / 2,
        );
        scope.textAlign = "start";
        scope.textBaseline = "alphabetic";
      }
    }

    function showAlert(message) {
      showToast(message, {
        variant: "danger",
        title: t("toast.warning", null, "Warning"),
        duration: 3600,
      });
      console.warn(message);
    }

    async function updateHeart() {
      // This is now handled by PlayerControls.vue
    }

    function switchMode() {
      switch (playmode) {
        case 0:
          postMode(0);
          modeButton.textContent = getModeLabel(0);
          break;
        case 1:
          postMode(1);
          modeButton.textContent = getModeLabel(1);
          break;
        case 2:
          postMode(2);
          modeButton.textContent = getModeLabel(2);
          break;
        case 3:
          postMode(3);
          modeButton.textContent = getModeLabel(3);
          break;
      }

      emitPlayerUiEvent("mode-change", {
        playmode: playmode,
        modeLabel: modeButton ? modeButton.textContent : "",
      });
    }

    function switchSortType(nextSortType) {
      if (Number.isFinite(nextSortType)) {
        sortType = Math.max(0, Math.min(9, Math.floor(nextSortType)));
      } else {
        sortType++;
        if (sortType >= 10) sortType = 0;
      }
      if (sortSelect) {
        sortSelect.value = String(sortType);
      }
      scheduleRenderPlaylist(currentPage);
    }

    function postMode(modeNum) {
      storedSettings.playmode = modeNum;
      localStorage.setItem("player_settings", JSON.stringify(storedSettings));
    }

    function titleChange() {
      if (firstplay) {
        updateProgressLabel(progressBar.value);
        updateVolumeLabel(volumeBar.value);

        if (
          titlekeyWords === undefined ||
          titlekeyWords === null ||
          titlekeyWords === ""
        ) {
          titlekeyWords = " " + t("player.untitled", null, "untitled");
        }

        var keyList = titlekeyWords.split("");
        var firstChar = keyList.shift();
        keyList.push(firstChar);
        titlekeyWords = keyList.join("");

        if (percentage != null) {
          document.title = Math.round(percentage) + "% | " + titlekeyWords;
        } else {
          document.title = titlekeyWords;
        }
      }
    }

    function addToHistory(filename) {
      if (isNavigatingHistory) {
        if (fmusicListActive === 2) {
          renderHistoryPlaylist();
        }
        return;
      }
      historyPlaylist = historyPlaylist.filter((item) => item.fn !== filename);
      historyPlaylist.unshift({ fn: filename, time: new Date().getTime() });
      if (historyPlaylist.length > 99) {
        historyPlaylist.pop();
      }
      localStorage.setItem("historyPlaylist", JSON.stringify(historyPlaylist));

      // 如果已登录，上报播放历史记录到云端
      if (username) {
        nuxtFetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename })
        }).catch(err => console.error("Failed to sync history to server:", err));
      }

      if (fmusicListActive === 2) {
        renderHistoryPlaylist();
      }
    }

    function syncLocalStorageHistoryToServer() {
      const hist = getAllHistory() || [];
      if (hist.length > 0) {
        const filenames = hist.map(item => item.fn);
        nuxtFetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filenames })
        }).then(() => {
          if (fmusicListActive === 2) {
            renderHistoryPlaylist();
          }
        }).catch(err => {
          console.error("Failed to sync local history to server:", err);
        });
      }
    }

    function updateTranslatedLabels() {
      // Update mode button label
      if (typeof playmode !== "undefined" && modeButton) {
        modeButton.textContent = getModeLabel(playmode);
      }

      // Update play/pause button label
      if (playButton) {
        var isPlaying = false;
        if (isNativeMode && nativeAudioEl) {
          isPlaying = !nativeAudioEl.paused;
        } else if (isChiptune3Mode && chiptune3Player) {
          isPlaying = chiptune3Player.getIsPlaying();
        } else if (typeof BassoonTracker !== "undefined") {
          isPlaying = BassoonTracker.isPlaying();
        }
        playButton.innerHTML = isPlaying
          ? t("player.pause", null, "Pause")
          : t("player.play", null, "Play");
      }

      // Update track number label if playing
      if (notitle && typeof numno !== "undefined") {
        notitle.innerHTML = t(
          "player.trackNumber",
          { number: numno },
          "No. {number}",
        );
      }

      // Update volume and progress labels
      if (volumeLabel && typeof volumeBar !== "undefined") {
        updateVolumeLabel(volumeBar.value);
      }
      if (progressLabel && typeof progressBar !== "undefined") {
        updateProgressLabel(progressBar.value);
      }

      // Update title keywords for scrolling title
      if (typeof fileNameplaying === "undefined") {
        titlekeyWords = " " + t("player.untitled", null, "untitled");
      }
    }

    // Listen for locale changes from i18n plugin
    window.addEventListener("app:locale-changed", updateTranslatedLabels);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPlayer);
  } else {
    initPlayer();
  }

  function resetSettings() {
    storedSettings = defaultSettings;
    localStorage.setItem("player_settings", JSON.stringify(storedSettings));
    updateUiSettings();
    // ── 响度均衡: reset AGC gain to unity ──────────────────────────
    currentNormGain = 1.0;
    if (_normGainNode) _normGainNode.gain.value = 1.0;
  }
  window.resetSettings = resetSettings;

  function updateUiSettings() {
    setCheckboxValue("setNav", storedSettings.setNav);
    setCheckboxValue("setScope", storedSettings.setScope);
    setCheckboxValue("setTotalScope", storedSettings.setTotalScope);
    setCheckboxValue("setChannelScope", storedSettings.setChannelScope);
    setCheckboxValue("setPattern", storedSettings.setPattern);
    setCheckboxValue("setComment", storedSettings.setComment);
    setCheckboxValue("setIntroduce", storedSettings.setIntroduce);
    setCheckboxValue("setForcedVolume", storedSettings.forcedVolume);
    setInputValue("setVolume", storedSettings.setVolume);
    setInputValue("setLooptimes", storedSettings.setLooptimes);
    setInputValue("setMusicSource", storedSettings.setMusicSource);
    setInputValue("setEngine", storedSettings.setEngine);
    setElementDisplayValue("dsetNav", storedSettings.setNav ? "block" : "none");
    scopeActive = storedSettings.setScope;
    setElementDisplayValue("scope", storedSettings.setScope ? "block" : "none");
    setElementDisplayValue("scopeTotalCell", storedSettings.setTotalScope !== false ? "" : "none");
    setElementDisplayValue("scopeChannelGrid", storedSettings.setChannelScope !== false ? "" : "none");
    // 派发事件让 Vue 组件感知设置变化（含 Histogram/Total/Channels 三项）
    window.dispatchEvent(new CustomEvent("player:scope-settings", {
      detail: {
        showHistogram: storedSettings.setScope !== false,
        showTotal: storedSettings.setTotalScope !== false,
        showChannels: storedSettings.setChannelScope !== false,
      }
    }));
    setElementDisplayValue("pattern", storedSettings.setPattern ? "block" : "none");
    setElementDisplayValue(
      "dsetComment",
      storedSettings.setComment ? "block" : "none",
    );
    setElementDisplayValue(
      "dsetIntroduce",
      storedSettings.setIntroduce ? "block" : "none",
    );
  }
  window.updateUiSettings = updateUiSettings;

  // 供 SettingsModal 直接同步内存 storedSettings 并立即生效
  function applyScopeSettings(setScope, setTotalScope, setChannelScope) {
    storedSettings.setScope = setScope;
    storedSettings.setTotalScope = setTotalScope;
    storedSettings.setChannelScope = setChannelScope;
    localStorage.setItem("player_settings", JSON.stringify(storedSettings));
    updateUiSettings();
  }
  window.applyScopeSettings = applyScopeSettings;

  // 供 SettingsModal 直接同步内存 storedSettings 并立即生效（通用设置项）
  function applyGeneralSettings(partial: Record<string, unknown>) {
    if (!partial || typeof partial !== "object") return;
    for (var k in partial) {
      if (Object.prototype.hasOwnProperty.call(partial, k)) {
        (storedSettings as any)[k] = partial[k];
      }
    }
    localStorage.setItem("player_settings", JSON.stringify(storedSettings));
    updateUiSettings();
  }
  window.applyGeneralSettings = applyGeneralSettings;

  async function clearHistory() {
    historyPlaylist = [];
    localStorage.setItem("historyPlaylist", JSON.stringify(historyPlaylist));

    if (username) {
      try {
        await nuxtFetch("/api/history", {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to clear server history:", err);
      }
    }

    showToast(t("history.cleared", null, "History cleared!"), {
      variant: "success",
      title: t("toast.history", null, "History"),
      duration: 2400,
    });

    if (fmusicListActive === 2) {
      renderHistoryPlaylist();
    }
  }
  function clearCachedPlaylist() {
    localStorage.removeItem("cachedPlaylist");
    localStorage.removeItem("cachedPlaylistVersion");
    showToast(t("cache.cleared", null, "Cached playlist cleared!"), {
      variant: "success",
      title: t("toast.cache", null, "Cache"),
      duration: 2400,
    });
  }

  function getAllHistory() {
    return historyPlaylist;
  }

  async function randomPlay() {
    try {
      const search = searchInput ? searchInput.value.trim() : "";
      const extensionsVal = getExtensionsVal();
      const modeVal = fmusicListActive;

      let filenamesParam = "";
      if (modeVal === 2) {
        const hist = getAllHistory() || [];
        filenamesParam = hist.map(item => item.fn).join(',');
      }

      const channelsVal = channelsSelect ? (channelsSelect as HTMLSelectElement).value : "all";
      const sizeVal = sizeSelect ? (sizeSelect as HTMLSelectElement).value : "all";

      const params = new URLSearchParams({
        search,
        extensions: extensionsVal,
        mode: String(modeVal),
        filenames: filenamesParam,
        channels: channelsVal,
        size: sizeVal
      });

      const res = await nuxtFetch(`/api/songs/random?${params.toString()}`);
      if (res && res.song) {
        play(mainFilePath + res.song.fn, res.song.id);
      } else {
        if (matchedData && matchedData.length > 0) {
          const randnum = Math.floor(Math.random() * matchedData.length);
          play(mainFilePath + matchedData[randnum]["fn"], matchedData[randnum]["id"]);
        } else {
          showToast(t("errors.requestFailed", null, "No track found."), { variant: "error" });
        }
      }
    } catch (error) {
      console.error("Failed to fetch random song", error);
    }
  }

  function play(url, trackId?, fromHistoryNav = false) {
    if (startMediaBridgeImpl) startMediaBridgeImpl(url);
    if (!fromHistoryNav) {
      isNavigatingHistory = false;
      historyCursor = 0;
    }
    oppChange = 0;
    oppRepet = 0;
    autoPlay = true;
    currentPlayTrackId = trackId !== undefined ? trackId : null;
    var fn = url ? url.substring(url.lastIndexOf('/') + 1).split('?')[0] : '';
    emitPlayerUiEvent('track-loading', { isTrackLoading: true });
    emitPlayerUiEvent('track-change', { fileName: fn, songTitle: '', fileUrl: url });
    if (songName && url) {
      songName.innerHTML =
        escapeHtml(fn) +
        ' <span class="spinner-border text-primary" role="status" aria-hidden="true" style="border-width: 4px;"></span>';
    }
    if (playItem) playItem(url);
  }

  window.play = play;
  window.resetSettings = resetSettings;
  window.clearHistory = clearHistory;
  window.clearCachedPlaylist = clearCachedPlaylist;
}
