<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Favicon from './Favicon.vue';
import { useBookmarkManagerContext } from '../composables/useBookmarkManager';
import { useSearch } from '../composables/useSearch';
import {
  clearRecentBookmarks,
  readRecentBookmarks,
  recordRecentBookmark,
} from '../services/recentBookmarksService';
import type { RecentBookmark, SearchableBookmark } from '../types/search';
import { collectSearchableBookmarks, searchBookmarks } from '../utils/bookmarkSearch';
import { getNavigableUrl } from '../utils/navigation';
import type { SearchableBookmark as SearchableBookmarkType } from '../types/search';

const props = defineProps<{
  bookmarks?: SearchableBookmarkType[];
}>();

const { engines, selectedEngineId, setSearchEngine, submitSearch } = useSearch();
const manager = useBookmarkManagerContext();

const query = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const focused = ref(false);
const activeIndex = ref(-1);
const recent = ref<RecentBookmark[]>([]);

const bookmarkIndex = computed(() =>
  props.bookmarks ?? collectSearchableBookmarks(manager?.homepage.value ?? null),
);
const results = computed(() =>
  query.value.trim()
    ? searchBookmarks(bookmarkIndex.value, query.value, 5)
    : [],
);
const visibleItems = computed<Array<SearchableBookmark | RecentBookmark>>(() =>
  query.value.trim() ? results.value : recent.value,
);
const showPanel = computed(
  () => focused.value && visibleItems.value.length > 0,
);
const activeId = computed(() =>
  activeIndex.value >= 0 ? `search-option-${activeIndex.value}` : undefined,
);

const engineModel = computed({
  get: () => selectedEngineId.value,
  set: (value: string) => setSearchEngine(value),
});

function onSubmit(): void {
  const item = visibleItems.value[activeIndex.value];
  if (item) {
    openItem(item);
    return;
  }
  if (!query.value.trim()) {
    inputRef.value?.focus();
    return;
  }
  closePanel();
  submitSearch(query.value);
}

function openItem(item: SearchableBookmark | RecentBookmark): void {
  const url = getNavigableUrl(item.url);
  if (!url) {
    return;
  }

  void recordRecentBookmark({
    id: item.id,
    title: item.title,
    url: item.url,
    folderPath: item.folderPath,
  });
  closePanel();
  window.location.assign(url);
}

function closePanel(): void {
  focused.value = false;
  activeIndex.value = -1;
}

function clearQuery(): void {
  query.value = '';
  activeIndex.value = -1;
  inputRef.value?.focus();
}

function onFocus(): void {
  focused.value = true;
  void loadRecent();
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (showPanel.value) {
      closePanel();
    } else {
      clearQuery();
    }
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!showPanel.value) {
      return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const total = visibleItems.value.length;
    activeIndex.value =
      activeIndex.value < 0
        ? direction > 0
          ? 0
          : total - 1
        : (activeIndex.value + direction + total) % total;
    return;
  }
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Node && rootRef.value && !rootRef.value.contains(target)) {
    closePanel();
  }
}

async function loadRecent(): Promise<void> {
  recent.value = await readRecentBookmarks();
}

async function clearHistory(): Promise<void> {
  await clearRecentBookmarks();
  recent.value = [];
  activeIndex.value = -1;
  inputRef.value?.focus();
}

watch(query, () => {
  activeIndex.value = -1;
});

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  void loadRecent();
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
});
</script>

<template>
  <div ref="rootRef" class="search-shell">
    <form class="search-form" role="search" @submit.prevent="onSubmit">
      <svg
        class="search-icon"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.7" />
        <path
          d="m16 16 4 4"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
        />
      </svg>

      <input
        ref="inputRef"
        v-model="query"
        class="search-input"
        type="text"
        inputmode="search"
        enterkeyhint="search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        role="combobox"
        :aria-label="$t('搜索网页或书签')"
        aria-autocomplete="list"
        :aria-expanded="showPanel"
        :aria-controls="showPanel ? 'search-options' : undefined"
        :aria-activedescendant="activeId"
        :placeholder="$t('搜索网页或书签')"
        @focus="onFocus"
        @focusin="onFocus"
        @click="onFocus"
        @keydown="onInputKeydown"
      />

      <div class="engine-picker">
        <select v-model="engineModel" class="engine-select" :aria-label="$t('选择搜索引擎')">
          <option v-for="engine in engines" :key="engine.id" :value="engine.id">
            {{ engine.name }}
          </option>
        </select>
        <svg
          class="engine-chevron"
          width="12"
          height="12"
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
      </div>
    </form>

    <div v-if="showPanel" id="search-options" class="search-panel">
      <div class="search-panel__heading">
        <span>{{ query.trim() ? $t('书签') : $t('最近书签') }}</span>
        <button
          v-if="!query.trim()"
          class="search-panel__clear"
          type="button"
          @mousedown.prevent
          @click="clearHistory"
        >
          {{ $t('清理历史') }}
        </button>
        <span v-else class="search-panel__count">{{ $t('{count} 条', { count: results.length }) }}</span>
      </div>

      <ul class="search-list" role="listbox" :aria-label="$t('本地书签搜索结果')">
        <li
          v-for="(item, index) in visibleItems"
          :id="`search-option-${index}`"
          :key="`${item.id}-${index}`"
          role="option"
          :aria-selected="index === activeIndex"
          class="search-option"
          :class="{ 'is-active': index === activeIndex }"
          @mouseenter="activeIndex = index"
          @mousedown.prevent
          @click="openItem(item)"
        >
          <Favicon :url="item.url" :size="24" />
          <span class="search-option__body">
            <span class="search-option__title">{{ item.title }}</span>
            <span class="search-option__path">{{ item.folderPath || $t('书签') }}</span>
          </span>
          <span class="search-option__arrow" aria-hidden="true">↵</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.search-shell {
  position: relative;
  z-index: 12;
  width: min(100%, 660px);
}

.search-form {
  display: flex;
  align-items: center;
  width: 100%;
  height: 60px;
  padding: 0 8px 0 20px;
  border: 1px solid var(--bh-color-border);
  border-radius: var(--bh-radius-lg);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--bh-shadow-search);
  transition:
    border-color var(--bh-duration-fast) ease,
    box-shadow var(--bh-duration-normal) var(--bh-ease-out),
    background-color var(--bh-duration-fast) ease;
}

.search-form:hover {
  border-color: var(--bh-color-border-strong);
  background: var(--bh-color-surface);
}

.search-form:focus-within {
  border-color: var(--bh-color-accent-border);
  background: var(--bh-color-surface);
  box-shadow: var(--bh-shadow-search-focus);
}

.search-icon {
  flex: 0 0 auto;
  color: var(--bh-color-text-faint);
  transition: color var(--bh-duration-fast) ease;
}

.search-form:focus-within .search-icon {
  color: var(--bh-color-accent);
}

.search-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 14px;
  border: 0;
  outline: 0;
  color: var(--bh-color-text);
  background: transparent;
  font-size: 16px;
  letter-spacing: -0.01em;
}

.search-input::placeholder {
  color: var(--bh-color-text-faint);
  opacity: 1;
}

.engine-picker {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  height: 36px;
  margin-left: 2px;
  padding-left: 10px;
  border-left: 1px solid var(--bh-color-border);
}

.engine-select {
  max-width: 112px;
  height: 36px;
  padding: 0 26px 0 9px;
  border: 0;
  border-radius: var(--bh-radius-sm);
  outline: 0;
  appearance: none;
  color: var(--bh-color-text-soft);
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    color var(--bh-duration-fast) ease,
    background-color var(--bh-duration-fast) ease;
}

.engine-select:hover {
  color: var(--bh-color-text);
  background: rgba(35, 40, 50, 0.045);
}

.engine-select:focus-visible {
  color: var(--bh-color-text);
  box-shadow: 0 0 0 2px var(--bh-color-accent-soft);
}

.engine-chevron {
  position: absolute;
  right: 7px;
  color: var(--bh-color-text-faint);
  pointer-events: none;
}

.search-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  left: 0;
  overflow: hidden;
  border: 1px solid var(--bh-color-border-strong);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow:
    0 18px 45px -28px rgba(30, 35, 45, 0.42),
    0 2px 6px rgba(30, 35, 45, 0.04);
  animation: search-panel-in var(--bh-duration-normal) var(--bh-ease-out);
}

.search-panel__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 11px 15px 4px;
  color: var(--bh-color-text-faint);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.search-panel__count {
  letter-spacing: 0;
  text-transform: none;
}

.search-panel__clear {
  padding: 2px 0;
  border: 0;
  color: var(--bh-color-text-faint);
  background: transparent;
  font-size: 11px;
  cursor: pointer;
  transition: color var(--bh-duration-fast) ease;
}

.search-panel__clear:hover {
  color: var(--bh-color-danger);
}

.search-list {
  max-height: 330px;
  margin: 0;
  padding: 0 6px 6px;
  overflow: auto;
  list-style: none;
}

.search-option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 9px;
  border-radius: 10px;
  color: var(--bh-color-text);
  cursor: pointer;
  transition: background-color var(--bh-duration-fast) ease;
}

.search-option.is-active,
.search-option:hover {
  background: var(--bh-color-accent-soft);
}

.search-option__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  text-align: left;
}

.search-option__title,
.search-option__path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-option__title {
  font-size: 13px;
  font-weight: 560;
}

.search-option__path {
  color: var(--bh-color-text-faint);
  font-size: 11px;
}

.search-option__arrow {
  flex: 0 0 auto;
  color: var(--bh-color-text-faint);
  font-size: 12px;
  opacity: 0;
  transition: opacity var(--bh-duration-fast) ease;
}

.search-option.is-active .search-option__arrow,
.search-option:hover .search-option__arrow {
  opacity: 1;
}

@keyframes search-panel-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 560px) {
  .search-form {
    height: 54px;
    padding-left: 16px;
    border-radius: 16px;
  }

  .search-input {
    padding: 0 10px;
    font-size: 15px;
  }

  .engine-select {
    max-width: 88px;
    font-size: 12px;
  }

  .search-panel {
    border-radius: 14px;
  }
}
</style>
