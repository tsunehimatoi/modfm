<script setup>
import { onMounted, ref } from "vue";

import SettingsModal from "~/components/SettingsModal.vue";
import PlayerControls from "~/components/PlayerControls.vue";
import PlaylistView from "~/components/PlaylistView.vue";

import ChannelScopes from "~/components/ChannelScopes.vue";
import InfoDrawer from "~/components/InfoDrawer.vue";

const isSettingsModalOpen = ref(false);
const isPlayerBooting = ref(true);
const isLoggingOut = ref(false);
const { t } = useI18n();
const { authState, refresh: refreshAuth, logout } = useAuthStore();
const nuxtApp = useNuxtApp();

const openSettingsModal = () => {
  isSettingsModalOpen.value = true;
};
const closeSettingsModal = () => {
  isSettingsModalOpen.value = false;
};

const handleLogout = async () => {
  if (isLoggingOut.value) return;
  isLoggingOut.value = true;
  try {
    await logout();
  } finally {
    isLoggingOut.value = false;
  }
};

const playerScripts = [
  "/script/jsonh.js",
  "/script/bassoonplayer-min.js",
  "/script/enum.js",
];

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-player-src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.dataset.playerSrc = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });

await refreshAuth();

onMounted(async () => {
  // Expose legacy interop helpers used by the player app logic
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;

  try {
    for (const src of playerScripts) {
      await loadScript(src);
    }
    const { setupPlayerApp } = await import("~/utils/player-app");
    setupPlayerApp(nuxtApp);
  } catch (error) {
    console.error(error);
  } finally {
    isPlayerBooting.value = false;
  }
});
</script>

<template>
  <div class="flex flex-col gap-1 pb-20 pt-4">
    <SettingsModal
      :isOpen="isSettingsModalOpen"
      :closeModal="closeSettingsModal"
    />

    <InfoDrawer />

    <main
      class="max-w-[1200px] mt-4 mx-auto w-[calc(100%-3rem)] max-[720px]:w-[calc(100%-2rem)] grid gap-5 max-[720px]:mt-5"
    >
      <div
        v-if="isPlayerBooting"
        class="inline-flex items-center gap-2.5 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-sm text-text-soft"
        role="status"
        aria-live="polite"
      >
        <span
          class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        ></span>
        <span>{{ t("common.loading", null, "正在初始化播放器...") }}</span>
      </div>

      <ChannelScopes />

      <div
        class="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-stretch"
        style="min-width: 0"
      >
        <PlayerControls />

        <PlaylistView @open-settings="openSettingsModal" />
      </div>
    </main>


  </div>
</template>
