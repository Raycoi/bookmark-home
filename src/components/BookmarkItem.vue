<script setup lang="ts">
import { computed, ref } from 'vue';
import Favicon from './Favicon.vue';
import HealthStatusIndicator from './health/HealthStatusIndicator.vue';
import { useBookmarkManagerContext } from '../composables/useBookmarkManager';
import type { HomepageBookmark } from '../types/bookmark';
import { getNavigableUrl } from '../utils/navigation';

const props = withDefaults(
  defineProps<{
    bookmark: HomepageBookmark;
    eager?: boolean;
    variant?: 'vertical' | 'horizontal';
  }>(),
  {
    eager: false,
    variant: 'vertical',
  },
);

const manager = useBookmarkManagerContext();
const moreButton = ref<HTMLButtonElement | null>(null);

const title = computed(() => props.bookmark.title.trim() || '未命名书签');
const safeUrl = computed(() => getNavigableUrl(props.bookmark.url));
const faviconSize = computed(() => (props.variant === 'horizontal' ? 32 : 42));
const isBusy = computed(() => manager?.busy.value ?? false);
const isDragging = computed(
  () => manager?.isDraggingNode(props.bookmark.id) ?? false,
);
const dropBefore = computed(
  () => manager?.isBookmarkDropBefore(props.bookmark.id) ?? false,
);
const dropAfter = computed(
  () => manager?.isBookmarkDropAfter(props.bookmark.id) ?? false,
);
const tooltip = computed(() =>
  safeUrl.value ? `${title.value}\n${safeUrl.value}` : `网址格式无效：${props.bookmark.url}`,
);

function onContextMenu(event: MouseEvent): void {
  manager?.openBookmarkContextMenu(event, props.bookmark);
}

function openMenu(): void {
  if (!manager || !moreButton.value) {
    return;
  }
  manager.openBookmarkMenuAt(moreButton.value, props.bookmark);
}

function onDragStart(event: DragEvent): void {
  if (!manager) {
    event.preventDefault();
    return;
  }
  manager.startDrag(event, { kind: 'bookmark', node: props.bookmark });
}

function onDragEnd(): void {
  manager?.endDrag();
}

function onDragOver(event: DragEvent): void {
  manager?.dragOverBookmark(event, props.bookmark);
}

function onDragLeave(event: DragEvent): void {
  manager?.dragLeaveBookmark(event, props.bookmark.id);
}

function onDrop(event: DragEvent): void {
  manager?.dropOnBookmark(event, props.bookmark);
}

function onClick(event: MouseEvent): void {
  manager?.shouldSuppressClick(event);
}
</script>

<template>
  <div
    class="bookmark-entry"
    :class="[
      `bookmark-entry--${variant}`,
      {
        'is-dragging': isDragging,
        'is-drop-before': dropBefore,
        'is-drop-after': dropAfter,
      },
    ]"
    :data-bookmark-id="bookmark.id"
    :draggable="Boolean(manager) && !isBusy"
    @contextmenu="onContextMenu"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover.stop="onDragOver"
    @dragleave="onDragLeave"
    @drop.stop="onDrop"
  >
    <a
      v-if="safeUrl"
      class="bookmark-item"
      :class="`bookmark-item--${variant}`"
      :href="safeUrl"
      :title="tooltip"
      draggable="false"
      @click="onClick"
    >
      <Favicon :url="bookmark.url" :size="faviconSize" :eager="eager" />
      <span class="bookmark-name">{{ title }}</span>
    </a>

    <span
      v-else
      class="bookmark-item"
      :class="[`bookmark-item--${variant}`, 'bookmark-item--disabled']"
      :title="tooltip"
      aria-disabled="true"
    >
      <Favicon :url="bookmark.url" :size="faviconSize" :eager="eager" />
      <span class="bookmark-name">{{ title }}</span>
    </span>

    <HealthStatusIndicator :raw-url="bookmark.url" :variant="variant" />

    <button
      v-if="manager"
      ref="moreButton"
      class="bookmark-more"
      type="button"
      :aria-label="`管理${title}`"
      :title="`管理${title}`"
      :disabled="isBusy"
      draggable="false"
      @click.stop="openMenu"
      @contextmenu.prevent.stop="openMenu"
      @dragstart.prevent.stop
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="3.2" cy="8" r="1.25" />
        <circle cx="8" cy="8" r="1.25" />
        <circle cx="12.8" cy="8" r="1.25" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.bookmark-entry {
  position: relative;
  min-width: 0;
  transition: opacity var(--bh-duration-fast) ease;
}

.bookmark-entry--vertical {
  height: var(--bh-bookmark-item-height);
}

.bookmark-entry--horizontal {
  height: 52px;
}

.bookmark-entry.is-dragging {
  opacity: 0.38;
}

.bookmark-entry.is-drop-before::before,
.bookmark-entry.is-drop-after::after {
  position: absolute;
  top: 5px;
  bottom: 5px;
  z-index: 3;
  width: 2px;
  border-radius: 999px;
  background: var(--bh-color-accent);
  content: '';
}

.bookmark-entry.is-drop-before::before {
  left: -4px;
}

.bookmark-entry.is-drop-after::after {
  right: -4px;
}

.bookmark-item {
  width: 100%;
  height: 100%;
  min-width: 0;
  color: var(--bh-color-text);
  text-decoration: none;
  transition:
    background-color var(--bh-duration-fast) ease,
    border-color var(--bh-duration-fast) ease,
    box-shadow var(--bh-duration-fast) ease,
    transform var(--bh-duration-fast) var(--bh-ease-out);
}

.bookmark-item:hover {
  transform: translateY(-1px);
}

.bookmark-item:active {
  transform: translateY(0);
}

.bookmark-item:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.bookmark-item--vertical {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  height: var(--bh-bookmark-item-height);
  padding: 10px 6px 8px;
  border-radius: 14px;
  text-align: center;
}

.bookmark-item--vertical:hover {
  background: var(--bh-color-surface-hover);
}

.bookmark-item--horizontal {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 8px 50px 8px 9px;
  overflow: hidden;
  border: 1px solid var(--bh-color-border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.7);
}

.bookmark-item--horizontal:hover {
  border-color: var(--bh-color-border-strong);
  background: var(--bh-color-surface);
  box-shadow: 0 6px 16px -14px rgba(30, 35, 45, 0.45);
}

.bookmark-name {
  overflow: hidden;
  color: var(--bh-color-text);
  font-size: 13px;
  font-weight: 520;
  letter-spacing: -0.005em;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmark-item--vertical .bookmark-name {
  width: 100%;
}

.bookmark-item--horizontal .bookmark-name {
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
}

.bookmark-more {
  position: absolute;
  z-index: 4;
  display: grid;
  width: 22px;
  height: 22px;
  padding: 0;
  place-items: center;
  border: 1px solid var(--bh-color-border);
  border-radius: 50%;
  color: var(--bh-color-text-faint);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 1px 3px rgba(30, 35, 45, 0.05);
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition:
    opacity var(--bh-duration-fast) ease,
    color var(--bh-duration-fast) ease,
    background-color var(--bh-duration-fast) ease;
}

.bookmark-entry--vertical .bookmark-more {
  top: 4px;
  right: 2px;
}

.bookmark-entry--horizontal .bookmark-more {
  top: 50%;
  right: 7px;
  transform: translateY(-50%);
}

.bookmark-entry:hover .bookmark-more,
.bookmark-entry:focus-within .bookmark-more,
.bookmark-more:focus-visible {
  opacity: 1;
  pointer-events: auto;
}

.bookmark-more:hover {
  color: var(--bh-color-text);
  background: var(--bh-color-surface);
}

.bookmark-more:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.bookmark-more:disabled {
  cursor: default;
  opacity: 0.4;
}

.bookmark-item--disabled {
  cursor: default;
  opacity: 0.56;
}

.bookmark-item--disabled:hover {
  background: transparent;
  box-shadow: none;
  transform: none;
}

@media (hover: none) {
  .bookmark-more {
    opacity: 0.72;
    pointer-events: auto;
  }
}
</style>
