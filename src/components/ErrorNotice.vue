<script setup lang="ts">
import { useI18n } from '../i18n';

withDefaults(
  defineProps<{
    message: string;
    tone?: 'error' | 'warning';
  }>(),
  {
    tone: 'error',
  },
);

defineEmits<{
  retry: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    class="error-notice"
    :class="{ 'error-notice--warning': tone === 'warning' }"
    role="alert"
  >
    <svg
      class="error-notice__icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M12 7.75v4.9M12 16.1v.15"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
    <p class="error-notice__message">{{ message }}</p>
    <button class="error-notice__retry" type="button" @click="$emit('retry')">
      {{ t('common.retry') }}
    </button>
  </div>
</template>

<style scoped>
.error-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
  padding: 11px 14px;
  border: 1px solid var(--bh-color-danger-border);
  border-radius: var(--bh-radius-md);
  color: var(--bh-color-danger);
  background: var(--bh-color-danger-soft);
}

.error-notice__icon {
  flex: 0 0 auto;
}

.error-notice__message {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 13px;
}

.error-notice__retry {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid rgba(184, 66, 66, 0.24);
  border-radius: 8px;
  color: var(--bh-color-danger);
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.error-notice__retry:hover {
  background: rgba(184, 66, 66, 0.06);
}

.error-notice__retry:focus-visible {
  outline: 2px solid var(--bh-color-danger);
  outline-offset: 2px;
}

.error-notice--warning {
  border-color: var(--bh-color-warning-border);
  color: var(--bh-color-warning);
  background: var(--bh-color-warning-soft);
}

.error-notice--warning .error-notice__retry {
  border-color: var(--bh-color-warning-border);
}

.error-notice--warning .error-notice__retry:hover {
  background: rgba(151, 111, 42, 0.06);
}

.error-notice--warning .error-notice__retry:focus-visible {
  outline-color: var(--bh-color-warning);
}
</style>
