<script setup lang="ts">
import { computed } from 'vue';
import type { HealthCounts } from '../../composables/useWebsiteHealth';
import type { HealthFilter } from '../../types/websiteHealth';

const props = defineProps<{
  counts: HealthCounts;
  active: HealthFilter;
}>();

const emit = defineEmits<{
  select: [filter: HealthFilter];
}>();

const filters = computed<
  Array<{ id: HealthFilter; label: string; count: number }>
>(() => {
  const items: Array<{ id: HealthFilter; label: string; count: number }> = [
    { id: 'all', label: '全部', count: props.counts.total },
    { id: 'healthy', label: '正常', count: props.counts.healthy },
    { id: 'abnormal', label: '异常', count: props.counts.abnormal },
    {
      id: 'pending',
      label: '待检测',
      count: props.counts.pending + props.counts.checking,
    },
    { id: 'unknown', label: '无法确认', count: props.counts.unknown },
    { id: 'unsupported', label: '无法检测', count: props.counts.unsupported },
    { id: 'private', label: '内网', count: props.counts.private },
    { id: 'unlisted', label: '未展示', count: props.counts.unlisted },
  ];

  return items.filter(
    (filter) =>
      (filter.id !== 'private' || props.counts.private > 0) &&
      (filter.id !== 'unlisted' || props.counts.unlisted > 0),
  );
});
</script>

<template>
  <div class="health-filter" role="group" aria-label="按健康状态筛选">
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
