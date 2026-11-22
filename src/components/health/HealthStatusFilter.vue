<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../../i18n';
import type { HealthCounts } from '../../composables/useWebsiteHealth';
import type { HealthFilter } from '../../types/websiteHealth';

const props = defineProps<{
  counts: HealthCounts;
  active: HealthFilter;
}>();

const emit = defineEmits<{
  select: [filter: HealthFilter];
}>();

const { t } = useI18n();

const filters = computed<
  Array<{ id: HealthFilter; label: string; count: number }>
>(() => {
  const items: Array<{ id: HealthFilter; label: string; count: number }> = [
    { id: 'all', label: t('health.filter.all'), count: props.counts.total },
    { id: 'healthy', label: t('health.filter.healthy'), count: props.counts.healthy },
    { id: 'abnormal', label: t('health.filter.abnormal'), count: props.counts.abnormal },
    {
      id: 'pending',
      label: t('health.filter.pending'),
      count: props.counts.pending + props.counts.checking,
    },
    { id: 'unknown', label: t('health.filter.unknown'), count: props.counts.unknown },
    { id: 'unsupported', label: t('health.filter.unsupported'), count: props.counts.unsupported },
    { id: 'private', label: t('health.filter.private'), count: props.counts.private },
    { id: 'unlisted', label: t('health.filter.unlisted'), count: props.counts.unlisted },
  ];

  return items.filter(
    (filter) =>
      (filter.id !== 'private' || props.counts.private > 0) &&
      (filter.id !== 'unlisted' || props.counts.unlisted > 0),
  );
});
</script>

<template>
  <div class="health-filter" role="group" :aria-label="t('health.filter.aria')">
    <button
      v-for="filter in filters"
      :key="filter.id"
      class="health-filter__button"
      :class="{ 'is-active': active === filter.id }"
      type="button"
      :aria-pressed="active === filter.id"
      @click="emit('select', filter.id)"
    >
      {{ filter.label }}
      <span class="health-filter__count">{{ filter.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.health-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 0 0 12px;
}

.health-filter__button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--bh-color-text-soft);
  background: var(--bh-health-neutral-soft);
  font-size: 11.5px;
  cursor: pointer;
}

.health-filter__button:hover {
  border-color: var(--bh-color-border-strong);
  color: var(--bh-color-text);
}

.health-filter__button:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.health-filter__button.is-active {
  border-color: var(--bh-color-accent-border);
  color: var(--bh-color-accent);
  background: var(--bh-color-accent-soft);
}

.health-filter__count {
  color: var(--bh-color-text-faint);
  font-size: 10.5px;
}

.health-filter__button.is-active .health-filter__count {
  color: var(--bh-color-accent);
}
</style>
