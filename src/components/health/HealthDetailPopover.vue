<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useWebsiteHealthContext } from '../../composables/useWebsiteHealth';

const health = useWebsiteHealthContext();
if (!health) {
  throw new Error('HealthDetailPopover 必须在 WebsiteHealth provider 内使用');
}

const {
  detail,
  detailView,
  notice,
  noticeTone,
  actionBusy,
  recheck,
  closeDetail,
  openPanelFromDetail,
} = health;

const panelRef = ref<HTMLElement | null>(null);
const left = ref(detail.value?.x ?? 16);
const top = ref(detail.value?.y ?? 16);
let previouslyFocused: HTMLElement | null = null;

const view = detailView;
const record = computed(() => view.value?.record ?? null);
const canRecheck = computed(
  () =>
    Boolean(view.value?.normalizedUrl) &&
    view.value?.status !== 'checking' &&
    view.value?.status !== 'private' &&
    view.value?.status !== 'unsupported' &&
    !actionBusy.value,
);
const showFinalUrl = computed(
  () =>
    Boolean(record.value?.finalUrl) &&
    record.value?.finalUrl !== view.value?.normalizedUrl,
);

function updatePosition(): void {
  const panel = panelRef.value;
  const point = detail.value;
  if (!panel || !point) {
    return;
  }

  const rect = panel.getBoundingClientRect();
  const margin = 8;
  left.value = Math.min(
    Math.max(margin, point.x),
    Math.max(margin, window.innerWidth - rect.width - margin),
  );
  top.value = Math.min(
    Math.max(margin, point.y),
    Math.max(margin, window.innerHeight - rect.height - margin),
  );
}

function focusPanel(): void {
  void nextTick(() => {
    updatePosition();
    panelRef.value?.focus();
  });
}

function onPointerDown(event: PointerEvent): void {
  if (
    panelRef.value &&
    event.target instanceof Node &&
    !panelRef.value.contains(event.target)
  ) {
    closeDetail();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeDetail();
  }
}

function onScroll(event: Event): void {
  if (
    panelRef.value &&
    event.target instanceof Node &&
    panelRef.value.contains(event.target)
  ) {
    return;
  }
  closeDetail();
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

async function runRecheck(): Promise<void> {
  if (!view.value || !canRecheck.value) {
    return;
  }
  await recheck(view.value.rawUrl);
}

onMounted(() => {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', onScroll, true);
  focusPanel();
});

watch(detail, focusPanel);

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', onScroll, true);
  if (previouslyFocused?.isConnected) {
    previouslyFocused.focus();
  }
});
</script>

<template>
  <Teleport to="body">
    <aside
      ref="panelRef"
      class="health-detail"
      :class="`health-detail--${view?.tone ?? 'neutral'}`"
      role="dialog"
      aria-modal="false"
      aria-label="网站健康详情"
      tabindex="-1"
      :style="{ left: `${left}px`, top: `${top}px` }"
    >
      <header class="health-detail__head">
        <span class="health-detail__status">
          <span class="health-detail__dot" aria-hidden="true"></span>
          {{ view?.label ?? '待检测' }}
        </span>
        <button
          class="health-detail__close"
          type="button"
          aria-label="关闭健康详情"
          @click="closeDetail"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="m4 4 8 8m0-8-8 8"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </header>

      <p class="health-detail__url">{{ view?.rawUrl }}</p>

      <p v-if="view?.stale" class="health-detail__stale">
        缓存已过期，后台会在稍后重新检测。
      </p>

      <dl v-if="record" class="health-detail__facts">
        <div v-if="record.httpStatus !== undefined">
          <dt>HTTP 状态</dt>
          <dd>{{ record.httpStatus }}</dd>
        </div>
        <div>
          <dt>检测方式</dt>
          <dd>{{ record.method }}</dd>
        </div>
        <div v-if="record.responseTime !== undefined">
          <dt>响应时间</dt>
          <dd>{{ record.responseTime }} ms</dd>
        </div>
        <div>
          <dt>检测时间</dt>
          <dd>{{ formatDateTime(record.checkedAt) }}</dd>
        </div>
        <div v-if="showFinalUrl" class="health-detail__wide">
          <dt>最终地址</dt>
          <dd class="health-detail__final">{{ record.finalUrl }}</dd>
        </div>
      </dl>

      <p v-if="record?.errorMessage" class="health-detail__error">
        {{ record.errorMessage }}
      </p>

      <p v-else-if="view?.status === 'pending'" class="health-detail__hint">
        尚未检测。可以单独重新检测，或打开健康面板执行全部检测。
      </p>
      <p v-else-if="view?.status === 'checking'" class="health-detail__hint">
        正在后台检测，结果会自动更新。
      </p>
      <p v-else-if="view?.status === 'unsupported'" class="health-detail__hint">
        仅 HTTP/HTTPS 地址参与网络检测。
      </p>
      <p v-else-if="view?.status === 'private'" class="health-detail__hint">
        出于安全考虑，内网/本机地址不参与健康检查。
      </p>

      <p
        v-if="notice"
        class="health-detail__notice"
        :class="`health-detail__notice--${noticeTone}`"
        role="status"
      >
        {{ notice }}
      </p>

      <footer class="health-detail__actions">
        <button
          class="bh-button bh-button--primary health-detail__button"
          type="button"
          :disabled="!canRecheck"
          @click="runRecheck"
        >
          {{
            view?.status === 'checking'
              ? '检测中…'
              : view?.status === 'private' || view?.status === 'unsupported'
                ? '不检测'
                : '重新检测'
          }}
        </button>
        <button
          class="bh-button bh-button--secondary health-detail__button"
          type="button"
          @click="openPanelFromDetail"
        >
          查看全部
        </button>
      </footer>
    </aside>
  </Teleport>
</template>

<style scoped>
.health-detail {
  position: fixed;
  z-index: 66;
  width: min(320px, calc(100vw - 16px));
  max-height: min(520px, calc(100vh - 16px));
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--bh-color-border);
  border-radius: 14px;
  outline: 0;
  background: var(--bh-color-surface);
  box-shadow:
    0 20px 52px -24px rgba(24, 28, 36, 0.36),
    0 2px 8px rgba(24, 28, 36, 0.06);
  animation: health-detail-in var(--bh-duration-fast) var(--bh-ease-out);
}

.health-detail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.health-detail__status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--bh-color-text);
  font-size: 13px;
  font-weight: 620;
}

.health-detail__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--bh-health-neutral);
}

.health-detail--ok .health-detail__dot {
  background: var(--bh-health-ok);
}

.health-detail--info .health-detail__dot {
  background: var(--bh-health-info);
}

.health-detail--warn .health-detail__dot {
  background: var(--bh-health-warn);
}

.health-detail--error .health-detail__dot {
  background: var(--bh-health-error);
}

.health-detail__close {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  color: var(--bh-color-text-faint);
  background: transparent;
  cursor: pointer;
}

.health-detail__close:hover {
  color: var(--bh-color-text);
  background: rgba(35, 40, 50, 0.05);
}

.health-detail__close:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.health-detail__url {
  margin: 9px 0 0;
  overflow-wrap: anywhere;
  color: var(--bh-color-text-soft);
  font-size: 11.5px;
  line-height: 1.45;
}

.health-detail__stale {
  margin: 9px 0 0;
  padding: 7px 9px;
  border-radius: 8px;
  color: var(--bh-health-warn);
  background: var(--bh-health-warn-soft);
  font-size: 11.5px;
  line-height: 1.4;
}

.health-detail__facts {
  display: grid;
  gap: 6px;
  margin: 11px 0 0;
}

.health-detail__facts div {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 8px;
}

.health-detail__facts dt {
  color: var(--bh-color-text-faint);
  font-size: 11.5px;
}

.health-detail__facts dd {
  margin: 0;
  color: var(--bh-color-text-soft);
  font-size: 11.5px;
}

.health-detail__facts .health-detail__wide {
  grid-template-columns: 1fr;
  gap: 2px;
}

.health-detail__final {
  overflow-wrap: anywhere;
}

.health-detail__error {
  margin: 11px 0 0;
  padding: 8px 9px;
  border-radius: 8px;
  color: var(--bh-health-error);
  background: var(--bh-health-error-soft);
  font-size: 11.5px;
  line-height: 1.45;
}

.health-detail__hint {
  margin: 11px 0 0;
  color: var(--bh-color-text-faint);
  font-size: 11.5px;
  line-height: 1.45;
}

.health-detail__notice {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 1.4;
}

.health-detail__notice--success {
  color: var(--bh-health-ok);
}

.health-detail__notice--error {
  color: var(--bh-health-error);
}

.health-detail__actions {
  display: flex;
  gap: 7px;
  margin-top: 12px;
}

.health-detail__button {
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
}

@keyframes health-detail-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
