<script setup lang="ts">
import { useI18n } from '../../i18n';
import type { HealthCounts } from '../../composables/useWebsiteHealth';

defineProps<{
  counts: HealthCounts;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="health-summary" :aria-label="t('health.summaryAria')">
    <span class="health-summary__item">{{ t('health.summary.totalPrefix') }}<strong>{{ counts.total }}</strong>{{ t('health.summary.totalSuffix') }}</span>
    <span class="health-summary__item health-summary__item--ok">{{ t('health.summary.healthy', { count: counts.healthy }) }}</span>
    <span class="health-summary__item health-summary__item--error">{{ t('health.summary.abnormal', { count: counts.abnormal }) }}</span>
    <span class="health-summary__item">{{ t('health.summary.pending', { count: counts.pending + counts.checking }) }}</span>
    <span class="health-summary__item">{{ t('health.summary.unknown', { count: counts.unknown }) }}</span>
    <span v-if="counts.unsupported > 0" class="health-summary__item">
      {{ t('health.summary.unsupported', { count: counts.unsupported }) }}
    </span>
    <span v-if="counts.private > 0" class="health-summary__item">
      {{ t('health.summary.private', { count: counts.private }) }}
    </span>
    <span v-if="counts.unlisted > 0" class="health-summary__item">
      {{ t('health.summary.unlisted', { count: counts.unlisted }) }}
    </span>
    <span v-if="counts.ignored > 0" class="health-summary__item">
      {{ t('health.summary.ignored', { count: counts.ignored }) }}
    </span>
  </div>
</template>

<style scoped>
.health-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 14px;
  padding: 10px 12px;
  border: 1px solid var(--bh-color-border);
  border-radius: 10px;
  color: var(--bh-color-text-soft);
  background: #fcfcfa;
  font-size: 12px;
}

.health-summary__item strong {
  color: var(--bh-color-text);
  font-size: 13px;
  font-weight: 650;
}

.health-summary__item--ok {
  color: var(--bh-health-ok);
}

.health-summary__item--error {
  color: var(--bh-health-error);
}
</style>
