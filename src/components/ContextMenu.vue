<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import type { ContextMenuState } from '../types/management';

const props = defineProps<{
  state: ContextMenuState;
}>();

const emit = defineEmits<{
  select: [id: string];
  close: [];
}>();

const { t } = useI18n();
const menuRef = ref<HTMLElement | null>(null);
const left = ref(props.state.x);
const top = ref(props.state.y);
let previouslyFocused: HTMLElement | null = null;

function updatePosition(): void {
  const menu = menuRef.value;
  if (!menu) {
    return;
  }

  const rect = menu.getBoundingClientRect();
  const margin = 8;
  left.value = Math.min(
    Math.max(margin, props.state.x),
    Math.max(margin, window.innerWidth - rect.width - margin),
  );
  top.value = Math.min(
    Math.max(margin, props.state.y),
    Math.max(margin, window.innerHeight - rect.height - margin),
  );
}

function items(): HTMLButtonElement[] {
  return menuRef.value
    ? [...menuRef.value.querySelectorAll<HTMLButtonElement>('.context-menu__item:not(:disabled)')]
    : [];
}

function focusFirst(): void {
  void nextTick(() => {
    updatePosition();
    items()[0]?.focus();
  });
}

function close(): void {
  emit('close');
}

function onPointerDown(event: PointerEvent): void {
  if (
    menuRef.value &&
    event.target instanceof Node &&
    !menuRef.value.contains(event.target)
  ) {
    close();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }

  if (event.key === 'Tab') {
    close();
    return;
  }

  const entries = items();
  if (entries.length === 0) {
    return;
  }

  const currentIndex = entries.indexOf(document.activeElement as HTMLButtonElement);
  if (currentIndex === -1) {
    if (event.key === 'ArrowUp' || event.key === 'End') {
      event.preventDefault();
      entries[entries.length - 1]?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'Home') {
      event.preventDefault();
      entries[0]?.focus();
    }
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    entries[(currentIndex + 1 + entries.length) % entries.length]?.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    entries[(currentIndex - 1 + entries.length) % entries.length]?.focus();
  } else if (event.key === 'Home') {
    event.preventDefault();
    entries[0]?.focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    entries[entries.length - 1]?.focus();
  }
}

function onWindowScroll(event: Event): void {
  if (menuRef.value && event.target instanceof Node && menuRef.value.contains(event.target)) {
    return;
  }
  close();
}

onMounted(() => {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', onWindowScroll, true);
  focusFirst();
});

watch(
  () => props.state,
  () => focusFirst(),
);

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', onWindowScroll, true);
  if (previouslyFocused?.isConnected) {
    previouslyFocused.focus();
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="menuRef"
      class="context-menu"
      role="menu"
      :aria-label="t('contextMenu.label')"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @contextmenu.prevent
    >
      <template v-for="item in state.items" :key="item.id">
        <div v-if="item.separatorBefore" class="context-menu__separator"></div>
        <button
          class="context-menu__item"
          :class="{ 'context-menu__item--danger': item.danger }"
          type="button"
          role="menuitem"
          :disabled="item.disabled"
          @click="emit('select', item.id)"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 55;
  width: 200px;
  padding: 6px;
  border: 1px solid var(--bh-color-border);
  border-radius: 12px;
  background: var(--bh-color-surface);
  box-shadow:
    0 18px 48px -22px rgba(24, 28, 36, 0.36),
    0 2px 8px rgba(24, 28, 36, 0.06);
  animation: context-menu-in var(--bh-duration-fast) var(--bh-ease-out);
}

.context-menu__item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  color: var(--bh-color-text);
  background: transparent;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.context-menu__item:hover:not(:disabled),
.context-menu__item:focus-visible:not(:disabled) {
  outline: 0;
  background: rgba(35, 40, 50, 0.055);
}

.context-menu__item:focus-visible {
  box-shadow: inset 0 0 0 1px var(--bh-color-accent-border);
}

.context-menu__item:disabled {
  cursor: default;
  opacity: 0.42;
}

.context-menu__item--danger {
  color: var(--bh-color-danger);
}

.context-menu__item--danger:hover:not(:disabled),
.context-menu__item--danger:focus-visible:not(:disabled) {
  background: var(--bh-color-danger-soft);
}

.context-menu__separator {
  height: 1px;
  margin: 5px 6px;
  background: var(--bh-color-border);
}

@keyframes context-menu-in {
  from {
    opacity: 0;
    transform: translateY(-2px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
