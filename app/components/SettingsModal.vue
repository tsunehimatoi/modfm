<script setup>
import SettingsBody from "./SettingsBody.vue";

const props = defineProps({
  isOpen: Boolean,
  closeModal: Function,
});

const { t } = useI18n();
</script>

<template>
  <Transition name="sidebar">
    <div v-if="isOpen" class="fixed inset-0 z-[200] flex justify-end" role="dialog" aria-modal="true">
      <div class="backdrop absolute inset-0 bg-slate-900/60 backdrop-blur-sm" aria-hidden="true" @click="closeModal" />
      <div class="drawer-panel relative h-full w-[380px] max-w-[90vw] flex flex-col shadow-2xl">
        <div class="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0 bg-surface">
          <div class="flex items-center gap-2.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="text-text-soft"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <h4 class="m-0 text-[0.95rem] font-bold tracking-tight text-text">{{ t("settings.title") }}</h4>
          </div>
          <button type="button" class="btn-icon w-8 h-8" @click="closeModal">
            <span class="sr-only">{{ t("common.close") }}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto bg-surface">
          <div class="p-5">
            <SettingsBody :active="isOpen" />
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.drawer-panel { background: var(--surface); border-left: 1px solid var(--border); will-change: transform; }
.sidebar-enter-active, .sidebar-leave-active { transition: all 400ms; }
.sidebar-enter-active .backdrop, .sidebar-leave-active .backdrop { transition: opacity 350ms ease; }
.sidebar-enter-from .backdrop, .sidebar-leave-to .backdrop { opacity: 0; }
.sidebar-enter-active .drawer-panel { transition: transform 400ms cubic-bezier(0.22, 1, 0.36, 1); }
.sidebar-leave-active .drawer-panel { transition: transform 300ms cubic-bezier(0.32, 0, 0.67, 0); }
.sidebar-enter-from .drawer-panel, .sidebar-leave-to .drawer-panel { transform: translate3d(100%, 0, 0); }
</style>
