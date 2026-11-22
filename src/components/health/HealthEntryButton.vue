<script setup lang="ts">
import { useWebsiteHealthContext } from '../../composables/useWebsiteHealth';
import { useI18n } from '../../i18n';

const health = useWebsiteHealthContext();
if (!health) {
  throw new Error('HealthEntryButton 必须在 WebsiteHealth provider 内使用');
}

const { openPanel } = health;
const { t } = useI18n();
</script>

<template>
  <button
    class="action-button health-button"
    type="button"
    aria-haspopup="dialog"
    :aria-label="t('health.entry.aria')"
    :title="t('health.entry.title')"
    @click="openPanel()"
  >
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 3.5 15 5.5v4.2c0 3-2.1 5.6-5 6.6-2.9-1-5-3.6-5-6.6V5.5L10 3.5Z"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      <path
        d="M7.2 10h1.4l.9-1.8 1.1 3.2.8-1.4h1.4"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</template>

<style scoped>
.health-button {
  color: var(--bh-color-text-soft);
}
</style>
