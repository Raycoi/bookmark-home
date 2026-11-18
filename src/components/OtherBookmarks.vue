<script setup lang="ts">
import { ref } from 'vue';
import BookmarkFolder from './BookmarkFolder.vue';
import { useFolderInteractions } from '../composables/useFolderInteractions';
import type { HomepageSection } from '../types/bookmark';

const props = defineProps<{
  section: HomepageSection;
}>();

const moreButton = ref<HTMLButtonElement | null>(null);
const {
  manager,
  isBusy,
  isDropTarget,
  openMenu,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
} = useFolderInteractions(() => props.section, moreButton);
</script>

<template>
  <details class="other-bookmarks">
    <summary
      class="other-bookmarks__summary"
      :class="{ 'is-drop-target': isDropTarget }"
      @contextmenu="onContextMenu"
      @dragover.stop="onDragOver"
      @dragleave="onDragLeave"
      @drop.stop="onDrop"
    >
      <h2 class="other-bookmarks__title">其他书签</h2>
      <svg
        class="other-bookmarks__chevron"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m4 6 4 4 4-4"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <button
        v-if="manager"
        ref="moreButton"
        class="other-bookmarks__more"
        type="button"
        aria-label="管理其他书签"
        title="管理其他书签"
        :disabled="isBusy"
        @click.prevent.stop="openMenu"
        @contextmenu.prevent.stop="openMenu"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3.2" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.8" cy="8" r="1.25" />
        </svg>
      </button>
    </summary>

    <div class="other-bookmarks__content">
      <BookmarkFolder :folder="section" :depth="0" :show-header="false" />
    </div>
  </details>
</template>

<style scoped>
.other-bookmarks {
  margin-top: clamp(56px, 7vw, 84px);
  padding-top: 22px;
  border-top: 1px solid var(--bh-color-border);
}

.other-bookmarks__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  color: var(--bh-color-text);
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.other-bookmarks__summary.is-drop-target {
  border-radius: 8px;
  background: var(--bh-color-accent-soft);
  box-shadow: inset 0 0 0 1px var(--bh-color-accent-border);
}

.other-bookmarks__summary::-webkit-details-marker {
  display: none;
}

.other-bookmarks__summary:focus-visible {
  border-radius: 6px;
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 4px;
}

.other-bookmarks__title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.other-bookmarks__chevron {
  color: var(--bh-color-text-faint);
  transition: transform var(--bh-duration-normal) var(--bh-ease-out);
}

.other-bookmarks__more {
  display: grid;
  width: 22px;
  height: 22px;
  margin-left: 1px;
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

.other-bookmarks__summary:hover .other-bookmarks__more,
.other-bookmarks__summary:focus-within .other-bookmarks__more,
.other-bookmarks__more:focus-visible {
  opacity: 1;
}

.other-bookmarks__more:hover {
  color: var(--bh-color-text);
  background: rgba(35, 40, 50, 0.07);
}

.other-bookmarks__more:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

@media (hover: none) {
  .other-bookmarks__more {
    opacity: 0.7;
  }
}

.other-bookmarks[open] .other-bookmarks__chevron {
  transform: rotate(180deg);
}

.other-bookmarks__content {
  padding-top: 20px;
  animation: bh-reveal var(--bh-duration-normal) var(--bh-ease-out);
}

@keyframes bh-reveal {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
