<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";

const props = defineProps({
  modelValue: [String, Number],
  options: {
    type: Array,
    required: true,
    // Each option: { label: string, value: any }
  },
  label: String,
  id: String, // This ID will be placed on a hidden input/select for legacy JS compatibility
  placeholder: String,
  class: String,
  dropdownClass: String,
});

const emit = defineEmits(["update:modelValue", "change"]);

const isOpen = ref(false);
const container = ref(null);
const triggerRef = ref(null);
const dropdownRef = ref(null);
const dropdownStyle = ref({ top: "0px", left: "0px", width: "auto" });

const updateDropdownPosition = () => {
  if (triggerRef.value) {
    const rect = triggerRef.value.getBoundingClientRect();
    const scrollY = window.scrollY || window.pageYOffset;
    const scrollX = window.scrollX || window.pageXOffset;

    dropdownStyle.value = {
      top: `${rect.bottom + scrollY + 6}px`,
      left: `${rect.left + scrollX}px`,
      minWidth: `${rect.width}px`,
    };
  }
};

const handleScroll = (event) => {
  if (!isOpen.value) return;
  // If the scroll target is the dropdown itself or inside it, do nothing
  if (
    dropdownRef.value &&
    (dropdownRef.value === event.target ||
      dropdownRef.value.contains(event.target))
  ) {
    return;
  }
  // Otherwise close the dropdown on external scroll to prevent misplacement
  isOpen.value = false;
};

const toggleDropdown = () => {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    updateDropdownPosition();
  }
};

const selectOption = (option) => {
  emit("update:modelValue", option.value);
  emit("change", option.value);
  isOpen.value = false;

  // For legacy JS interop: trigger event on hidden element if ID is provided
  if (props.id) {
    const hiddenEl = document.getElementById(props.id);
    if (hiddenEl) {
      hiddenEl.value = option.value;
      hiddenEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
};

const handleClickOutside = (event) => {
  if (container.value && !container.value.contains(event.target)) {
    isOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
  window.addEventListener("scroll", handleScroll, true);
  window.addEventListener("resize", () => {
    if (isOpen.value) isOpen.value = false;
  });
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
  window.removeEventListener("scroll", handleScroll, true);
  window.removeEventListener("resize", () => {
    if (isOpen.value) isOpen.value = false;
  });
});

const selectedLabel = computed(() => {
  const option = props.options.find((opt) => opt.value == props.modelValue);
  return option ? option.label : props.placeholder || "";
});
</script>

<template>
  <div class="relative inline-block" :class="props.class" ref="container">
    <!-- Hidden element for legacy JS interop -->
    <select v-if="id" :id="id" class="hidden" :value="modelValue">
      <option v-for="opt in options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>

    <div ref="triggerRef" class="h-full">
      <slot name="trigger" :toggle="toggleDropdown" :isOpen="isOpen">
        <button
          type="button"
          @click="toggleDropdown"
          class="flex items-center gap-1.5 px-3 h-10 rounded-lg border border-border bg-surface text-text text-sm font-semibold transition-all hover:border-border-strong hover:bg-surface-hover hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 group whitespace-nowrap"
        >
          <span class="truncate">{{ selectedLabel }}</span>
          <svg
            class="w-3.5 h-3.5 text-text-soft transition-transform duration-200"
            :class="{ 'rotate-180': isOpen }"
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
      </slot>
    </div>

    <Teleport to="body">
      <transition
        enter-active-class="transition duration-240 ease-[cubic-bezier(0.23,1,0.32,1)]"
        enter-from-class="transform scale-[0.96] opacity-0 -translate-y-1"
        enter-to-class="transform scale-100 opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-[cubic-bezier(0.4,0,1,1)]"
        leave-from-class="transform scale-100 opacity-100 translate-y-0"
        leave-to-class="transform scale-[0.96] opacity-0 -translate-y-1"
      >
        <div
          v-if="isOpen"
          ref="dropdownRef"
          class="absolute rounded-xl border border-border/60 bg-surface/85 backdrop-blur-md shadow-[0_20px_50px_rgba(0,0,0,0.3),0_0_1px_rgba(255,255,255,0.1)] py-2 z-[9999] overflow-y-auto max-h-[400px] custom-scrollbar will-change-[transform,opacity]"
          :style="dropdownStyle"
          :class="dropdownClass"
        >
          <div
            v-if="label"
            class="px-3 py-1.5 text-[0.62rem] font-bold text-text-muted uppercase tracking-[0.15em] border-b border-border/40 mb-1"
          >
            {{ label }}
          </div>
          <button
            v-for="option in options"
            :key="option.value"
            @click="selectOption(option)"
            class="w-full flex items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-accent/10 text-left group"
            :class="
              modelValue == option.value
                ? 'text-accent font-semibold bg-accent/5'
                : 'text-text-soft hover:text-text'
            "
          >
            <span>{{ option.label }}</span>
            <svg
              v-if="modelValue == option.value"
              class="w-4 h-4 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="3"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </button>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--accent);
}

/* Firefox */
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}
</style>

