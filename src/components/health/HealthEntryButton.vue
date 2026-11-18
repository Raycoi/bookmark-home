<script setup lang="ts">
import { useWebsiteHealthContext } from '../../composables/useWebsiteHealth';

const health = useWebsiteHealthContext();
if (!health) {
  throw new Error('HealthEntryButton 必须在 WebsiteHealth provider 内使用');
}

const { abnormalCount, scanRunning, openPanel } = health;
</script>

<template>
  <button
    class="health-entry"
    type="button"
    aria-haspopup="dialog"
    aria-label="打开网站健康检查"
    title="网站健康检查"
    @click="openPanel('all')"
  >
    <span class="health-entry__icon" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
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
    </span>
    <span class="health-entry__label">网站健康</span>
    <span
      v-if="abnormalCount > 0"
      class="health-entry__alert"
      :aria-label="`${abnormalCount} 个异常网站`"
    ></span>
    <span
      v-else-if="scanRunning"
      class="health-entry__pulse"
      aria-hidden="true"
    ></span>
  </button>
</template>

<style scoped>
.health-entry {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 12px 0 10px;
  border: 1px solid var(--bh-color-border-strong);
  border-radius: 999px;
  color: var(--bh-color-text-soft);
  background: rgba(255, 255, 255, 0.9);
  box-shadow:
    0 1px 2px rgba(30, 35, 45, 0.05),
    0 8px 24px -16px rgba(30, 35, 45, 0.42);
  cursor: pointer;
  transition:
    color var(--bh-duration-fast) ease,
    border-color var(--bh-duration-fast) ease,
    background-color var(--bh-duration-fast) ease;
}

.health-entry:hover {
  border-color: var(--bh-color-accent-border);
  color: var(--bh-color-accent);
  background: var(--bh-color-surface);
}

.health-entry:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 2px;
}

.health-entry__icon {
  display: grid;
  place-items: center;
}

.health-entry__label {
  font-size: 12px;
  font-weight: 560;
  letter-spacing: 0.01em;
}

.health-entry__alert {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bh-health-error);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
}

.health-entry__pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bh-health-info);
  animation: entry-pulse 1.5s ease-in-out infinite;
}

@keyframes entry-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .health-entry__pulse {
    animation: none;
  }
}

@media (max-width: 560px) {
  .health-entry {
    left: 16px;
    bottom: 16px;
  }
}
</style>
