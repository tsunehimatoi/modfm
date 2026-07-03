<script setup>
import { computed, ref, onMounted, onUnmounted } from "vue";
import BaseSelect from "./BaseSelect.vue";
const props = defineProps({
  openAuthModal: {
    type: Function,
    required: true,
  },
  openSettingsModal: {
    type: Function,
    required: true,
  },
  isLoggedIn: {
    type: Boolean,
    default: false,
  },
  onLogout: {
    type: Function,
    default: null,
  },
  isLoggingOut: {
    type: Boolean,
    default: false,
  },
});

const { t, locales, locale, setLocale } = useI18n();
const colorMode = useColorMode();

const langOptions = computed(() =>
  (locales.value || locales).map((l) => ({ label: l.label, value: l.code }))
);

const themeOptions = computed(() => [
  { label: t("settings.themes.light"), value: "light" },
  { label: t("settings.themes.dark"), value: "dark" },
  { label: t("settings.themes.midnight"), value: "midnight" },
  { label: t("settings.themes.retro"), value: "retro" },
  { label: t("settings.themes.ocean"), value: "ocean" },
  { label: t("settings.themes.forest"), value: "forest" },
  { label: t("settings.themes.strawberry"), value: "strawberry" },
  { label: t("settings.themes.golden"), value: "golden" },
  { label: t("settings.themes.purple"), value: "purple" },
  { label: t("settings.themes.blue"), value: "blue" },
  { label: t("settings.themes.pink"), value: "pink" },
  { label: t("settings.themes.cyan"), value: "cyan" },
  { label: t("settings.themes.orange"), value: "orange" },
  { label: t("settings.themes.red"), value: "red" },
  { label: t("settings.themes.green"), value: "green" },
  { label: t("settings.themes.gray"), value: "gray" },
]);

const handleLocaleChange = (newLocale) => {
  setLocale(newLocale);
};

const handleLogout = () => {
  if (props.isLoggingOut) return;
  if (props.onLogout) {
    props.onLogout();
  }
};

const isMobile = ref(false);
const isMobileMenuOpen = ref(false);

onMounted(() => {
  const checkMobile = () => {
    isMobile.value = window.innerWidth <= 640;
    if (!isMobile.value) {
      isMobileMenuOpen.value = false;
    }
  };
  checkMobile();
  window.addEventListener("resize", checkMobile);
  onUnmounted(() => window.removeEventListener("resize", checkMobile));
});

const mobileExpandedSection = ref("");
const toggleMobileSection = (section) => {
  mobileExpandedSection.value = mobileExpandedSection.value === section ? "" : section;
};

const handleMobileSettings = () => {
  isMobileMenuOpen.value = false;
  props.openSettingsModal();
};

const handleMobileAuth = (type) => {
  isMobileMenuOpen.value = false;
  props.openAuthModal(type);
};

const handleMobileLogout = () => {
  isMobileMenuOpen.value = false;
  handleLogout();
};
</script>

<template>
  <header
    id="dsetNav"
    class="fixed top-3 left-1/2 -translate-x-1/2 z-[100] max-w-[1200px] w-[calc(100%-3rem)] max-[720px]:w-[calc(100%-2rem)] rounded-full bg-bg/65 backdrop-blur-2xl border border-border/30 shadow-[0_8px_32px_rgba(0,0,0,0.12)] transition-all duration-300"
  >
    <div
      class="w-full py-1 px-4 grid grid-cols-2 sm:grid-cols-[1fr_auto_1fr] items-center gap-3 min-h-[44px]"
    >
      <!-- Brand -->
      <div class="flex items-center gap-2.5 min-w-0 justify-self-start">
        <span
          class="font-bold tracking-[0.06em] uppercase text-[0.85rem] text-text whitespace-nowrap"
        >
          {{ isMobile ? "Tracker" : t("nav.brand") }}
        </span>
      </div>

      <!-- Actions (Middle on Desktop) -->
      <div v-if="!isMobile" class="flex items-center justify-center gap-1 bg-surface-2/40 rounded-full p-0.5 border border-border/20 shadow-sm">
        <!-- Language Switcher -->
        <BaseSelect
          :model-value="locale"
          :options="langOptions"
          :label="t('settings.table.language')"
          @update:model-value="handleLocaleChange"
          class="!min-w-0"
          dropdown-class="w-48"
        >
          <template #trigger="{ toggle, isOpen }">
            <button
              @click="toggle"
              class="flex items-center justify-center p-1.5 rounded-full hover:bg-surface-2/60 hover:scale-105 active:scale-95 transition-all duration-200 text-text-muted hover:text-text"
              :class="{
                'bg-surface-2/60 text-text ring-2 ring-accent/20': isOpen,
              }"
              :title="t('settings.table.language')"
              type="button"
            >
              <svg
                class="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path
                  d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
                />
              </svg>
            </button>
          </template>
        </BaseSelect>

        <!-- Theme Switcher -->
        <BaseSelect
          v-model="colorMode.preference"
          :options="themeOptions"
          :label="t('settings.table.theme')"
          class="!min-w-0"
          dropdown-class="w-48"
        >
          <template #trigger="{ toggle, isOpen }">
            <button
              @click="toggle"
              class="flex items-center justify-center p-1.5 rounded-full hover:bg-surface-2/60 hover:scale-105 active:scale-95 transition-all duration-200 text-text-muted hover:text-text"
              :class="{
                'bg-surface-2/60 text-text ring-2 ring-accent/20': isOpen,
              }"
              :title="t('settings.table.theme')"
              type="button"
            >
              <ClientOnly>
                <svg
                  v-if="
                    ['light', 'retro', 'ocean', 'forest', 'strawberry'].includes(
                      colorMode.preference,
                    )
                  "
                  class="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
                <svg
                  v-else
                  class="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
                <template #fallback>
                  <svg
                    class="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="12" cy="12" r="5" />
                  </svg>
                </template>
              </ClientOnly>
            </button>
          </template>
        </BaseSelect>

        <!-- Settings Button -->
        <button
          @click="openSettingsModal"
          class="flex items-center justify-center p-1.5 rounded-full hover:bg-surface-2/60 hover:scale-105 active:scale-95 transition-all duration-200 text-text-muted hover:text-text"
          :title="t('settings.title')"
          type="button"
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </button>
      </div>

      <!-- Auth & Mobile Menu Toggle (Right) -->
      <div class="flex items-center justify-self-end gap-2 flex-shrink-0">
        <template v-if="!isMobile">
          <button
            class="btn-base btn-ghost px-3 py-1.5 text-xs rounded-full"
            :class="{ hidden: isLoggedIn }"
            @click="openAuthModal('login')"
            type="button"
          >
            {{ t("auth.login") }}
          </button>
          <button
            class="btn-base btn-primary px-3 py-1.5 text-xs shadow-sm shadow-primary/20 rounded-full"
            :class="{ hidden: isLoggedIn }"
            @click="openAuthModal('register')"
            type="button"
          >
            {{ t("auth.signup") }}
          </button>
          <button
            class="btn-base btn-danger px-3 py-1.5 text-xs rounded-full inline-flex items-center gap-1.5 disabled:opacity-70 disabled:cursor-not-allowed"
            :class="{ hidden: !isLoggedIn }"
            :disabled="isLoggingOut"
            :aria-busy="isLoggingOut ? 'true' : 'false'"
            @click="handleLogout"
            type="button"
          >
            <span
              v-if="isLoggingOut"
              class="inline-block w-3.5 h-3.5 border-2 rounded-full border-current border-t-transparent animate-spin"
              aria-hidden="true"
            ></span>
            {{ isLoggingOut ? t("common.loading", null, "处理中...") : t("auth.logout") }}
          </button>
        </template>
        
        <template v-else>
          <button
            @click="openSettingsModal"
            class="p-2 rounded-full text-text hover:bg-surface-2/50 active:scale-95 transition-all"
            :title="t('settings.title')"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            @click="isMobileMenuOpen = true"
            class="p-2 -mr-2 rounded-full text-text hover:bg-surface-2/50 active:scale-95 transition-all"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
        </template>
      </div>
    </div>
  </header>

  <!-- Mobile Menu Drawer -->
  <Teleport to="body">
    <Transition name="drawer">
      <div v-show="isMobileMenuOpen && isMobile" class="fixed inset-0 z-[200] flex flex-col justify-end">
        <div class="absolute inset-0 bg-black/60 transition-opacity" @click="isMobileMenuOpen = false"></div>
        <div class="relative bg-bg rounded-t-3xl p-6 border-t border-border/60 shadow-[0_-10px_40px_rgba(0,0,0,0.3)] flex flex-col gap-5 max-h-[85vh] overflow-y-auto">
          <div class="w-12 h-1.5 bg-border/80 rounded-full mx-auto -mt-2 mb-2"></div>
               <!-- Tools -->
          <div class="flex flex-col bg-surface-2/30 rounded-2xl border border-border/40">
            <!-- Language Accordion -->
            <div class="flex flex-col border-b border-border/40">
              <button @click="toggleMobileSection('language')" class="flex items-center justify-between w-full py-3.5 px-4 hover:bg-surface-2/60 transition-colors rounded-t-2xl">
                <span class="text-sm font-medium">{{ t('settings.table.language') }}</span>
                <div class="flex items-center gap-2 text-text-muted">
                  <span class="text-sm">{{ langOptions.find(l => l.value === locale)?.label || locale }}</span>
                  <svg class="w-4 h-4 transition-transform duration-200" :class="{ 'rotate-180': mobileExpandedSection === 'language' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
              </button>
              <div class="grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]" :style="{ gridTemplateRows: mobileExpandedSection === 'language' ? '1fr' : '0fr' }">
                <div class="overflow-hidden min-h-0 transition-opacity duration-300" :class="mobileExpandedSection === 'language' ? 'opacity-100' : 'opacity-0 invisible'">
                  <div class="px-3 pb-3 grid grid-cols-2 gap-2 pt-1">
                    <button v-for="opt in langOptions" :key="opt.value" @click="handleLocaleChange(opt.value); toggleMobileSection('')" class="py-2.5 px-3 rounded-xl text-sm text-center border transition-all" :class="locale === opt.value ? 'bg-accent/10 border-accent/40 text-accent font-medium shadow-sm' : 'border-border/30 hover:bg-surface-2/80 text-text-muted hover:text-text'">
                      {{ opt.label }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Theme Accordion -->
            <div class="flex flex-col border-b border-border/40">
              <button @click="toggleMobileSection('theme')" class="flex items-center justify-between w-full py-3.5 px-4 hover:bg-surface-2/60 transition-colors">
                <span class="text-sm font-medium">{{ t('settings.table.theme') }}</span>
                <div class="flex items-center gap-2 text-text-muted">
                  <ClientOnly>
                    <span class="text-sm">{{ themeOptions.find(t => t.value === colorMode.preference)?.label || colorMode.preference }}</span>
                    <template #fallback>
                      <span class="text-sm opacity-0">...</span>
                    </template>
                  </ClientOnly>
                  <svg class="w-4 h-4 transition-transform duration-200" :class="{ 'rotate-180': mobileExpandedSection === 'theme' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
              </button>
              <div class="grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]" :style="{ gridTemplateRows: mobileExpandedSection === 'theme' ? '1fr' : '0fr' }">
                <div class="overflow-hidden min-h-0 transition-opacity duration-300" :class="mobileExpandedSection === 'theme' ? 'opacity-100' : 'opacity-0 invisible'">
                  <div class="px-3 pb-3 grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[35vh] overflow-y-auto custom-scrollbar pt-1">
                    <ClientOnly>
                      <button v-for="opt in themeOptions" :key="opt.value" @click="colorMode.preference = opt.value" class="py-2 px-1 rounded-xl text-xs text-center border transition-all truncate" :class="colorMode.preference === opt.value ? 'bg-accent/10 border-accent/40 text-accent font-medium shadow-sm' : 'border-border/30 hover:bg-surface-2/80 text-text-muted hover:text-text'">
                        {{ opt.label }}
                      </button>
                      <template #fallback>
                        <button v-for="opt in themeOptions" :key="'fallback-' + opt.value" class="py-2 px-1 rounded-xl text-xs text-center border transition-all truncate border-border/30 text-text-muted">
                          {{ opt.label }}
                        </button>
                      </template>
                    </ClientOnly>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Auth -->
          <div class="flex gap-3 mt-2">
             <template v-if="!isLoggedIn">
                <button class="btn-base btn-ghost flex-1 py-3 rounded-xl border border-border/50" @click="handleMobileAuth('login')">
                  {{ t("auth.login") }}
                </button>
                <button class="btn-base btn-primary flex-1 py-3 rounded-xl shadow-sm shadow-primary/20" @click="handleMobileAuth('register')">
                  {{ t("auth.signup") }}
                </button>
             </template>
             <button v-else class="btn-base btn-danger flex-1 py-3 rounded-xl flex items-center justify-center gap-2" @click="handleMobileLogout" :disabled="isLoggingOut">
                <span v-if="isLoggingOut" class="inline-block w-4 h-4 border-2 rounded-full border-current border-t-transparent animate-spin"></span>
                {{ isLoggingOut ? t("common.loading", null, "处理中...") : t("auth.logout") }}
             </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.4s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .relative,
.drawer-leave-to .relative {
  transform: translateY(100%);
}
</style>
