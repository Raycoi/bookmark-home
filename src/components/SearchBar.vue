<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSearch } from '../composables/useSearch';

const { engines, selectedEngineId, setSearchEngine, submitSearch } = useSearch();

const query = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

const engineModel = computed({
  get: () => selectedEngineId.value,
  set: (value: string) => setSearchEngine(value),
});

function onSubmit(): void {
  if (!query.value.trim()) {
    inputRef.value?.focus();
    return;
  }
  submitSearch(query.value);
}

function clearQuery(): void {
  query.value = '';
}
</script>

<template>
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
      aria-label="搜索关键词"
      placeholder="搜索网页"
      @keydown.esc="clearQuery"
    />

    <div class="engine-picker">
      <select v-model="engineModel" class="engine-select" aria-label="选择搜索引擎">
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
</template>

<style scoped>
.search-form {
  display: flex;
  align-items: center;
  width: min(100%, 660px);
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
}
</style>
