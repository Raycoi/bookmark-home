<script setup lang="ts">
import { computed, ref } from 'vue';
import BookmarkFolder from './BookmarkFolder.vue';
import { useFolderInteractions } from '../composables/useFolderInteractions';
import { useI18n } from '../i18n';
import type { HomepageFolder } from '../types/bookmark';

const props = defineProps<{
  folder: HomepageFolder;
}>();

const moreButton = ref<HTMLButtonElement | null>(null);
const { t } = useI18n();
const {
  manager,
  isBusy,
  isDragging,
  isDropTarget,
  openMenu,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
} = useFolderInteractions(() => props.folder, moreButton);

const title = computed(() => props.folder.title.trim() || t('common.unnamedFolder'));
const isSelectionMode = computed(() => manager?.selectionMode.value ?? false);
const isSelected = computed(
  () => manager?.selectedIds.value.has(props.folder.id) ?? false,
);

function onHeaderClick(event: MouseEvent): void {
  if (!isSelectionMode.value || !manager) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  manager.toggleSelection(props.folder.id, event.shiftKey);
}
</script>

<template>
  <section
    class="bookmark-group"
    :class="{ 'is-dragging': isDragging, 'is-selected': isSelected }"
    :data-folder-id="folder.id"
  >
    <div
      class="bookmark-group__heading"
      :class="{ 'is-drop-target': isDropTarget }"
      :draggable="Boolean(manager) && !isBusy && !isSelectionMode"
      @click="onHeaderClick"
      @contextmenu="onContextMenu"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
      @dragover.stop="onDragOver"
      @dragleave="onDragLeave"
      @drop.stop="onDrop"
    >
      <span v-if="isSelectionMode" class="selection-check" aria-hidden="true">
        <svg v-if="isSelected" width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="m3.5 8.2 3 3 6-6.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <h2 class="section-title">{{ title }}</h2>
      <button
        v-if="manager && !isSelectionMode"
        ref="moreButton"
        class="group-more"
        type="button"
        :aria-label="t('bookmarkFolder.manage', { name: title })"
        :title="t('bookmarkFolder.manage', { name: title })"
        :disabled="isBusy"
        draggable="false"
        @click.stop="openMenu"
        @contextmenu.prevent.stop="openMenu"
        @dragstart.prevent.stop
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3.2" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.8" cy="8" r="1.25" />
        </svg>
      </button>
    </div>

    <BookmarkFolder :folder="folder" :depth="0" :show-header="false" />
  </section>
</template>

<style scoped>
.bookmark-group {
  min-width: 0;
  transition: opacity var(--bh-duration-fast) ease;
}

.bookmark-group.is-dragging {
  opacity: 0.38;
}

.bookmark-group.is-selected .bookmark-group__heading {
  background: var(--bh-color-accent-soft);
  box-shadow: inset 0 0 0 1px var(--bh-color-accent-border);
}

.selection-check {
  display: grid;
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  place-items: center;
  border: 1px solid var(--bh-color-border-strong);
  border-radius: 5px;
  color: #fff;
  background: var(--bh-color-surface);
}

.is-selected .selection-check {
  border-color: var(--bh-color-accent);
  background: var(--bh-color-accent);
}

.bookmark-group__heading {
  display: flex;
  align-items: center;
  gap: 5px;
  width: fit-content;
  max-width: 100%;
  margin-bottom: var(--bh-title-gap);
  border-radius: 8px;
  transition:
    background-color var(--bh-duration-fast) ease,
    box-shadow var(--bh-duration-fast) ease;
}

.bookmark-group__heading.is-drop-target {
  background: var(--bh-color-accent-soft);
  box-shadow: inset 0 0 0 1px var(--bh-color-accent-border);
}

.bookmark-group__heading :deep(.section-title) {
  margin: 0;
}

.group-more {
  display: grid;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--bh-color-text-faint);
  background: transparent;
  opacity: 0;
  cursor: pointer;
  transition:
    opacity var(--bh-duration-fast) ease,
    background-color var(--bh-duration-fast) ease;
}

.bookmark-group__heading:hover .group-more,
.bookmark-group__heading:focus-within .group-more,
.group-more:focus-visible {
  opacity: 1;
}

.group-more:hover {
  color: var(--bh-color-text);
  background: rgba(35, 40, 50, 0.07);
}

.group-more:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

@media (hover: none) {
  .group-more {
    opacity: 0.7;
  }
}
</style>
