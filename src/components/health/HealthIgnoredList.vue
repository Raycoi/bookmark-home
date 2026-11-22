<script setup lang="ts">
import { useI18n } from '../../i18n';
import type { HealthBookmarkEntry } from '../../utils/healthBookmarks';

defineProps<{
  entries: HealthBookmarkEntry[];
  disabled: boolean;
}>();

const emit = defineEmits<{
  restore: [rawUrl: string];
}>();

const { t } = useI18n();
</script>

<template>
  <section class="health-ignored" :aria-label="t('health.ignored.aria')">
    <h3 class="health-ignored__title">{{ t('health.ignored.title', { count: entries.length }) }}</h3>
    <ul class="health-ignored__list">
      <li v-for="entry in entries" :key="entry.key" class="health-ignored__item">
        <span class="health-ignored__body">
          <strong>{{ entry.title }}</strong>
          <span>{{ entry.normalizedUrl ?? entry.rawUrl }}</span>
        </span>
        <button
          class="health-ignored__restore"
          type="button"
          :disabled="disabled"
          @click="emit('restore', entry.rawUrl)"
        >
          {{ t('health.ignored.restore') }}
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.health-ignored {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--bh-color-border);
}

.health-ignored__title {
  margin: 0 0 8px;
  color: var(--bh-color-text-soft);
  font-size: 12px;
  font-weight: 620;
}

.health-ignored__list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.health-ignored__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border: 1px solid var(--bh-color-border);
  border-radius: 8px;
  background: var(--bh-color-surface);
}

.health-ignored__body {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.health-ignored__body strong {
  overflow: hidden;
  color: var(--bh-color-text-soft);
  font-size: 11.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-ignored__body span {
  overflow: hidden;
  color: var(--bh-color-text-faint);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-ignored__restore {
  flex: 0 0 auto;
  padding: 3px 7px;
  border: 1px solid var(--bh-color-border-strong);
  border-radius: 6px;
  color: var(--bh-color-text-soft);
  background: transparent;
  font-size: 10.5px;
  cursor: pointer;
}

.health-ignored__restore:hover:not(:disabled) {
  background: #f7f7f5;
}

.health-ignored__restore:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
