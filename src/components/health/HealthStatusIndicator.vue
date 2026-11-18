<script setup lang="ts">
import { computed } from 'vue';
import { useWebsiteHealthContext } from '../../composables/useWebsiteHealth';

const props = defineProps<{
  rawUrl: string;
  variant: 'vertical' | 'horizontal';
}>();

const health = useWebsiteHealthContext();
const view = computed(() => health?.viewForUrl(props.rawUrl) ?? null);

const tooltip = computed(() => {
  if (!view.value) {
    return '';
  }
  const stale = view.value.stale ? '（缓存已过期）' : '';
  return `${view.value.label}${stale}\n点击查看详情`;
});

function openDetails(event: MouseEvent): void {
  if (!health) {
    return;
  }
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const rect = target.getBoundingClientRect();
  health.openDetail(props.rawUrl, rect.left, rect.bottom + 6);
}
</script>

<template>
  <button
    v-if="view"
    class="health-indicator"
    :class="[
      `health-indicator--${variant}`,
      `health-indicator--tone-${view.tone}`,
      `health-indicator--status-${view.status}`,
      { 'is-stale': view.stale, 'is-checking': view.status === 'checking' },
    ]"
    type="button"
    :aria-label="`网站状态：${view.label}，${view.stale ? '缓存已过期，' : ''}点击查看详情`"
    :title="tooltip"
    @click.stop="openDetails"
    @contextmenu.prevent.stop="openDetails"
    @dragstart.prevent.stop
  >
    <span class="health-indicator__dot" aria-hidden="true"></span>
  </button>
</template>

<style scoped>
.health-indicator {
  position: absolute;
  z-index: 5;
  display: grid;
  width: 18px;
  height: 18px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  opacity: 0.46;
  cursor: pointer;
  transition:
    opacity var(--bh-duration-fast) ease,
    background-color var(--bh-duration-fast) ease;
}

.health-indicator--vertical {
  top: 5px;
  left: 5px;
}

.health-indicator--horizontal {
  top: 5px;
  right: 30px;
}

.health-indicator:hover,
.health-indicator:focus-visible {
  opacity: 1;
}

.health-indicator:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.health-indicator__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bh-health-neutral);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.86);
}

.health-indicator--tone-ok {
  opacity: 0.58;
}

.health-indicator--tone-ok .health-indicator__dot {
  background: var(--bh-health-ok);
}

.health-indicator--tone-info .health-indicator__dot {
  background: var(--bh-health-info);
}

.health-indicator--tone-warn {
  opacity: 0.9;
}

.health-indicator--tone-warn .health-indicator__dot {
  background: var(--bh-health-warn);
}

.health-indicator--tone-error {
  opacity: 1;
}

.health-indicator--tone-error .health-indicator__dot {
  width: 7px;
  height: 7px;
  background: var(--bh-health-error);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.95),
    0 0 0 3px rgba(182, 74, 74, 0.14);
}

.health-indicator--tone-neutral .health-indicator__dot {
  background: var(--bh-health-neutral);
}

.health-indicator.is-stale .health-indicator__dot {
  opacity: 0.62;
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.95),
    0 0 0 3px rgba(154, 157, 164, 0.2);
}

.health-indicator.is-checking .health-indicator__dot {
  animation: health-pulse 1.5s ease-in-out infinite;
}

@keyframes health-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .health-indicator.is-checking .health-indicator__dot {
    animation: none;
  }
}

@media (hover: none) {
  .health-indicator {
    opacity: 0.82;
  }
}
</style>
