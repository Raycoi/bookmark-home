<script setup lang="ts">
import type { ToastState } from '../types/management';

defineProps<{
  toast: ToastState;
}>();

defineEmits<{
  close: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      class="operation-toast"
      :class="`operation-toast--${toast.tone}`"
      :role="toast.tone === 'error' ? 'alert' : 'status'"
    >
      <span class="operation-toast__icon" aria-hidden="true">
        <svg
          v-if="toast.tone === 'success'"
          width="15"
          height="15"
          viewBox="0 0 20 20"
          fill="none"
        >
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5" />
          <path
            d="m6.8 10.1 2.1 2.1 4.4-4.5"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg v-else width="15" height="15" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5" />
          <path
            d="M10 6v4.6M10 13.7v.1"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </span>
      <span class="operation-toast__message">{{ toast.message }}</span>
      <button class="operation-toast__close" type="button" aria-label="关闭提示" @click="$emit('close')">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="m4 4 8 8m0-8-8 8"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.operation-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 80;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(calc(100vw - 48px), 460px);
  padding: 9px 10px 9px 13px;
  border: 1px solid var(--bh-color-border);
  border-radius: 14px;
  color: var(--bh-color-text-soft);
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 12px 36px -18px rgba(24, 28, 36, 0.34),
    0 1px 3px rgba(24, 28, 36, 0.06);
  font-size: 12.5px;
  transform: translateX(-50%);
  animation: toast-in var(--bh-duration-normal) var(--bh-ease-out);
}

.operation-toast__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
}

.operation-toast--success .operation-toast__icon {
  color: #2e7d5b;
}

.operation-toast--error .operation-toast__icon {
  color: var(--bh-color-danger);
}

.operation-toast__message {
  overflow: hidden;
  overflow-wrap: anywhere;
  text-align: left;
}

.operation-toast__close {
  display: grid;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--bh-color-text-faint);
  background: transparent;
  cursor: pointer;
}

.operation-toast__close:hover {
  color: var(--bh-color-text);
  background: rgba(35, 40, 50, 0.06);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 6px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@media (max-width: 560px) {
  .operation-toast {
    bottom: 68px;
  }
}
</style>
