<script setup lang="ts">
import { useI18n } from '../../i18n';
import type { HealthScanState } from '../../types/websiteHealth';

defineProps<{
  scan: HealthScanState;
  percent: number;
  retryCount: number;
  busy: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
}>();

const { t } = useI18n();
</script>

<template>
  <section class="health-progress" :aria-label="t('health.progress.aria')">
    <div class="health-progress__head">
      <span class="health-progress__label">
        {{ t('health.progress.labelPrefix') }}<strong>{{ scan.completed }}</strong> / {{ scan.total }}
        <span v-if="retryCount > 0" class="health-progress__retry">
          {{ t('health.progress.retry', { count: retryCount }) }}
        </span>
      </span>
      <button
        class="health-progress__cancel"
        type="button"
        :disabled="busy"
        @click="emit('cancel')"
      >
        {{ busy ? t('health.progress.cancelling') : t('health.progress.cancel') }}
      </button>
    </div>
    <div
      class="health-progress__track"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
      :aria-label="t('health.progress.percentAria', { percent })"
    >
      <span class="health-progress__bar" :style="{ width: `${percent}%` }"></span>
    </div>
  </section>
</template>

<style scoped>
.health-progress {
  margin: 4px 0 14px;
  padding: 11px 12px;
  border: 1px solid var(--bh-health-info-soft);
  border-radius: 11px;
  background: var(--bh-health-info-soft);
}

.health-progress__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.health-progress__label {
  color: var(--bh-color-text-soft);
  font-size: 12px;
}

.health-progress__label strong {
  color: var(--bh-health-info);
  font-weight: 650;
}

.health-progress__retry {
  margin-left: 7px;
  color: var(--bh-health-warn);
  font-size: 11px;
}

.health-progress__cancel {
  padding: 2px 6px;
  border: 0;
  border-radius: 5px;
  color: var(--bh-health-info);
  background: transparent;
  font-size: 11.5px;
  cursor: pointer;
}

.health-progress__cancel:hover:not(:disabled) {
  background: rgba(82, 119, 184, 0.1);
}

.health-progress__cancel:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.health-progress__cancel:disabled {
  cursor: default;
  opacity: 0.5;
}

.health-progress__track {
  height: 5px;
  margin-top: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(82, 119, 184, 0.13);
}

.health-progress__bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--bh-health-info);
  transition: width var(--bh-duration-normal) var(--bh-ease-out);
}
</style>
