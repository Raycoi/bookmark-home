<script setup lang="ts">
import { ref } from 'vue';
import BaseDialog from '../BaseDialog.vue';
import HealthCheckProgress from './HealthCheckProgress.vue';
import HealthStatusFilter from './HealthStatusFilter.vue';
import {
  useWebsiteHealthContext,
  type HealthBookmarkView,
} from '../../composables/useWebsiteHealth';
import type { HealthBookmarkEntry } from '../../utils/healthBookmarks';
import { openBookmarkManagerAt } from '../../utils/bookmarkNavigation';
import { getErrorMessage } from '../../utils/errors';

const health = useWebsiteHealthContext();
if (!health) {
  throw new Error('HealthCheckPanel 必须在 WebsiteHealth provider 内使用');
}

const {
  loaded,
  loading,
  error,
  notice,
  noticeTone,
  actionBusy,
  counts,
  scan,
  scanRunning,
  progressPercent,
  filteredViews,
  activeFilter,
  setFilter,
  checkAll,
  checkAbnormal,
  cancelScan,
  recheck,
  closePanel,
  loadSnapshot,
} = health;

const locatingId = ref<string | null>(null);
const locateError = ref<string | null>(null);

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function canRecheck(view: HealthBookmarkView): boolean {
  return (
    Boolean(view.normalizedUrl) &&
    view.status !== 'checking' &&
    view.status !== 'private' &&
    view.status !== 'unsupported' &&
    !actionBusy.value
  );
}

async function runRecheck(view: HealthBookmarkView): Promise<void> {
  if (!canRecheck(view)) {
    return;
  }
  await recheck(view.rawUrl);
}

async function locateEntry(entry: HealthBookmarkEntry): Promise<void> {
  if (locatingId.value) {
    return;
  }

  locatingId.value = entry.bookmarkId;
  locateError.value = null;
  try {
    await openBookmarkManagerAt(entry.parentId);
  } catch (caught) {
    locateError.value = `无法定位到 Chrome 书签管理器：${getErrorMessage(caught)}`;
  } finally {
    locatingId.value = null;
  }
}
</script>

<template>
  <BaseDialog
    title="网站健康"
    description="仅在本机 Chrome 后台检测，结果保存在 chrome.storage.local，不修改原生书签。"
    wide
    :busy="actionBusy"
    @close="closePanel"
  >
    <div v-if="!loaded" class="health-empty">
      <p v-if="loading" class="health-empty__text">正在读取检测缓存…</p>
      <template v-else>
        <p class="health-empty__text">{{ error ?? '暂无健康检查数据' }}</p>
        <button class="bh-button bh-button--secondary" type="button" :disabled="loading || actionBusy" @click="loadSnapshot">
          重新读取
        </button>
      </template>
    </div>

    <template v-else>
      <p v-if="error" class="bh-dialog-error health-panel__error" role="alert">
        {{ error }}
        <button class="health-panel__retry" type="button" :disabled="loading || actionBusy" @click="loadSnapshot">重试</button>
      </p>

      <div class="health-summary" aria-label="健康检查统计">
        <span class="health-summary__item">共 <strong>{{ counts.total }}</strong> 个网址</span>
        <span class="health-summary__item health-summary__item--ok">正常 {{ counts.healthy }}</span>
        <span class="health-summary__item health-summary__item--error">异常 {{ counts.abnormal }}</span>
        <span class="health-summary__item">待检测 {{ counts.pending + counts.checking }}</span>
        <span class="health-summary__item">无法确认 {{ counts.unknown }}</span>
        <span v-if="counts.unsupported > 0" class="health-summary__item">
          无法检测 {{ counts.unsupported }}
        </span>
        <span v-if="counts.private > 0" class="health-summary__item">
          内网地址 {{ counts.private }}
        </span>
        <span v-if="counts.unlisted > 0" class="health-summary__item">
          未展示 {{ counts.unlisted }}
        </span>
      </div>

      <HealthCheckProgress
        v-if="scan && scanRunning"
        :scan="scan"
        :percent="progressPercent"
        :busy="actionBusy"
        @cancel="cancelScan"
      />

      <div class="health-actions">
        <button
          class="bh-button bh-button--primary"
          type="button"
          :disabled="scanRunning || actionBusy"
          @click="checkAll"
        >
          全部检测
        </button>
        <button
          class="bh-button bh-button--secondary"
          type="button"
          :disabled="scanRunning || actionBusy || counts.abnormal === 0"
          @click="checkAbnormal"
        >
          检测异常网站
        </button>
        <span v-if="scanRunning" class="health-actions__hint">后台每轮最多处理 10 个网址</span>
      </div>

      <p
        v-if="notice"
        class="health-notice"
        :class="`health-notice--${noticeTone}`"
        role="status"
      >
        {{ notice }}
      </p>

      <HealthStatusFilter
        :counts="counts"
        :active="activeFilter"
        @select="setFilter"
      />

      <div class="health-list-head">
        <span>网址状态</span>
        <span>{{ filteredViews.length }} 条</span>
      </div>

      <p v-if="locateError" class="health-notice health-notice--error" role="alert">
        {{ locateError }}
      </p>

      <ul v-if="filteredViews.length > 0" class="health-list">
        <li
          v-for="view in filteredViews"
          :key="view.entry.key"
          class="health-row"
          :class="`health-row--${view.tone}`"
        >
          <span class="health-row__dot" aria-hidden="true"></span>

          <div class="health-row__body">
            <div class="health-row__title-line">
              <strong class="health-row__title">{{ view.entry.title }}</strong>
              <span v-if="view.entry.bookmarkCount > 1" class="health-row__count">
                {{ view.entry.bookmarkCount }} 个书签
              </span>
              <span
                v-if="!view.entry.isHomepageVisible"
                class="health-row__unlisted"
                :title="`${view.entry.sectionTitle}中的书签，不显示在主页`"
              >
                {{ view.entry.sectionTitle }} · 未展示
              </span>
            </div>
            <p class="health-row__path">{{ view.entry.folderPath }}</p>
            <p class="health-row__url">{{ view.entry.normalizedUrl ?? view.entry.rawUrl }}</p>
            <div class="health-row__meta">
              <span class="health-row__status">{{ view.label }}</span>
              <span v-if="view.record?.httpStatus !== undefined">
                HTTP {{ view.record.httpStatus }}
              </span>
              <span v-if="view.record">{{ formatTime(view.record.checkedAt) }}</span>
              <span v-if="view.stale" class="health-row__stale">缓存已过期</span>
            </div>
            <p
              v-if="view.record?.errorMessage && view.status === 'unknown'"
              class="health-row__error"
            >
              {{ view.record.errorMessage }}
            </p>
          </div>

          <div class="health-row__actions">
            <button
              v-if="!view.entry.isHomepageVisible"
              class="health-row__locate"
              type="button"
              :disabled="locatingId === view.entry.bookmarkId"
              title="在 Chrome 书签管理器中定位"
              @click="locateEntry(view.entry)"
            >
              {{ locatingId === view.entry.bookmarkId ? '打开…' : '定位' }}
            </button>
            <button
              class="health-row__recheck"
              type="button"
              :disabled="!canRecheck(view)"
              @click="runRecheck(view)"
            >
              {{
                view.status === 'checking'
                  ? '检测中'
                  : view.status === 'private' || view.status === 'unsupported'
                    ? '不检测'
                    : view.record
                      ? '重新检测'
                      : '开始检测'
              }}
            </button>
          </div>
        </li>
      </ul>

      <p v-else class="health-empty__text health-empty__text--list">
        当前筛选下没有网址。
      </p>
    </template>

    <template #footer>
      <div class="bh-actions">
        <button
          class="bh-button bh-button--secondary"
          type="button"
          :disabled="actionBusy"
          @click="closePanel"
        >
          关闭
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped>
.health-panel__error {
  margin-bottom: 12px;
}

.health-panel__retry {
  margin-left: 6px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font-size: inherit;
  text-decoration: underline;
  cursor: pointer;
}

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

.health-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 14px 0 9px;
}

.health-actions__hint {
  color: var(--bh-color-text-faint);
  font-size: 11px;
}

.health-notice {
  margin: 0 0 12px;
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 11.5px;
  line-height: 1.4;
}

.health-notice--success {
  color: var(--bh-health-ok);
  background: var(--bh-health-ok-soft);
}

.health-notice--error {
  color: var(--bh-health-error);
  background: var(--bh-health-error-soft);
}

.health-list-head {
  display: flex;
  justify-content: space-between;
  margin: 6px 0 7px;
  color: var(--bh-color-text-faint);
  font-size: 11px;
}

.health-list {
  max-height: 360px;
  margin: 0;
  padding: 0;
  overflow: auto;
  border-top: 1px solid var(--bh-color-border);
  list-style: none;
}

.health-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 2px;
  border-bottom: 1px solid var(--bh-color-border);
}

.health-row:last-child {
  border-bottom: 0;
}

.health-row__dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--bh-health-neutral);
}

.health-row--ok .health-row__dot {
  background: var(--bh-health-ok);
}

.health-row--info .health-row__dot {
  background: var(--bh-health-info);
}

.health-row--warn .health-row__dot {
  background: var(--bh-health-warn);
}

.health-row--error .health-row__dot {
  background: var(--bh-health-error);
  box-shadow: 0 0 0 3px rgba(182, 74, 74, 0.1);
}

.health-row__body {
  flex: 1 1 auto;
  min-width: 0;
}

.health-row__title-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.health-row__title {
  overflow: hidden;
  color: var(--bh-color-text);
  font-size: 12.5px;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-row__count {
  flex: 0 0 auto;
  color: var(--bh-color-text-faint);
  font-size: 10.5px;
}

.health-row__unlisted {
  flex: 0 0 auto;
  max-width: 150px;
  overflow: hidden;
  padding: 1px 5px;
  border: 1px solid var(--bh-color-warning-border);
  border-radius: 4px;
  color: var(--bh-color-warning);
  background: var(--bh-color-warning-soft);
  font-size: 9.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-row__actions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-width: 54px;
}

.health-row__locate {
  padding: 3px 6px;
  border: 1px solid var(--bh-color-warning-border);
  border-radius: 6px;
  color: var(--bh-color-warning);
  background: var(--bh-color-warning-soft);
  font-size: 10.5px;
  cursor: pointer;
}

.health-row__locate:hover:not(:disabled) {
  background: #f7edda;
}

.health-row__locate:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.health-row__locate:disabled {
  cursor: default;
  opacity: 0.5;
}

.health-row__path,
.health-row__url {
  margin: 3px 0 0;
  overflow: hidden;
  color: var(--bh-color-text-faint);
  font-size: 10.5px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-row__url {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.health-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 9px;
  margin-top: 4px;
  color: var(--bh-color-text-faint);
  font-size: 10.5px;
}

.health-row__status {
  color: var(--bh-color-text-soft);
  font-weight: 560;
}

.health-row--ok .health-row__status {
  color: var(--bh-health-ok);
}

.health-row--warn .health-row__status {
  color: var(--bh-health-warn);
}

.health-row--error .health-row__status {
  color: var(--bh-health-error);
}

.health-row__stale {
  color: var(--bh-health-warn);
}

.health-row__error {
  margin: 4px 0 0;
  color: var(--bh-health-error);
  font-size: 10.5px;
  line-height: 1.4;
}

.health-row__recheck {
  flex: 0 0 auto;
  padding: 3px 6px;
  border: 1px solid var(--bh-color-border-strong);
  border-radius: 6px;
  color: var(--bh-color-text-soft);
  background: var(--bh-color-surface);
  font-size: 10.5px;
  cursor: pointer;
}

.health-row__recheck:hover:not(:disabled) {
  color: var(--bh-color-text);
  background: #f7f7f5;
}

.health-row__recheck:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.health-row__recheck:disabled {
  cursor: default;
  opacity: 0.46;
}

.health-empty {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 42px 0;
}

.health-empty__text {
  margin: 0;
  color: var(--bh-color-text-faint);
  font-size: 12.5px;
  line-height: 1.5;
}

.health-empty__text--list {
  padding: 28px 0;
  text-align: center;
}
</style>
