<script setup lang="ts">
import { computed, ref } from 'vue';
import BookmarkItem from './BookmarkItem.vue';
import { useFolderInteractions } from '../composables/useFolderInteractions';
import type { HomepageFolder } from '../types/bookmark';

const props = withDefaults(
  defineProps<{
    folder: HomepageFolder;
    depth?: number;
    showHeader?: boolean;
  }>(),
  {
    depth: 0,
    showHeader: true,
  },
);

const moreButton = ref<HTMLButtonElement | null>(null);
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

const title = computed(() => props.folder.title.trim() || '未命名文件夹');
const isNested = computed(() => props.depth > 0);
</script>

<template>
  <section
    class="bookmark-folder"
    :class="{ 'bookmark-folder--nested': isNested, 'is-dragging': isDragging }"
    :data-depth="depth"
    :data-folder-id="folder.id"
  >
    <header
      v-if="showHeader"
      class="bookmark-folder__heading"
      :class="{ 'is-drop-target': isDropTarget }"
      :draggable="Boolean(manager) && !isBusy"
      @contextmenu="onContextMenu"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
      @dragover.stop="onDragOver"
      @dragleave="onDragLeave"
      @drop.stop="onDrop"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        class="folder-icon"
      >
        <path
          d="M3.75 7.25A1.75 1.75 0 0 1 5.5 5.5h4.1l1.7 2h7.2a1.75 1.75 0 0 1 1.75 1.75v7.5a1.75 1.75 0 0 1-1.75 1.75h-13a1.75 1.75 0 0 1-1.75-1.75v-9.5Z"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
      </svg>
      <h3 class="bookmark-folder__title">{{ title }}</h3>

      <button
        v-if="manager"
        ref="moreButton"
        class="folder-more"
        type="button"
        :aria-label="`管理文件夹${title}`"
        :title="`管理文件夹${title}`"
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
    </header>

    <p v-if="folder.children.length === 0" class="bookmark-folder__empty">空文件夹</p>

    <div v-else class="bookmark-grid bookmark-grid--rows">
      <template v-for="node in folder.children" :key="node.id">
        <BookmarkItem
          v-if="node.type === 'bookmark'"
          :bookmark="node"
          variant="horizontal"
        />
        <BookmarkFolder
          v-else
          :folder="node"
          :depth="depth + 1"
          :show-header="true"
        />
      </template>
    </div>
  </section>
</template>

<style scoped>
.bookmark-folder {
  grid-column: 1 / -1;
  min-width: 0;
  transition: opacity var(--bh-duration-fast) ease;
}

.bookmark-folder.is-dragging {
  opacity: 0.38;
}

.bookmark-grid--rows {
  grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
  gap: 8px;
}

.bookmark-folder--nested {
  margin: 10px 0 12px;
  padding-left: clamp(12px, 2vw, 22px);
  border-left: 1px solid var(--bh-color-border);
}

.bookmark-folder__heading {
  display: flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  max-width: 100%;
  margin: 0 0 9px;
  padding: 3px 4px 3px 4px;
  border-radius: 8px;
  color: var(--bh-color-text-soft);
  transition:
    background-color var(--bh-duration-fast) ease,
    box-shadow var(--bh-duration-fast) ease;
}

.bookmark-folder__heading:hover {
  background: rgba(35, 40, 50, 0.035);
}

.bookmark-folder__heading.is-drop-target {
  background: var(--bh-color-accent-soft);
  box-shadow: inset 0 0 0 1px var(--bh-color-accent-border);
}

.folder-icon {
  flex: 0 0 auto;
  color: var(--bh-color-text-faint);
}

.bookmark-folder__title {
  margin: 0;
  overflow: hidden;
  color: var(--bh-color-text-soft);
  font-size: 13px;
  font-weight: 620;
  letter-spacing: -0.005em;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-more {
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

.bookmark-folder__heading:hover .folder-more,
.bookmark-folder__heading:focus-within .folder-more,
.folder-more:focus-visible {
  opacity: 1;
}

.folder-more:hover {
  color: var(--bh-color-text);
  background: rgba(35, 40, 50, 0.07);
}

.folder-more:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.bookmark-folder__empty {
  margin: 2px 0 4px;
  padding-left: 26px;
  color: var(--bh-color-text-faint);
  font-size: 12px;
}

@media (hover: none) {
  .folder-more {
    opacity: 0.7;
  }
}

@media (max-width: 900px) {
  .bookmark-grid--rows {
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 6px;
  }
}

@media (max-width: 560px) {
  .bookmark-grid--rows {
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  }
}
</style>
