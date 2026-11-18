<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    busy?: boolean;
    wide?: boolean;
  }>(),
  {
    description: '',
    busy: false,
    wide: false,
  },
);

const emit = defineEmits<{
  close: [];
}>();

const titleId = useId();
const panelRef = ref<HTMLElement | null>(null);
let previousOverflow = '';
let previouslyFocused: HTMLElement | null = null;

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function requestClose(): void {
  if (!props.busy) {
    emit('close');
  }
}

function focusableElements(): HTMLElement[] {
  if (!panelRef.value) {
    return [];
  }
  return [...panelRef.value.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => element.offsetParent !== null,
  );
}

function focusInitial(): void {
  if (!panelRef.value) {
    return;
  }

  const preferred = panelRef.value.querySelector<HTMLElement>('[data-autofocus]');
  const target = preferred ?? focusableElements()[0];
  target?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    requestClose();
    return;
  }

  if (event.key !== 'Tab') {
    return;
  }

  const elements = focusableElements();
  if (elements.length === 0) {
    event.preventDefault();
    panelRef.value?.focus();
    return;
  }

  const first = elements[0];
  const last = elements[elements.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || active === panelRef.value)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}

onMounted(() => {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKeydown, true);
  void nextTick(focusInitial);
});

onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow;
  document.removeEventListener('keydown', onKeydown, true);
  if (previouslyFocused?.isConnected) {
    previouslyFocused.focus();
  }
});
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        ref="panelRef"
        class="dialog-panel"
        :class="{ 'dialog-panel--wide': wide }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-busy="busy"
        tabindex="-1"
      >
        <header class="dialog-header">
          <div class="dialog-heading">
            <h2 :id="titleId" class="dialog-title">{{ title }}</h2>
            <p v-if="description" class="dialog-description">{{ description }}</p>
          </div>
          <button
            class="dialog-close"
            type="button"
            aria-label="关闭"
            :disabled="busy"
            @click="requestClose"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="m4 4 8 8m0-8-8 8"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>

        <div class="dialog-body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="dialog-footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(27, 30, 36, 0.28);
  animation: dialog-backdrop-in var(--bh-duration-fast) ease-out;
}

.dialog-panel {
  width: min(100%, 476px);
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--bh-color-border);
  border-radius: 18px;
  outline: 0;
  background: var(--bh-color-surface);
  box-shadow:
    0 30px 80px -38px rgba(22, 27, 38, 0.5),
    0 2px 8px rgba(22, 27, 38, 0.05);
  animation: dialog-panel-in var(--bh-duration-normal) var(--bh-ease-out);
}

.dialog-panel--wide {
  width: min(100%, 680px);
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.dialog-heading {
  flex: 1 1 auto;
  min-width: 0;
}

.dialog-title {
  margin: 0;
  color: var(--bh-color-text);
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.35;
}

.dialog-description {
  margin: 5px 0 0;
  color: var(--bh-color-text-faint);
  font-size: 12.5px;
  line-height: 1.5;
}

.dialog-close {
  display: grid;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: var(--bh-color-text-faint);
  background: transparent;
  cursor: pointer;
}

.dialog-close:hover:not(:disabled) {
  color: var(--bh-color-text);
  background: rgba(35, 40, 50, 0.05);
}

.dialog-close:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.dialog-close:disabled {
  cursor: default;
  opacity: 0.45;
}

.dialog-body {
  margin-top: 20px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--bh-color-border);
}

@keyframes dialog-backdrop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes dialog-panel-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
