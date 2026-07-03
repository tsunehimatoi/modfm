<script setup>
/**
 * InfoDrawer — 5 ear buttons + 1 shared drawer panel.
 *
 * Each ear is a vertical button. Clicking one opens the drawer
 * with that ear's content. The active ear appears to slide with
 * the panel via a "clone" ear inside the drawer.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import SettingsBody from "./SettingsBody.vue";

const { t, locale, locales, setLocale } = useI18n();
const colorMode = useColorMode();
const { authState, login, register, logout } = useAuthStore();

// ── Ears ─────────────────────────────────────────────────────────────
const ears = [
  { id: "guide",    label: "infoSidebar.ear.guide" },
  { id: "settings", label: "infoSidebar.ear.settings" },
  { id: "theme",    label: "infoSidebar.ear.theme" },
  { id: "language", label: "infoSidebar.ear.language" },
  { id: "account",  label: "infoSidebar.ear.account" },
];

// ── State ────────────────────────────────────────────────────────────
const activeTab = ref(null);     // which ear is active
const cloneY = ref(0);           // clone ear Y position
const earRefs = ref({});         // { guide: HTMLElement, ... }
const drawerShow = ref(false);   // v-if gate
const drawerOpen = ref(false);   // .is-open class (triggers CSS transition)

function setEarRef(id, el) { if (el) earRefs.value[id] = el; }

function measureY(id) {
  const el = earRefs.value[id];
  if (el) cloneY.value = el.getBoundingClientRect().top;
}

const CLOSE_DELAY = 300; // ms, must match CSS transition duration

function openDrawer(id) {
  measureY(id);
  activeTab.value = id;
  drawerShow.value = true;
  // Double-frame: ensure browser paints the initial (closed) state
  // before adding .is-open to trigger the CSS transition.
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        drawerOpen.value = true;
      });
    });
  });
}

function closeDrawer() {
  drawerOpen.value = false;
  setTimeout(() => {
    drawerShow.value = false;
    activeTab.value = null;
  }, CLOSE_DELAY);
}

function handleEarClick(id) {
  if (activeTab.value === id) {
    closeDrawer();
  } else if (activeTab.value) {
    // Switch tab: just change content, keep drawer open
    measureY(id);
    activeTab.value = id;
  } else {
    openDrawer(id);
  }
}

// Resize recalculation
function onResize() {
  if (activeTab.value) measureY(activeTab.value);
}
onMounted(() => window.addEventListener("resize", onResize));
onUnmounted(() => window.removeEventListener("resize", onResize));

// Escape to close
function onKeydown(e) { if (e.key === "Escape") closeDrawer(); }
watch(drawerOpen, (v) => {
  if (v) document.addEventListener("keydown", onKeydown);
  else document.removeEventListener("keydown", onKeydown);
});

// ── Tab content ──────────────────────────────────────────────────────
const themeList = ["light","dark","midnight","retro","ocean","forest","strawberry","golden","purple","blue","pink","cyan","orange","red","green","gray"];

const themePreview = {
  light:      { bg: '#f4f6fb', surface: '#ffffff', accent: '#2563eb', text: '#0f172a' },
  dark:       { bg: '#0f172a', surface: '#1e293b', accent: '#3b82f6', text: '#f8fafc' },
  midnight:   { bg: '#030712', surface: '#111827', accent: '#8b5cf6', text: '#f3f4f6' },
  retro:      { bg: '#fdf6e3', surface: '#ffffff', accent: '#cb4b16', text: '#586e75' },
  ocean:      { bg: '#f0fdfa', surface: '#ffffff', accent: '#0d9488', text: '#134e4a' },
  forest:     { bg: '#f2fce2', surface: '#ffffff', accent: '#65a30d', text: '#365314' },
  strawberry: { bg: '#fff1f2', surface: '#ffffff', accent: '#e11d48', text: '#881337' },
  golden:     { bg: '#0c0a09', surface: '#1c1917', accent: '#ca8a04', text: '#fafaf9' },
  purple:     { bg: '#1a0b2e', surface: '#2d1b3d', accent: '#9333ea', text: '#f3e8ff' },
  blue:       { bg: '#eff6ff', surface: '#ffffff', accent: '#2563eb', text: '#1e3a8a' },
  pink:       { bg: '#fdf2f8', surface: '#ffffff', accent: '#db2777', text: '#831843' },
  cyan:       { bg: '#ecfeff', surface: '#ffffff', accent: '#0891b2', text: '#164e63' },
  orange:     { bg: '#fff7ed', surface: '#ffffff', accent: '#ea580c', text: '#7c2d12' },
  red:        { bg: '#0f172a', surface: '#1f1f23', accent: '#dc2626', text: '#fee2e2' },
  green:      { bg: '#0a1f0a', surface: '#1a2e1a', accent: '#16a34a', text: '#dcfce7' },
  gray:       { bg: '#f9fafb', surface: '#ffffff', accent: '#6b7280', text: '#111827' },
};

const lightThemes = ["light","retro","ocean","forest","strawberry","blue","pink","cyan","orange","gray"];
const darkThemes  = ["dark","midnight","golden","purple","red","green"];
const langList = computed(() => (locales.value || locales).map(l => ({ code: l.code, label: l.label })));

import { MESSAGES } from "~/i18n";

const enMessages = computed(() => MESSAGES?.en || {});

/** Deep-merge English as base so `rawI18n.intro?.introWelcomeTail` falls back correctly */
function deepMerge(base, overlay) {
  if (!overlay || typeof overlay !== "object") return base;
  const out = { ...base };
  for (const k of Object.keys(overlay)) {
    out[k] = (base[k] && typeof base[k] === "object" && !Array.isArray(base[k]))
      ? deepMerge(base[k], overlay[k])
      : overlay[k];
  }
  return out;
}
const rawI18n = computed(() => deepMerge(enMessages.value, MESSAGES?.[locale.value] || {}));

function raw(key) {
  const parts = key.split(".");
  // Try current locale (already merged with en base)
  let v = rawI18n.value;
  for (const p of parts) { if (v == null) return []; v = v[p]; }
  return Array.isArray(v) ? v : [];
}

// ── Guide tab state ────────────────────────────────────────────────
const guideTab = ref("intro"); // 'intro' | 'tutorial' | 'credits'
const tutorialStep = ref(0);   // current tutorial slide 0-3

// Reset tutorial slide when switching to tutorial tab
watch(guideTab, (tab) => { if (tab === "tutorial") tutorialStep.value = 0; });

// ── Auth form state ─────────────────────────────────────────────────
const authTab = ref("login"); // 'login' | 'register'
const loginUsername = ref("");
const loginPassword = ref("");
const registerUsername = ref("");
const registerPassword = ref("");
const registerConfirmPassword = ref("");
const showLoginPw = ref(false);
const showRegisterPw = ref(false);
const showRegisterConfirmPw = ref(false);
const isSubmitting = ref(false);
const statusMessage = ref("");
const statusKind = ref("danger"); // 'success' | 'danger'

function setStatus(msg, kind = "danger") {
  statusMessage.value = msg || "";
  statusKind.value = kind || "danger";
}

function switchAuthTab(tab) {
  authTab.value = tab;
  setStatus("");
}

async function handleLogin(e) {
  if (isSubmitting.value) return;
  setStatus("");
  isSubmitting.value = true;
  try {
    await login(loginUsername.value.trim(), loginPassword.value);
    setStatus(t("auth.status.loggedIn", null, "Logged in."), "success");
    loginUsername.value = "";
    loginPassword.value = "";
  } catch (err) {
    const msg = err?.data?.statusMessage || err?.data?.message || err?.message || t("errors.requestFailed", null, "Request failed.");
    setStatus(msg, "danger");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleRegister(e) {
  if (isSubmitting.value) return;
  setStatus("");
  if (registerPassword.value !== registerConfirmPassword.value) {
    setStatus(t("auth.status.passwordMismatch", null, "Passwords do not match."), "danger");
    return;
  }
  isSubmitting.value = true;
  try {
    await register(registerUsername.value.trim(), registerPassword.value);
    setStatus(t("auth.status.accountCreated", null, "Account created."), "success");
    registerUsername.value = "";
    registerPassword.value = "";
    registerConfirmPassword.value = "";
    authTab.value = "login";
  } catch (err) {
    const msg = err?.data?.statusMessage || err?.data?.message || err?.message || t("errors.requestFailed", null, "Request failed.");
    setStatus(msg, "danger");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleLogout() {
  await logout();
}

// Programmatic open: called by window.openAuthModal / other components
function openAccountTab(subTab = "login") {
  authTab.value = subTab;
  setStatus("");
  if (activeTab.value === "account") {
    // Already on account tab — just switch sub-tab
    return;
  }
  if (activeTab.value) {
    measureY("account");
    activeTab.value = "account";
  } else {
    openDrawer("account");
  }
}

// Register legacy window helpers for player-app.ts and other components
onMounted(() => {
  window.openAuthModal = (t) => openAccountTab(t || "login");
  window.closeAuthModal = closeDrawer;
});
onUnmounted(() => {
  delete window.openAuthModal;
  delete window.closeAuthModal;
});
</script>

<template>
  <!-- ═════════════════════════════════════════════════════════════════
       EAR BAR
       ═════════════════════════════════════════════════════════════════ -->
  <nav class="id-bar" aria-label="Side toolbar">
    <button
      v-for="ear in ears" :key="ear.id"
      :ref="(el) => setEarRef(ear.id, el)"
      type="button"
      :class="['id-ear', 'ear-icon-' + ear.id, { active: activeTab === ear.id }]"
      @click.stop="handleEarClick(ear.id)"
      :style="{ visibility: activeTab === ear.id ? 'hidden' : 'visible' }"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="id-ear-icon">
        <!-- Guide: info circle -->
        <template v-if="ear.id === 'guide'">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </template>
        <!-- Settings: sliders -->
        <template v-else-if="ear.id === 'settings'">
          <path d="M4 20V13M4 9V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="4" cy="11" r="2.5" stroke="currentColor" stroke-width="1.8"/>
          <path d="M12 20V11M12 7V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="12" cy="9" r="2.5" stroke="currentColor" stroke-width="1.8"/>
          <path d="M20 20V15M20 11V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="20" cy="13" r="2.5" stroke="currentColor" stroke-width="1.8"/>
        </template>
        <!-- Theme: half-circle (light/dark) -->
        <template v-else-if="ear.id === 'theme'">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M12 2a10 10 0 1 0 0 20V2z" fill="currentColor" opacity="0.55"/>
        </template>
        <!-- Language: globe -->
        <template v-else-if="ear.id === 'language'">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" stroke-width="2"/>
        </template>
        <!-- Account: person -->
        <template v-else-if="ear.id === 'account'">
          <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/>
          <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </template>
      </svg>
      <span class="id-ear-label">{{ t(ear.label) }}</span>
    </button>
  </nav>

  <!-- ═════════════════════════════════════════════════════════════════
       DRAWER
       ═════════════════════════════════════════════════════════════════ -->
    <div v-if="drawerShow" class="id-drawer" :class="{ 'is-open': drawerOpen }">
      <!-- Backdrop -->
      <div class="id-backdrop" @click="closeDrawer" />

      <!-- Clone ear — slides with the drawer, positioned at active ear's Y -->
      <div
        class="id-clone-ear"
        :style="{ top: cloneY + 'px' }"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="id-ear-icon">
          <template v-if="activeTab === 'guide'">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </template>
          <template v-else-if="activeTab === 'settings'">
            <path d="M4 20V13M4 9V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="4" cy="11" r="2.5" stroke="currentColor" stroke-width="1.8"/>
            <path d="M12 20V11M12 7V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="12" cy="9" r="2.5" stroke="currentColor" stroke-width="1.8"/>
            <path d="M20 20V15M20 11V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="20" cy="13" r="2.5" stroke="currentColor" stroke-width="1.8"/>
          </template>
          <template v-else-if="activeTab === 'theme'">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 2a10 10 0 1 0 0 20V2z" fill="currentColor" opacity="0.55"/>
          </template>
          <template v-else-if="activeTab === 'language'">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" stroke-width="2"/>
          </template>
          <template v-else-if="activeTab === 'account'">
            <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/>
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </template>
        </svg>
        <span class="id-ear-label">{{ t(ears.find(e => e.id === activeTab)?.label || '') }}</span>
      </div>

      <!-- Panel -->
      <div class="id-panel">
        <!-- Guide -->
        <template v-if="activeTab === 'guide'">
          <div class="id-panel-head">
            <h3 class="id-panel-title">{{ t("intro.title") }}</h3>
            <button type="button" class="id-panel-close" @click="closeDrawer" :aria-label="t('common.close')">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
          </div>

          <!-- Guide Tab Bar -->
          <div class="id-guide-tabs">
            <button
              v-for="gt in [
                { id: 'intro', label: t('intro.tabs.intro') },
                { id: 'tutorial', label: t('intro.tabs.tutorial') },
                { id: 'credits', label: t('intro.tabs.credits') },
              ]"
              :key="gt.id"
              type="button"
              :class="['id-guide-tab', { active: guideTab === gt.id }]"
              @click="guideTab = gt.id"
            >
              {{ gt.label }}
            </button>
          </div>

          <div class="id-panel-body">

            <!-- ── Introduction Tab ──────────────────────────────── -->
            <template v-if="guideTab === 'intro'">
              <p class="id-text">
                {{ t("intro.introWelcome") }}
                <template v-if="rawI18n.intro?.introWelcomeTail">
                  <a href="https://modarchive.org" target="_blank" class="id-link">The Mod Archive</a> {{ t("intro.introWelcomeTail") }}
                </template>
              </p>
              <p class="id-text">{{ t("intro.introWelcomeNote") }}</p>
              <template v-if="rawI18n.intro?.introWhatTitle">
                <h4 class="id-subtitle">{{ t("intro.introWhatTitle") }}</h4>
                <p class="id-text">{{ t("intro.introWhatBody1") }}</p>
                <p class="id-text">{{ t("intro.introWhatBody2Lead") }} <a href="https://github.com/steffest/BassoonTracker" target="_blank" class="id-link">BassoonTracker</a> {{ t("intro.introWhatBody2Tail") }}</p>
                <p class="id-text">{{ t("intro.introWhatBody3") }}</p>
              </template>
              <h4 class="id-subtitle">{{ t("intro.introFeaturesTitle") }}</h4>
              <template v-if="raw('intro.introFeaturesAudio').length">
                <p class="id-features-subtitle">{{ t("intro.introFeaturesAudioTitle") }}</p>
                <ul class="id-list">
                  <li v-for="(feat, i) in raw('intro.introFeaturesAudio')" :key="i">{{ feat }}</li>
                </ul>
                <p class="id-features-subtitle">{{ t("intro.introFeaturesUITitle") }}</p>
                <ul class="id-list">
                  <li v-for="(feat, i) in raw('intro.introFeaturesUI')" :key="i">{{ feat }}</li>
                </ul>
              </template>
              <template v-else>
                <ul class="id-list">
                  <li v-for="(feat, i) in raw('intro.introFeatures')" :key="i">{{ feat }}</li>
                </ul>
              </template>
              <h4 class="id-subtitle">{{ t("intro.introTrackerTitle") }}</h4>
              <p class="id-text">{{ t("intro.introTrackerBody1") }}</p>
              <p class="id-text">{{ t("intro.introTrackerBody2") }}</p>
              <p v-if="rawI18n.intro?.introTrackerBody3" class="id-text">{{ t("intro.introTrackerBody3") }}</p>
            </template>

            <!-- ── Tutorial Tab ──────────────────────────────────── -->
            <template v-else-if="guideTab === 'tutorial'">
              <div class="id-slides">
                <div class="id-slide-steps">
                  <button v-for="i in 4" :key="i"
                    :class="['id-slide-dot', { active: tutorialStep === i - 1 }]"
                    @click="tutorialStep = i - 1"
                    :aria-label="'Step ' + i"
                  ></button>
                </div>

                <!-- ═══ Slide 1: Player Console ═══ -->
                <div v-if="tutorialStep === 0" class="id-slide" key="s1">
                  <h4 class="id-slide-title">{{ t("intro.tutorialStep1Title") }}</h4>
                  <p class="id-slide-desc">{{ t("intro.tutorialStep1Body") }}</p>
                  <div class="id-slide-visual">
                    <!-- === Header: chips left, actions right === -->
                    <div class="id-mock-ctrl-top">
                      <div class="id-mock-col">
                        <div class="id-mock-chips">
                          <span class="id-mock-chip track">No. 1234</span>
                          <span class="id-mock-chip">{{ t("intro.tutorialMock.chipRandom") }}</span>
                        </div>
                        <span class="id-mock-label">{{ t("intro.tutorialMock.labelTrackMode") }}</span>
                      </div>
                      <div class="id-mock-col right">
                        <div class="id-mock-actions">
                          <span class="id-mock-actlink"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10M8 10l4 4 4-4M5 20h14"/></svg>{{ t("intro.tutorialMock.actionDownload") }}</span>
                          <span class="id-mock-actlink"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14 21 3M21 3h-7M21 3v7M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5"/></svg>{{ t("intro.tutorialMock.actionModArchive") }}</span>
                          <span class="id-mock-actlink"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>{{ t("intro.tutorialMock.actionInfo") }}</span>
                        </div>
                        <span class="id-mock-label">{{ t("intro.tutorialMock.labelActions") }}</span>
                      </div>
                    </div>
                    <hr class="id-mock-divider">
                    <!-- === Controls: each button with own label === -->
                    <div class="id-mock-ctrl-area">
                      <div class="id-mock-col ctrl-main">
                        <span class="id-mock-btn-play"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg><span>{{ t("intro.tutorialMock.btnPlay") }}</span></span>
                        <span class="id-mock-label">{{ t("intro.tutorialMock.labelPlayPause") }}</span>
                      </div>
                      <div class="id-mock-col ctrl-sub">
                        <span class="id-mock-btn-sec"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg></span>
                        <span class="id-mock-label">{{ t("intro.tutorialMock.labelSwitchMode") }}</span>
                      </div>
                      <div class="id-mock-col ctrl-sub">
                        <span class="id-mock-btn-sec"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4l10 8-10 8V4zM19 5v14"/></svg></span>
                        <span class="id-mock-label">{{ t("intro.tutorialMock.labelNext") }}</span>
                      </div>
                      <div class="id-mock-col ctrl-sub">
                        <span class="id-mock-btn-like"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></span>
                        <span class="id-mock-label">{{ t("intro.tutorialMock.labelFavorite") }}</span>
                      </div>
                    </div>
                    <hr class="id-mock-divider">
                    <!-- === Mode legend === -->
                    <div class="id-mock-mode-legend">
                      <div class="id-mock-col">
                        <span class="id-mock-mode-card"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg></span>
                        <span class="id-mock-label"><b>{{ t("intro.tutorialMock.modeRandom") }}</b></span>
                      </div>
                      <div class="id-mock-col">
                        <span class="id-mock-mode-card"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></span>
                        <span class="id-mock-label"><b>{{ t("intro.tutorialMock.modeSequential") }}</b></span>
                      </div>
                      <div class="id-mock-col">
                        <span class="id-mock-mode-card"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"/></svg></span>
                        <span class="id-mock-label"><b>{{ t("intro.tutorialMock.modeSingleLoop") }}</b></span>
                      </div>
                      <div class="id-mock-col">
                        <span class="id-mock-mode-card"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6h12v12H6z"/></svg></span>
                        <span class="id-mock-label"><b>{{ t("intro.tutorialMock.modeStopAfter") }}</b></span>
                      </div>
                    </div>
                    <span class="id-mock-annot">{{ t("intro.tutorialMock.annotModeSwitch") }}</span>
                  </div>
                  
                </div>

                <!-- ═══ Slide 2: Song List ═══ -->
                <div v-if="tutorialStep === 1" class="id-slide" key="s2">
                  <h4 class="id-slide-title">{{ t("intro.tutorialStep2Title") }}</h4>
                  <p class="id-slide-desc">{{ t("intro.tutorialStep2Body") }}</p>
                  <div class="id-slide-visual">
                    <!-- Row 1: Source dropdown + search -->
                    <div class="id-mock-row">
                      <span class="id-mock-select">
                        <span>{{ t("intro.tutorialMock.filterAll") }}</span>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
                      </span>
                      <div class="id-mock-searchbar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <span>{{ t("intro.tutorialMock.filterSearch") }}</span>
                      </div>
                    </div>
                    <span class="id-mock-label" v-html="t('intro.tutorialMock.labelFilter')"></span>
                    <!-- Row 2: Filter bar -->
                    <div class="id-mock-row">
                      <span class="id-mock-fbtn active">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> {{ t("intro.tutorialMock.filterFormat") }}
                      </span>
                      <span class="id-mock-chip">{{ t("intro.tutorialMock.filterChannels") }} ▾</span>
                      <span class="id-mock-chip">{{ t("intro.tutorialMock.filterSize") }} ▾</span>
                      <span class="id-mock-chip">{{ t("intro.tutorialMock.filterSort") }} ▾</span>
                    </div>
                    <span class="id-mock-label" v-html="t('intro.tutorialMock.labelFormatFilter')"></span>
                    <!-- Format grid preview -->
                    <div class="id-mock-fmtgrid">
                      <span class="id-mock-fmtchip on"><i></i>XM<small>12k</small></span>
                      <span class="id-mock-fmtchip on"><i></i>MOD<small>8k</small></span>
                      <span class="id-mock-fmtchip on"><i></i>IT<small>6k</small></span>
                      <span class="id-mock-fmtchip on"><i></i>S3M<small>5k</small></span>
                      <span class="id-mock-fmtchip on"><i></i>MPTM<small>2k</small></span>
                      <span class="id-mock-fmtchip on"><i></i>UMX<small>892</small></span>
                      <span class="id-mock-fmtchip"><i></i>STM<small>1k</small></span>
                      <span class="id-mock-fmtchip"><i></i>FAR<small>456</small></span>
                      <span class="id-mock-fmtchip"><i></i>669<small>321</small></span>
                    </div>
                    <div class="id-mock-preset-row">
                      <span class="id-mock-preset on">{{ t("intro.tutorialMock.presetC3All") }}</span><span class="id-mock-preset">{{ t("intro.tutorialMock.presetBassoon") }}</span><span class="id-mock-preset">{{ t("intro.tutorialMock.presetMajor") }}</span>
                    </div>
                    <hr class="id-mock-divider">
                    <!-- Mini table -->
                    <div class="id-mock-table">
                      <div class="id-mock-thead">
                        <span class="id-mock-th num">No.</span>
                        <span class="id-mock-th info">{{ t("intro.tutorialMock.thInfo") }}</span>
                      </div>
                      <div class="id-mock-trow">
                        <span class="id-mock-td num">1</span>
                        <span class="id-mock-td info">
                          <span class="id-mock-td-title">Hyper Based - Final</span>
                          <span class="id-mock-td-meta"><b>XM</b> 16 Ch · 1.2 MB · song.xm</span>
                        </span>
                      </div>
                      <div class="id-mock-trow">
                        <span class="id-mock-td num">2</span>
                        <span class="id-mock-td info">
                          <span class="id-mock-td-title">Space Journey</span>
                          <span class="id-mock-td-meta"><b>MOD</b> 4 Ch · 86 KB · space.mod</span>
                        </span>
                      </div>
                      <div class="id-mock-trow">
                        <span class="id-mock-td num">3</span>
                        <span class="id-mock-td info">
                          <span class="id-mock-td-title">Crystal Dreams II</span>
                          <span class="id-mock-td-meta"><b>IT</b> 32 Ch · 3.8 MB · crystal.it</span>
                        </span>
                      </div>
                    </div>
                    <span class="id-mock-annot" v-html="t('intro.tutorialMock.annotPlaylist')"></span>
                  </div>
                  
                </div>

<!-- ═══ Slide 3: Visualization ═══ -->
                <div v-if="tutorialStep === 2" class="id-slide" key="s3">
                  <h4 class="id-slide-title">{{ t("intro.tutorialStep3Title") }}</h4>
                  <p class="id-slide-desc">{{ t("intro.tutorialStep3Body") }}</p>
                  <div class="id-slide-visual">
                    <div class="id-mock-ptrn-wrap">
                      <div class="id-mock-ptrn-head">
                        <span class="mpr-col" style="color:var(--pattern-note,#f43f5e)">{{ t("intro.tutorialMock.colNote") }}</span>
                        <span class="mpr-col" style="color:var(--pattern-inst,#3b82f6)">{{ t("intro.tutorialMock.colInstrument") }}</span>
                        <span class="mpr-col" style="color:var(--pattern-effect,#10b981)">{{ t("intro.tutorialMock.colEffect") }}</span>
                      </div>
                      <div class="id-mock-ptrn-row">
                        <span class="mpr-note">C-4</span><span class="mpr-dim"> </span><span class="mpr-inst">01</span><span class="mpr-dim"> </span><span class="mpr-fx">A04</span>
                      </div>
                      <div class="id-mock-ptrn-row">
                        <span class="mpr-note">D#5</span><span class="mpr-dim"> </span><span class="mpr-inst">02</span><span class="mpr-dim"> </span><span class="mpr-fx">102</span>
                      </div>
                      <div class="id-mock-ptrn-row">
                        <span class="mpr-dim">---</span><span class="mpr-dim"> </span><span class="mpr-dim">00</span><span class="mpr-dim"> </span><span class="mpr-dim">...</span>
                      </div>
                      <div class="id-mock-ptrn-row">
                        <span class="mpr-note">F-3</span><span class="mpr-dim"> </span><span class="mpr-inst">01</span><span class="mpr-dim"> </span><span class="mpr-fx">D00</span>
                      </div>
                      <div class="id-mock-ptrn-row">
                        <span class="mpr-note">G-4</span><span class="mpr-dim"> </span><span class="mpr-inst">03</span><span class="mpr-dim"> </span><span class="mpr-fx">F06</span>
                      </div>
                    </div>
                    <div class="id-mock-ptrn-legend">
                      <span><span class="dot-note"></span>{{ t("intro.tutorialMock.legendNote") }}</span>
                      <span><span class="dot-inst"></span>{{ t("intro.tutorialMock.legendInst") }}</span>
                      <span><span class="dot-fx"></span>{{ t("intro.tutorialMock.legendEffect") }}</span>
                      <span><span class="dot-empty"></span>{{ t("intro.tutorialMock.legendEmpty") }}</span>
                    </div>
                    <div class="id-mock-scopes">
                      <div class="id-mock-scope-row"><span class="id-mock-scope-label">CH1</span><span class="id-mock-scope-wave"><i style="width:72%"></i></span></div>
                      <div class="id-mock-scope-row"><span class="id-mock-scope-label">CH2</span><span class="id-mock-scope-wave"><i style="width:45%"></i></span></div>
                      <div class="id-mock-scope-row"><span class="id-mock-scope-label">CH3</span><span class="id-mock-scope-wave"><i style="width:88%"></i></span></div>
                    </div>
                    <span class="id-mock-annot">{{ t("intro.tutorialMock.annotScopes") }}</span>
                  </div>
                  
                </div>

                <!-- ═══ Slide 4: Account ═══ -->
                <div v-if="tutorialStep === 3" class="id-slide" key="s4">
                  <h4 class="id-slide-title">{{ t("intro.tutorialStep4Title") }}</h4>
                  <p class="id-slide-desc">{{ t("intro.tutorialStep4Body") }}</p>
                  <div class="id-slide-visual">
                    <div class="id-mock-login-box">
                      <div class="id-mock-login-tabs">
                        <span class="id-mock-tab active">{{ t("intro.tutorialMock.tabLogin") }}</span>
                        <span class="id-mock-tab">{{ t("intro.tutorialMock.tabRegister") }}</span>
                      </div>
                      <div class="id-mock-login-fields">
                        <span class="id-mock-input">{{ t("intro.tutorialMock.inputUsername") }}</span>
                        <span class="id-mock-input">{{ t("intro.tutorialMock.inputPassword") }}</span>
                        <span class="id-mock-btn-play" style="width:100%;justify-content:center;min-height:28px;font-size:0.72rem">{{ t("intro.tutorialMock.btnLogin") }}</span>
                      </div>
                    </div>
                    <hr class="id-mock-divider">
                    <div class="id-mock-benefits">
                      <div class="id-mock-col">
                        <span class="id-mock-mode-card"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></span>
                        <span class="id-mock-label"><b>{{ t("intro.tutorialMock.featureFavSync") }}</b></span>
                      </div>
                      <div class="id-mock-col">
                        <span class="id-mock-mode-card"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
                        <span class="id-mock-label"><b>{{ t("intro.tutorialMock.featureHistory") }}</b></span>
                      </div>
                      <div class="id-mock-col">
                        <span class="id-mock-mode-card"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg></span>
                        <span class="id-mock-label"><b>{{ t("intro.tutorialMock.featureCrossDevice") }}</b></span>
                      </div>
                    </div>
                    <span class="id-mock-annot">{{ t("intro.tutorialMock.annotAccount") }}</span>
                  </div>
                  
                </div>

                <div class="id-slide-nav">
                  <button class="id-slide-nav-btn" :disabled="tutorialStep === 0" @click="tutorialStep--">{{ t("intro.tutorialMock.btnPrev") }}</button>
                  <span class="id-slide-pos">{{ tutorialStep + 1 }} / 4</span>
                  <button class="id-slide-nav-btn" :disabled="tutorialStep === 3" @click="tutorialStep++">{{ t("intro.tutorialMock.btnNext") }}</button>
                </div>
              </div>
            </template>

            <!-- ── Credits Tab ───────────────────────────────────── -->
            <template v-else-if="guideTab === 'credits'">
              <h4 class="id-subtitle">{{ t("intro.creditsTitle") }}</h4>
              <p class="id-text">{{ t("intro.creditsIntro") }}</p>

              <!-- Data Source -->
              <h4 class="id-subtitle" style="font-size:0.82rem;margin-top:1rem">{{ t("intro.creditsDataSourceTitle") }}</h4>
              <div class="id-credits-grid">
                <a href="https://modarchive.org" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsModArchiveLabel") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsModArchiveDesc") }}</span>
                </a>
              </div>

              <!-- Engines -->
              <h4 class="id-subtitle" style="font-size:0.82rem;margin-top:1rem">{{ t("intro.creditsEngineTitle") }}</h4>
              <div class="id-credits-grid">
                <a href="https://github.com/steffest/BassoonTracker" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsBassoonLabel") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsBassoonDesc") }}</span>
                </a>
                <a href="https://github.com/DrSnuggles/chiptune" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsChiptune3Label") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsChiptune3Desc") }}</span>
                </a>
                <a href="https://lib.openmpt.org/" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsLibopenmptLabel") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsLibopenmptDesc") }}</span>
                </a>
              </div>

              <!-- Toolchain -->
              <h4 class="id-subtitle" style="font-size:0.82rem;margin-top:1rem">{{ t("intro.creditsToolchainTitle") }}</h4>
              <div class="id-credits-grid">
                <a href="https://emscripten.org/" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsEmscriptenLabel") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsEmscriptenDesc") }}</span>
                </a>
                <a href="https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsAudioWorkletLabel") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsAudioWorkletDesc") }}</span>
                </a>
                <a href="https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsWebGLLabel") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsWebGLDesc") }}</span>
                </a>
              </div>

              <!-- Frameworks -->
              <h4 class="id-subtitle" style="font-size:0.82rem;margin-top:1rem">{{ t("intro.creditsFrameworkTitle") }}</h4>
              <div class="id-credits-grid">
                <a href="https://nuxt.com/" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsNuxtLabel") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsNuxtDesc") }}</span>
                </a>
                <a href="https://vuejs.org/" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsVueLabel") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsVueDesc") }}</span>
                </a>
                <a href="https://tailwindcss.com/" target="_blank" class="id-credit-card">
                  <span class="id-credit-name">{{ t("intro.creditsTailwindLabel") }}</span>
                  <span class="id-credit-desc">{{ t("intro.creditsTailwindDesc") }}</span>
                </a>
              </div>
            </template>

          </div>
        </template>

        <!-- Settings -->
        <template v-else-if="activeTab === 'settings'">
          <div class="id-panel-head">
            <h3 class="id-panel-title">{{ t("settings.title") }}</h3>
            <button type="button" class="id-panel-close" @click="closeDrawer" :aria-label="t('common.close')">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
          </div>
          <div class="id-panel-body">
            <SettingsBody />
          </div>
        </template>

        <!-- Theme -->
        <template v-else-if="activeTab === 'theme'">
          <div class="id-panel-head">
            <h3 class="id-panel-title">{{ t("infoSidebar.ear.theme") }}</h3>
            <button type="button" class="id-panel-close" @click="closeDrawer" :aria-label="t('common.close')">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
          </div>
          <div class="id-panel-body">
            <!-- Dark themes -->
            <p class="id-theme-section-label">Dark</p>
            <div class="id-theme-grid">
              <button
                v-for="v in darkThemes" :key="v"
                class="id-theme-card"
                :class="{ active: colorMode.preference === v }"
                :style="{
                  '--tp-accent': themePreview[v]?.accent,
                  '--tp-surface': themePreview[v]?.surface,
                  '--tp-bg': themePreview[v]?.bg,
                  '--tp-text': themePreview[v]?.text,
                }"
                @click="colorMode.preference = v"
              >
                <span class="id-theme-swatch">
                  <span class="id-theme-band id-theme-band--accent"></span>
                  <span class="id-theme-band id-theme-band--surface"></span>
                  <span class="id-theme-band id-theme-band--bg">
                    <span class="id-theme-label">{{ t(`settings.themes.${v}`) }}</span>
                  </span>
                </span>
              </button>
            </div>
            <!-- Light themes -->
            <p class="id-theme-section-label">Light</p>
            <div class="id-theme-grid">
              <button
                v-for="v in lightThemes" :key="v"
                class="id-theme-card"
                :class="{ active: colorMode.preference === v }"
                :style="{
                  '--tp-accent': themePreview[v]?.accent,
                  '--tp-surface': themePreview[v]?.surface,
                  '--tp-bg': themePreview[v]?.bg,
                  '--tp-text': themePreview[v]?.text,
                }"
                @click="colorMode.preference = v"
              >
                <span class="id-theme-swatch">
                  <span class="id-theme-band id-theme-band--accent"></span>
                  <span class="id-theme-band id-theme-band--surface"></span>
                  <span class="id-theme-band id-theme-band--bg">
                    <span class="id-theme-label">{{ t(`settings.themes.${v}`) }}</span>
                  </span>
                </span>
              </button>
            </div>
          </div>
        </template>

        <!-- Language -->
        <template v-else-if="activeTab === 'language'">
          <div class="id-panel-head">
            <h3 class="id-panel-title">{{ t("infoSidebar.ear.language") }}</h3>
            <button type="button" class="id-panel-close" @click="closeDrawer" :aria-label="t('common.close')">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
          </div>
          <div class="id-panel-body id-grid">
            <button v-for="l in langList" :key="l.code" class="id-item" :class="{ active: locale === l.code }" @click="setLocale(l.code)">{{ l.label }}</button>
          </div>
        </template>

        <!-- Account -->
        <template v-else-if="activeTab === 'account'">
          <div class="id-panel-head">
            <h3 class="id-panel-title">{{ t("infoSidebar.ear.account") }}</h3>
            <button type="button" class="id-panel-close" @click="closeDrawer" :aria-label="t('common.close')">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
          </div>
          <div class="id-panel-body id-account">
            <!-- Logged-in state -->
            <template v-if="authState.loggedIn">
              <div class="id-auth-user">
                <div class="id-auth-avatar">
                  <svg viewBox="0 0 24 24" class="w-5 h-5"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                </div>
                <div class="id-auth-user-info">
                  <p class="id-auth-username">{{ authState.username }}</p>
                  <p class="id-auth-sub">{{ t("playlist.sourceFavorites") }} &middot; {{ t("playlist.sourceHistory") }}</p>
                </div>
              </div>
              <button class="id-btn id-btn-danger" @click="handleLogout">
                {{ t("auth.logout") }}
              </button>
            </template>

            <!-- Logged-out: login/register forms -->
            <template v-else>
              <p class="id-text">{{ t("intro.introWelcome") }} <strong>{{ t("auth.tabs.login") }}</strong> / <strong>{{ t("auth.tabs.register") }}</strong></p>

              <!-- Tab toggle -->
              <nav class="id-auth-tabs">
                <button :class="['id-auth-tab', { active: authTab === 'login' }]" @click="switchAuthTab('login')">
                  {{ t("auth.tabs.login") }}
                </button>
                <button :class="['id-auth-tab', { active: authTab === 'register' }]" @click="switchAuthTab('register')">
                  {{ t("auth.tabs.register") }}
                </button>
              </nav>

              <!-- Login form -->
              <form v-show="authTab === 'login'" class="id-auth-form" @submit.prevent="handleLogin">
                <label class="id-field">
                  <span class="id-field-label">{{ t("auth.form.username") }}</span>
                  <input v-model="loginUsername" type="text" class="id-input" autocomplete="username" minlength="3" maxlength="32" required />
                </label>
                <label class="id-field">
                  <span class="id-field-label">{{ t("auth.form.password") }}</span>
                  <div class="id-input-wrap">
                    <input v-model="loginPassword" :type="showLoginPw ? 'text' : 'password'" class="id-input" autocomplete="current-password" minlength="6" maxlength="72" required />
                    <button type="button" class="id-input-eye" @click="showLoginPw = !showLoginPw">
                      <svg v-if="showLoginPw" viewBox="0 0 24 24" class="w-4 h-4"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                      <svg v-else viewBox="0 0 24 24" class="w-4 h-4"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                </label>
                <button type="submit" class="id-btn id-btn-primary id-btn-full" :disabled="isSubmitting">
                  <span v-if="isSubmitting" class="id-spinner"></span>
                  {{ t("auth.actions.login") }}
                </button>
              </form>

              <!-- Register form -->
              <form v-show="authTab === 'register'" class="id-auth-form" @submit.prevent="handleRegister">
                <label class="id-field">
                  <span class="id-field-label">{{ t("auth.form.username") }}</span>
                  <input v-model="registerUsername" type="text" class="id-input" autocomplete="username" minlength="3" maxlength="32" required />
                </label>
                <label class="id-field">
                  <span class="id-field-label">{{ t("auth.form.password") }}</span>
                  <div class="id-input-wrap">
                    <input v-model="registerPassword" :type="showRegisterPw ? 'text' : 'password'" class="id-input" autocomplete="new-password" minlength="6" maxlength="72" required />
                    <button type="button" class="id-input-eye" @click="showRegisterPw = !showRegisterPw">
                      <svg v-if="showRegisterPw" viewBox="0 0 24 24" class="w-4 h-4"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                      <svg v-else viewBox="0 0 24 24" class="w-4 h-4"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                </label>
                <label class="id-field">
                  <span class="id-field-label">{{ t("auth.form.confirmPassword") }}</span>
                  <div class="id-input-wrap">
                    <input v-model="registerConfirmPassword" :type="showRegisterConfirmPw ? 'text' : 'password'" class="id-input" autocomplete="new-password" minlength="6" maxlength="72" required />
                    <button type="button" class="id-input-eye" @click="showRegisterConfirmPw = !showRegisterConfirmPw">
                      <svg v-if="showRegisterConfirmPw" viewBox="0 0 24 24" class="w-4 h-4"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                      <svg v-else viewBox="0 0 24 24" class="w-4 h-4"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                </label>
                <button type="submit" class="id-btn id-btn-secondary id-btn-full" :disabled="isSubmitting">
                  <span v-if="isSubmitting" class="id-spinner"></span>
                  {{ t("auth.actions.createAccount") }}
                </button>
              </form>

              <!-- Status message -->
              <div v-if="statusMessage" :class="['id-auth-status', statusKind]">
                <svg viewBox="0 0 24 24" class="w-4 h-4 flex-shrink-0">
                  <template v-if="statusKind === 'success'">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
                    <path d="M8 12l2.5 2.5L16 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </template>
                  <template v-else>
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
                    <path d="M12 8v4m0 4h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </template>
                </svg>
                <span>{{ statusMessage }}</span>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════════════════
   EAR BAR
   ═══════════════════════════════════════════════════════════════════ */
.id-bar {
  position: fixed;
  left: 0; top: 0; bottom: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 5px;
  padding-left: 0;
}

.id-ear {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 28px;
  height: 66px;
  padding: 5px 3px;
  border: none;
  border-radius: 0 7px 7px 0;
  background: var(--bg, #0f172a);
  color: var(--text-muted, #64748b);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  margin: 0;
  font: inherit;
  line-height: 1;
  flex-shrink: 0;
  text-decoration: none;
  position: relative;
}
/* Colored right-edge indicator for identifiability */
.id-ear::after {
  content: '';
  position: absolute;
  right: 0; top: 10px; bottom: 10px;
  width: 0;
  border-radius: 1px;
  transition: all 0.2s ease;
}
/* Colored bar only visible on hover */
.id-ear.ear-icon-guide:hover::after    { width: 2px; background: var(--accent-indigo,  #818cf8); }
.id-ear.ear-icon-settings:hover::after { width: 2px; background: var(--accent-amber,  #f59e0b); }
.id-ear.ear-icon-theme:hover::after    { width: 2px; background: var(--accent-violet, #a78bfa); }
.id-ear.ear-icon-language:hover::after { width: 2px; background: var(--accent-teal,   #2dd4bf); }
.id-ear.ear-icon-account:hover::after  { width: 2px; background: var(--accent-rose,   #fb7185); }

/* Icon tints */
.ear-icon-guide .id-ear-icon    { color: var(--accent-indigo, #818cf8); }
.ear-icon-settings .id-ear-icon { color: var(--accent-amber,  #f59e0b); }
.ear-icon-theme .id-ear-icon    { color: var(--accent-violet, #a78bfa); }
.ear-icon-language .id-ear-icon { color: var(--accent-teal,   #2dd4bf); }
.ear-icon-account .id-ear-icon  { color: var(--accent-rose,   #fb7185); }

.id-ear:hover {
  background: var(--surface-2, rgba(255,255,255,0.08));
  color: var(--text);
}
.id-ear:hover .id-ear-icon { color: inherit; }


.id-ear-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 0.58rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  line-height: 1.1;
  white-space: nowrap;
}
.id-ear-icon { flex-shrink: 0; }

/* ═══════════════════════════════════════════════════════════════════
   DRAWER
   ═══════════════════════════════════════════════════════════════════ */
.id-drawer {
  position: fixed;
  inset: 0;
  z-index: 500;
}

.id-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15,23,42,0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

/* Clone ear — slides with the drawer, at right edge of panel */
.id-clone-ear {
  position: fixed;
  left: 396px;
  z-index: 601;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 32px;
  height: 66px;
  padding: 5px 3px;
  border: none;
  border-radius: 0 7px 7px 0;
  background: var(--bg, #0f172a);
  color: var(--text);
  user-select: none;
  font: inherit;
  line-height: 1;
  pointer-events: none;
}

/* Panel */
.id-panel {
  position: fixed;
  left: 0; top: 0; bottom: 0;
  width: 400px;
  max-width: 82vw;
  display: flex;
  flex-direction: column;
  background: var(--surface, rgba(15,23,42,0.99));
  border-right: 1px solid var(--border, rgba(128,128,128,0.15));
  box-shadow: 6px 0 32px rgba(0,0,0,0.3);
  z-index: 600;
  padding-left: 4px;
}

.id-panel-head {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border, rgba(128,128,128,0.1));
  flex-shrink: 0;
  background: var(--surface, rgba(15,23,42,0.99));
}
.id-panel-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  flex: 1;
}
.id-panel-close {
  display: none;  /* hidden on desktop, shown on mobile */
  width: 32px; height: 32px;
  flex-shrink: 0;
  align-items: center; justify-content: center;
  border: none; border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.id-panel-close:hover { background: var(--surface-2); color: var(--text); }

.id-panel-body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
  background: var(--bg, #0f172a);
}

/* Generic body styles */
.id-text { margin: 0 0 0.75rem; font-size: 0.85rem; line-height: 1.7; color: var(--text-muted, #94a3b8); }
.id-subtitle { margin: 1.25rem 0 0.5rem; font-size: 0.95rem; font-weight: 700; color: var(--text); }
.id-features-subtitle { margin: 0.75rem 0 0.4rem; font-size: 0.82rem; font-weight: 650; color: var(--text-soft); }

/* ── Tutorial slides ────────────────────────────────────────────── */
.id-slides {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 100%;
}
.id-slide-steps {
  display: flex;
  justify-content: center;
  gap: 8px;
}
.id-slide-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  border: none; padding: 0;
  background: var(--border);
  cursor: pointer;
  transition: all 0.2s ease;
}
.id-slide-dot.active {
  background: var(--accent, #6366f1);
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent, #6366f1) 50%, transparent);
}
.id-slide-dot:hover:not(.active) { background: var(--text-soft); }

/* ── Slide ─────────────────────────────────────────────────────── */
.id-slide {
  animation: id-slide-in 0.3s ease;
  flex: 1;
  display: flex;
  flex-direction: column;
}
@keyframes id-slide-in {
  from { opacity: 0; transform: translateX(10px); }
  to   { opacity: 1; transform: translateX(0); }
}
.id-slide-visual {
  background: var(--surface-2, rgba(255,255,255,0.04));
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  margin: auto 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}
.id-slide-title {
  margin: 0 0 4px;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text);
  text-align: center;
  flex-shrink: 0;
}
.id-slide-desc {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.55;
  color: var(--text-muted);
  text-align: center;
  flex-shrink: 0;
}
.id-slide-list {
  margin-top: 4px;
}
.id-slide-pos {
  font-size: 0.72rem;
  color: var(--text-soft);
  display: flex; align-items: center;
}

/* ── Nav buttons ────────────────────────────────────────────────── */
.id-slide-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  position: sticky;
  bottom: 0;
  padding: 10px 0 6px;
  background: var(--bg, #0f172a);
  border-top: 1px solid var(--border);
  z-index: 10;
}
.id-slide-nav-btn {
  padding: 7px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2, rgba(255,255,255,0.04));
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.id-slide-nav-btn:hover:not(:disabled) {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 6%, transparent);
}
.id-slide-nav-btn:disabled { opacity: 0.35; cursor: default; }

/* ── Mock: chip (matches real .chip) ────────────────────────────── */
.id-mock-chips {
  display: flex; flex-wrap: wrap; gap: 5px; justify-content: center;
}
.id-mock-chip {
  display: inline-flex; align-items: center;
  border-radius: 999px;
  padding: 0.18rem 0.5rem;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-2) 65%, transparent);
  color: var(--text-soft);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.id-mock-chip.track {
  color: var(--accent-strong);
  border-color: rgba(37, 99, 235, 0.35);
  background: rgba(37, 99, 235, 0.06);
}
.id-mock-chip.accent {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent);
}

/* ── Mock: track name ───────────────────────────────────────────── */
.id-mock-track-name {
  font-size: 0.85rem; font-weight: 650; color: var(--text);
}

/* ── Mock: player controls (old grid — kept for compatibility) ──── */
.id-mock-ctrl-grid {
  display: grid;
  grid-template-columns: 1fr repeat(3, auto);
  gap: 0.45rem;
  align-items: center;
  width: 100%;
}
.id-mock-btn-play {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 0.45rem;
  min-height: 36px;
  padding: 0 1rem;
  border: none;
  border-radius: 12px;
  background: var(--accent, #6366f1);
  color: #fff;
  font-size: 0.78rem;
  font-weight: 800;
  cursor: default;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--accent, #6366f1) 35%, transparent);
}
.id-mock-btn-sec {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface, rgba(255,255,255,0.02));
  color: var(--text);
  cursor: default;
}
.id-mock-btn-like {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px;
  border: 1px solid var(--danger, #ef4444);
  border-radius: 10px;
  background: color-mix(in srgb, var(--danger, #ef4444) 6%, transparent);
  color: var(--danger, #ef4444);
  cursor: default;
}

/* ── Mock: progress bar ─────────────────────────────────────────── */
.id-mock-progress {
  width: 100%; height: 5px; border-radius: 3px;
  background: var(--surface-2); overflow: hidden;
}
.id-mock-progress-fill {
  display: block; width: 48%; height: 100%; border-radius: 3px;
  background: var(--accent, #6366f1);
}

/* ── Mock: action links (matches .action-link) ──────────────────── */
.id-mock-actions {
  display: flex; flex-wrap: wrap; gap: 0.45rem; justify-content: center;
}
.id-mock-actlink {
  display: inline-flex; align-items: center;
  gap: 0.32rem;
  padding: 0.22rem 0.45rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  color: var(--text);
  font-weight: 600;
  font-size: 0.65rem;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* ── Mock: mode labels ──────────────────────────────────────────── */
.id-mock-mode-hint {
  display: flex; gap: 6px; flex-wrap: wrap; justify-content: center;
  font-size: 0.6rem; color: var(--text-soft);
}
.id-mock-mode-hint span {
  padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--border);
}

/* ── Mock: tabs ─────────────────────────────────────────────────── */
.id-mock-tabs {
  display: flex; gap: 2px;
  background: var(--surface-2, rgba(255,255,255,0.04));
  border-radius: 10px; padding: 3px;
}
.id-mock-tab {
  padding: 4px 12px; border-radius: 8px;
  font-size: 0.7rem; color: var(--text-muted); font-weight: 500;
}
.id-mock-tab.active {
  background: var(--accent, #6366f1); color: #fff;
}

/* ── Mock: search bar (matches real input) ──────────────────────── */
.id-mock-searchbar {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 2.5rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2, rgba(255,255,255,0.04));
  color: var(--text-soft); font-size: 0.75rem;
}
.id-mock-searchbar svg { color: var(--text-muted); flex-shrink: 0; }

/* ── Mock: filter row ───────────────────────────────────────────── */
.id-mock-filter-row {
  display: flex; flex-wrap: wrap; gap: 5px; justify-content: center;
}

/* ── Mock: format grid (matches .ff-chip) ───────────────────────── */
.id-mock-fmtgrid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; width: 100%;
}
.id-mock-fmtchip {
  display: flex; align-items: center; gap: 3px;
  padding: 2px 5px; border-radius: 6px;
  border: 1px solid var(--border);
  font-size: 0.58rem; font-weight: 600; color: var(--text-muted);
}
.id-mock-fmtchip.on {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 6%, transparent);
}
.id-mock-fmtdot {
  width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
  background: var(--accent, #6366f1);
}
.id-mock-fmttag {
  font-size: 0.48rem; color: var(--text-soft);
  background: var(--surface-2); padding: 0 3px; border-radius: 3px;
}
.id-mock-fmtchip small { color: var(--text-soft); margin-left: auto; font-size: 0.5rem; }

/* ── Mock: preset buttons ───────────────────────────────────────── */
.id-mock-presets {
  display: flex; flex-wrap: wrap; gap: 4px; justify-content: center;
}
.id-mock-preset {
  padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.6rem; color: var(--text-muted); font-weight: 500;
}
.id-mock-preset.on {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent);
}

/* ── Mock: pattern view with tracker notation ───────────────────── */
.id-mock-ptrn-wrap {
  width: 100%; display: flex; flex-direction: column; gap: 3px;
}
.id-mock-ptrn-labels {
  display: grid; grid-template-columns: 2fr 1fr 1fr 2fr; gap: 4px;
  font-size: 0.55rem; color: var(--text-soft); text-align: center;
  padding-bottom: 4px; border-bottom: 1px solid var(--border);
  text-transform: uppercase; letter-spacing: 0.08em;
}
.id-mock-ptrn-row {
  display: flex; gap: 6px;
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 0.72rem; line-height: 1.5;
  justify-content: center;
}
.mpr-note  { color: var(--pattern-note, #f43f5e); font-weight: 600; min-width: 2.2em; }
.mpr-inst  { color: var(--pattern-inst, #3b82f6); font-weight: 600; min-width: 1.5em; }
.mpr-fx    { color: var(--pattern-effect, #10b981); font-weight: 600; min-width: 2.2em; }
.mpr-dim   { color: var(--pattern-dim, #94a3b8); }

/* ── Mock: channel scopes ────────────────────────────────────────── */
.id-mock-scopes {
  width: 100%; display: flex; flex-direction: column; gap: 5px;
}
.id-mock-scope-row {
  display: flex; align-items: center; gap: 8px;
}
.id-mock-scope-label {
  width: 26px; font-size: 0.55rem; font-weight: 700;
  color: var(--text-soft); text-align: right; flex-shrink: 0;
  letter-spacing: 0.06em;
}
.id-mock-scope-wave {
  flex: 1; height: 8px; border-radius: 4px;
  background: var(--surface-2); overflow: hidden;
}
.id-mock-scope-wave .id-mock-scope-fill {
  display: block; height: 100%; border-radius: 4px;
  background: var(--accent-2, #f97316);
  animation: id-scope-live 1.2s ease-in-out infinite alternate;
}
@keyframes id-scope-live {
  from { width: 35%; } to { width: 75%; }
}

/* ── Mock: settings rows ────────────────────────────────────────── */
.id-mock-setting-rows {
  width: 100%; display: flex; flex-direction: column; gap: 6px;
}
.id-mock-srow {
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 0;
}
.id-mock-slabel {
  font-size: 0.72rem; color: var(--text);
}
.id-mock-stoggle {
  width: 32px; height: 18px; border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  position: relative; transition: all 0.2s;
}
.id-mock-stoggle::after {
  content: ''; position: absolute;
  top: 2px; left: 2px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--text-muted); transition: all 0.2s;
}
.id-mock-stoggle.on {
  background: color-mix(in srgb, var(--accent, #6366f1) 20%, transparent);
  border-color: var(--accent, #6366f1);
}
.id-mock-stoggle.on::after {
  left: 16px; background: var(--accent, #6366f1);
}

/* ── Mock: theme strip ──────────────────────────────────────────── */
.id-mock-theme-strip {
  display: flex; gap: 5px; flex-wrap: wrap; justify-content: center;
}
.id-mock-cdot {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid var(--border); box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}

/* ── Mock: section divider ──────────────────────────────────────── */
.id-mock-divider {
  width: 100%; height: 0; border: none;
  border-top: 1px solid var(--border);
  margin: 2px 0;
}

/* ── Mock: per-element column + label ───────────────────────────── */
.id-mock-col {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
}
.id-mock-col.right { align-items: flex-end; }
.id-mock-label {
  font-size: 0.55rem; color: var(--text-soft); line-height: 1.3;
  text-align: center;
}

/* ── Mock: controls area ────────────────────────────────────────── */
.id-mock-ctrl-area {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 6px; align-items: start;
  width: 100%;
}

/* ── Mock: mode card ────────────────────────────────────────────── */
.id-mock-mode-card {
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface, rgba(255,255,255,0.02));
}

/* ── Mock: login box ───────────────────────────────────────────── */
.id-mock-login-box {
  width: 100%; display: flex; flex-direction: column; gap: 8px;
}
.id-mock-login-tabs {
  display: flex; gap: 2px;
  background: var(--surface-2); border-radius: 10px; padding: 3px;
}
.id-mock-login-fields {
  display: flex; flex-direction: column; gap: 5px;
}
.id-mock-input {
  display: block; width: 100%; padding: 6px 10px;
  border: 1px solid var(--border); border-radius: 8px;
  font-size: 0.7rem; color: var(--text-soft);
  background: var(--surface-1, rgba(255,255,255,0.02));
}

/* ── Mock: benefits row ─────────────────────────────────────────── */
.id-mock-benefits {
  display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
  width: 100%;
}

/* ── Mock: engine selector ──────────────────────────────────────── */
.id-mock-engine-row {
  display: flex; gap: 5px; flex-wrap: wrap; justify-content: center;
}

/* ── Mock: annotation callouts ──────────────────────────────────── */
.id-mock-annot {
  display: block;
  font-size: 0.58rem;
  color: var(--accent-2, #f97316);
  line-height: 1.45;
  text-align: center;
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent-2, #f97316) 6%, transparent);
}
.id-mock-ctrl-top {
  display: flex; flex-wrap: wrap; justify-content: space-between;
  align-items: flex-start; gap: 6px; width: 100%;
}
.id-mock-caller {
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
}
.id-mock-trk-title {
  font-size: 0.85rem; font-weight: 650; color: var(--text);
  width: 100%; text-align: center;
}

/* ── Mock: mode legend ──────────────────────────────────────────── */
.id-mock-mode-legend {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;
  width: 100%;
}
.id-mock-mode-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 5px 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface, rgba(255,255,255,0.02));
}
.id-mock-mode-item svg { color: var(--text); }
.id-mock-mode-item b {
  font-size: 0.55rem; font-weight: 600; color: var(--text-soft);
}

/* ── Mock: source tabs ──────────────────────────────────────────── */
.id-mock-src-tabs {
  display: flex; gap: 2px;
  background: var(--surface-2); border-radius: 10px; padding: 3px;
}

/* ── Mock: filter button ────────────────────────────────────────── */
.id-mock-row {
  display: flex; align-items: center; gap: 6px; width: 100%;
}
.id-mock-select {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 0.7rem; color: var(--text); font-weight: 600;
  white-space: nowrap; flex-shrink: 0;
}
.id-mock-select svg { color: var(--text-muted); flex-shrink: 0; }
.id-mock-fbtn {
  display: inline-flex; align-items: center; gap: 4px;
  height: 1.65rem; padding: 0 0.55rem;
  border: 1px solid var(--accent, #6366f1); border-radius: 999px;
  background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent);
  color: var(--accent, #6366f1);
  font-size: 0.6rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
}
.id-mock-fbtn svg { flex-shrink: 0; }

/* ── Mock: mini table ───────────────────────────────────────────── */
.id-mock-table {
  width: 100%; display: flex; flex-direction: column; gap: 0;
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
}
.id-mock-thead {
  display: flex;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.id-mock-th {
  font-size: 0.55rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.1em; color: var(--text-soft);
  padding: 4px 8px;
}
.id-mock-th.num { width: 36px; text-align: center; flex-shrink: 0; }
.id-mock-th.info { flex: 1; }
.id-mock-trow {
  display: flex;
  border-bottom: 1px solid var(--border);
  transition: background 0.12s;
}
.id-mock-trow:last-child { border-bottom: none; }
.id-mock-td {
  padding: 5px 8px; display: flex; flex-direction: column; justify-content: center;
}
.id-mock-td.num {
  width: 36px; flex-shrink: 0; align-items: center;
  font-size: 0.65rem; font-weight: 700; color: var(--text-muted);
}
.id-mock-td.info { flex: 1; min-width: 0; gap: 1px; }
.id-mock-td-title {
  font-size: 0.72rem; font-weight: 600; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.id-mock-td-meta {
  font-size: 0.56rem; color: var(--text-muted);
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
}
.id-mock-td-meta b {
  font-size: 0.54rem; font-weight: 700;
  background: var(--surface-3); color: var(--text-soft);
  padding: 0 3px; border-radius: 3px;
}

/* ── Mock: preset row ───────────────────────────────────────────── */
.id-mock-preset-row {
  display: flex; gap: 4px; flex-wrap: wrap; justify-content: center;
}

/* ── Mock: pattern head ─────────────────────────────────────────── */
.id-mock-ptrn-head {
  display: flex; gap: 6px;
  justify-content: center;
  padding-bottom: 4px; border-bottom: 1px solid var(--border);
}
.mpr-col {
  font-size: 0.55rem; font-weight: 700; text-align: center;
  text-transform: uppercase; letter-spacing: 0.08em;
  min-width: 2.2em;
}

/* ── Mock: pattern legend ───────────────────────────────────────── */
.id-mock-ptrn-legend {
  display: flex; flex-wrap: wrap; gap: 3px 8px;
  font-size: 0.58rem; color: var(--text-soft); line-height: 1.5;
}
.id-mock-ptrn-legend span {
  display: inline-flex; align-items: center; gap: 3px;
}
.dot-note, .dot-inst, .dot-fx, .dot-empty {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.dot-note  { background: var(--pattern-note, #f43f5e); }
.dot-inst  { background: var(--pattern-inst, #3b82f6); }
.dot-fx    { background: var(--pattern-effect, #10b981); }
.dot-empty { background: var(--pattern-dim, #94a3b8); }
.id-list { margin: 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.4rem; }
.id-list li { font-size: 0.85rem; line-height: 1.6; color: var(--text-muted); }
.id-list li::marker { color: var(--accent, #6366f1); }
.id-link { color: var(--accent, #6366f1); text-decoration: none; }
.id-link:hover { text-decoration: underline; }

/* ── Guide tab bar ───────────────────────────────────────────────── */
.id-guide-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 6px;
  margin: 0;
  background: var(--surface-2, rgba(255,255,255,0.04));
  border-bottom: 1px solid var(--border, rgba(128,128,128,0.1));
  flex-shrink: 0;
}
.id-guide-tab {
  flex: 1;
  padding: 7px 8px;
  border: none;
  border-radius: 7px;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: var(--text-muted);
  transition: all 0.15s;
  white-space: nowrap;
}
.id-guide-tab:hover { color: var(--text); background: var(--surface-1, rgba(255,255,255,0.03)); }
.id-guide-tab.active {
  background: var(--accent, #6366f1);
  color: #fff;
}

/* ── Credit cards ─────────────────────────────────────────────────── */
.id-credits-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}
.id-credit-card {
  display: block;
  padding: 10px 12px;
  border: 1px solid var(--border, rgba(128,128,128,0.1));
  border-radius: 10px;
  background: var(--surface-1, rgba(255,255,255,0.02));
  color: inherit;
  text-decoration: none;
  transition: all 0.15s;
}
a.id-credit-card:hover {
  border-color: var(--accent, #6366f1);
  background: var(--surface-2, rgba(255,255,255,0.04));
}
.id-credit-name {
  display: block;
  font-size: 0.82rem;
  font-weight: 650;
  color: var(--text);
  margin-bottom: 2px;
}
a.id-credit-card:hover .id-credit-name {
  color: var(--accent, #6366f1);
}
.id-credit-desc {
  display: block;
  font-size: 0.76rem;
  line-height: 1.55;
  color: var(--text-muted);
}
.id-share-links {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Language grid (generic) */
.id-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 6px; }
.id-item { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-1, rgba(255,255,255,0.02)); color: var(--text-muted); font-size: 0.78rem; cursor: pointer; transition: all 0.12s; }
.id-item:hover { border-color: var(--accent); color: var(--text); }
.id-item.active { background: var(--accent); color: #fff; border-color: var(--accent); }

/* ── Theme section label ──────────────────────────────────────────── */
.id-theme-section-label {
  margin: 0 0 6px;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-soft);
}

/* ── Theme cards ──────────────────────────────────────────────────── */
.id-theme-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 18px;
}
.id-theme-card {
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1.5px solid var(--border, rgba(128,128,128,0.1));
  border-radius: 10px;
  background: var(--tp-bg, #0f172a);
  cursor: pointer;
  transition: all 0.18s ease;
  overflow: hidden;
  font: inherit;
}
.id-theme-card:hover {
  transform: translateY(-1px);
  border-color: var(--tp-accent, var(--accent));
  box-shadow: 0 4px 16px -6px rgba(0,0,0,0.3);
}
.id-theme-card.active {
  border-color: var(--tp-accent, var(--accent));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--tp-accent, var(--accent)) 40%, transparent);
}

/* 3-band color swatch */
.id-theme-swatch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1.2fr;
  height: 50px;
}
.id-theme-band--accent  { grid-column: 1; grid-row: 1; background: var(--tp-accent,  #6366f1); }
.id-theme-band--surface { grid-column: 2; grid-row: 1; background: var(--tp-surface, #ffffff); }
.id-theme-band--bg {
  grid-column: 1 / -1;
  grid-row: 2;
  background: var(--tp-bg, #0f172a);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Label */
.id-theme-label {
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--tp-text, #f8fafc);
  white-space: nowrap;
  text-align: center;
}

.id-account { display: flex; flex-direction: column; gap: 16px; }
.id-actions { display: flex; gap: 8px; }
.id-btn { padding: 8px 20px; border-radius: 8px; border: none; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all 0.12s; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.id-btn-primary { background: var(--accent, #6366f1); color: #fff; }
.id-btn-primary:hover { filter: brightness(1.1); }
.id-btn-secondary { background: var(--surface-2, rgba(255,255,255,0.06)); color: var(--text); border: 1px solid var(--border); }
.id-btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
.id-btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
.id-btn-ghost:hover { color: var(--text); border-color: var(--text-soft); }
.id-btn-danger { background: transparent; color: var(--danger, #ef4444); border: 1px solid var(--danger, #ef4444); }
.id-btn-danger:hover { background: var(--danger, #ef4444); color: #fff; }
.id-btn-full { width: 100%; padding: 10px 20px; }

/* ── Auth user (logged-in) ─────────────────────────────────────── */
.id-auth-user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--surface-1, rgba(255,255,255,0.02));
  border: 1px solid var(--border);
  border-radius: 10px;
}
.id-auth-avatar {
  width: 40px; height: 40px;
  border-radius: 50%;
  background: var(--accent, #6366f1);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.id-auth-user-info { min-width: 0; }
.id-auth-username { margin: 0; font-size: 0.9rem; font-weight: 650; color: var(--text); }
.id-auth-sub { margin: 2px 0 0; font-size: 0.72rem; color: var(--text-muted); }

/* ── Auth tab toggle ───────────────────────────────────────────── */
.id-auth-tabs {
  display: flex;
  background: var(--surface-2, rgba(255,255,255,0.04));
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}
.id-auth-tab {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: var(--text-muted);
  transition: all 0.15s;
}
.id-auth-tab:hover { color: var(--text); }
.id-auth-tab.active {
  background: var(--accent, #6366f1);
  color: #fff;
}

/* ── Auth forms ────────────────────────────────────────────────── */
.id-auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.id-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.id-field-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-soft);
}
.id-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-1, rgba(255,255,255,0.02));
  color: var(--text);
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.15s;
}
.id-input:focus { border-color: var(--accent, #6366f1); }
.id-input-wrap { position: relative; }
.id-input-wrap .id-input { padding-right: 38px; }
.id-input-eye {
  position: absolute;
  right: 6px; top: 50%; transform: translateY(-50%);
  width: 30px; height: 30px;
  border: none; border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.12s;
}
.id-input-eye:hover { color: var(--text); }

/* ── Auth status ───────────────────────────────────────────────── */
.id-auth-status {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.82rem;
  line-height: 1.5;
}
.id-auth-status.success {
  background: color-mix(in srgb, var(--success, #22c55e) 12%, transparent);
  color: var(--success, #22c55e);
}
.id-auth-status.danger {
  background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
  color: var(--danger, #ef4444);
}

/* ── Spinner ───────────────────────────────────────────────────── */
.id-spinner {
  display: inline-block;
  width: 14px; height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: id-spin 0.6s linear infinite;
}
@keyframes id-spin { to { transform: rotate(360deg); } }

/* ── Drawer animations (driven by .is-open class) ────────────────── */
.id-backdrop {
  opacity: 0;
  transition: opacity 0.3s ease;
}
.id-drawer.is-open .id-backdrop {
  opacity: 1;
}

.id-panel {
  transform: translateX(-100%);
  transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.id-drawer.is-open .id-panel {
  transform: translateX(0);
}

.id-clone-ear {
  left: 0;
  transition: left 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.id-drawer.is-open .id-clone-ear {
  left: 396px;
}

/* ── Mobile ──────────────────────────────────────────────────────── */
@media (max-width: 767px) {
  /* Ear bar — smaller buttons, safe-area aware */
  .id-bar {
    gap: 3px;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .id-ear {
    height: 48px;
    width: 26px;
    gap: 2px;
    padding: 4px 2px;
    border-radius: 0 5px 5px 0;
  }
  .id-ear::after { top: 6px; bottom: 6px; }
  .id-ear-label { font-size: 0.42rem; letter-spacing: 0.04em; }

  /* Backdrop — ensure it covers full screen */
  .id-backdrop {
    background: rgba(15,23,42,0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  /* Panel — full width, safe-area aware */
  .id-panel {
    width: 100vw;
    max-width: 100vw;
    padding-left: 0;  /* remove the 4px ear gap on mobile */
    border-right: none;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* Panel body — smoother scrolling on iOS */
  .id-panel-body {
    -webkit-overflow-scrolling: touch;
    padding: 12px;
  }

  /* Head — adjust padding */
  .id-panel-head {
    padding: 12px 14px;
    padding-top: calc(12px + env(safe-area-inset-top, 0px));
  }

  /* Show close button on mobile */
  .id-panel-close { display: flex; }

  /* Clone ear — hidden on mobile (full-width panel makes it redundant) */
  .id-clone-ear { display: none; }

  /* Grid — fewer columns on small screens */
  .id-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 5px;
  }
  .id-item {
    padding: 10px 8px;
    font-size: 0.76rem;
    border-radius: 10px;
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  /* Theme grid — 4 columns even on mobile */
  .id-theme-grid { gap: 5px; margin-bottom: 14px; }
  .id-theme-swatch { height: 40px; }
  .id-theme-label { font-size: 0.56rem; padding: 4px 2px 5px; }
  .id-theme-section-label { font-size: 0.6rem; }

  /* Text sizing */
  .id-text { font-size: 0.8rem; }
  .id-subtitle { font-size: 0.9rem; }

  /* Account actions — stack vertically */
  .id-actions { flex-direction: column; }
  .id-btn { width: 100%; text-align: center; padding: 10px 16px; }

  /* Auth forms */
  .id-input { padding: 10px 12px; font-size: 0.9rem; }
  .id-auth-tab { padding: 10px 12px; font-size: 0.82rem; }
  .id-auth-user { padding: 14px; }

  /* Guide tabs — compact on mobile */
  .id-guide-tabs { padding: 3px 4px; gap: 1px; }
  .id-guide-tab { padding: 8px 6px; font-size: 0.68rem; border-radius: 6px; }

  /* Credit cards — tighter on mobile */
  .id-credit-card { padding: 10px; }
  .id-credit-name { font-size: 0.78rem; }
  .id-credit-desc { font-size: 0.72rem; }

  /* Tutorial slides — compact on mobile */
  .id-slide-visual { padding: 10px; gap: 7px; }
  .id-slide-title { font-size: 0.84rem; }
  .id-slide-desc { font-size: 0.74rem; }
  .id-slide-nav-btn { padding: 10px 14px; font-size: 0.76rem; }
  .id-mock-btn-play { min-height: 32px; font-size: 0.72rem; }
  .id-mock-btn-play span { display: none; }
  .id-mock-btn-sec, .id-mock-btn-like { width: 30px; height: 30px; }
  .id-mock-ctrl-grid { gap: 0.35rem; }
  .id-mock-searchbar { height: 2.2rem; font-size: 0.72rem; }
  .id-mock-fmtgrid { grid-template-columns: repeat(3, 1fr); }
  .id-mock-ptrn-row { font-size: 0.58rem; }
  .id-mock-ptrn-head { font-size: 0.5rem; }
  .id-mock-cdot { width: 16px; height: 16px; }
  .id-mock-ctrl-area { gap: 4px; }
  .id-mock-mode-legend { gap: 3px; }
  .id-mock-mode-card { width: 32px; height: 28px; }
  .id-mock-mode-card svg { width: 15px; height: 15px; }
  .id-mock-annot { font-size: 0.54rem; }
  .id-mock-label { font-size: 0.5rem; }
  .id-mock-ptrn-legend { font-size: 0.54rem; }
  .id-mock-actlink { font-size: 0.6rem; padding: 0.18rem 0.35rem; }
  .id-mock-actlink svg { width: 10px; height: 10px; }
  .id-mock-ctrl-top { gap: 4px; }
  .id-mock-col { gap: 2px; }
}

</style>
