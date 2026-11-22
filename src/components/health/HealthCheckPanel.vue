<script setup lang="ts">
import { ref } from 'vue';
import BaseDialog from '../BaseDialog.vue';
import HealthCheckProgress from './HealthCheckProgress.vue';
import HealthStatusFilter from './HealthStatusFilter.vue';
import HealthSummary from './HealthSummary.vue';
import HealthRow from './HealthRow.vue';
import HealthIgnoredList from './HealthIgnoredList.vue';
import { useBookmarkManagerContext } from '../../composables/useBookmarkManager';
import {
  useWebsiteHealthContext,
  type HealthBookmarkView,
} from '../../composables/useWebsiteHealth';
import type { HealthBookmarkEntry } from '../../utils/healthBookmarks';
import { findHomepageBookmark } from '../../utils/folders';
import { openBookmarkManagerAt } from '../../utils/bookmarkNavigation';
import { getErrorMessage } from '../../utils/errors';
import { useI18n } from '../../i18n';

const health = useWebsiteHealthContext();
if (!health) {
  throw new Error('HealthCheckPanel 必须在 WebsiteHealth provider 内使用');
}

const manager = useBookmarkManagerContext();
const { t } = useI18n();

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
  retryCount,
  progressPercent,
  filteredViews,
  ignoredEntries,
  activeFilter,
  setFilter,
  checkAll,
  checkAbnormal,
  cancelScan,
  recheck,
  ignore,
  unignore,
  closePanel,
  loadSnapshot,
} = health;

const locatingId = ref<string | null>(null);
const locateError = ref<string | null>(null);

async function runRecheck(view: HealthBookmarkView): Promise<void> {
  await recheck(view.rawUrl);
}

async function ignoreEntry(view: HealthBookmarkView): Promise<void> {
  await ignore(view.rawUrl);
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
    locateError.value = t('health.locateFailed', { message: getErrorMessage(caught) });
  } finally {
    locatingId.value = null;
  }
}

function bookmarkFor(entry: HealthBookmarkEntry) {
  return findHomepageBookmark(manager?.homepage.value ?? null, entry.bookmarkId);
}

function editEntry(entry: HealthBookmarkEntry): void {
  const bookmark = bookmarkFor(entry);
  if (!bookmark || !manager) {
    return;
  }
  closePanel();
  manager.openEditBookmark(bookmark);
}

function deleteEntry(entry: HealthBookmarkEntry): void {
  const bookmark = bookmarkFor(entry);
  if (!bookmark || !manager) {
    return;
  }
  closePanel();
  manager.askDeleteBookmark(bookmark);
}
</script>

<template>
  <BaseDialog
    :title="t('health.title')"
    :description="t('health.description')"
    wide
    :busy="actionBusy"
    @close="closePanel"
  >
    <div v-if="!loaded" class="health-empty">
      <p v-if="loading" class="health-empty__text">{{ t('health.loadingCache') }}</p>
      <template v-else>
        <p class="health-empty__text">{{ error ?? t('health.noData') }}</p>
        <button class="bh-button bh-button--secondary" type="button" :disabled="loading || actionBusy" @click="loadSnapshot">
          {{ t('health.reload') }}
        </button>
      </template>
    </div>

    <template v-else>
      <p v-if="error" class="bh-dialog-error health-panel__error" role="alert">
        {{ error }}
        <button class="health-panel__retry" type="button" :disabled="loading || actionBusy" @click="loadSnapshot">
          {{ t('common.retry') }}
        </button>
      </p>

      <HealthSummary :counts="counts" />

      <HealthCheckProgress
        v-if="scan && scanRunning"
        :scan="scan"
        :percent="progressPercent"
        :retry-count="retryCount"
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
          {{ t('health.checkAll') }}
        </button>
        <button
          v-if="counts.abnormal > 0"
          class="bh-button bh-button--secondary"
          type="button"
          :disabled="scanRunning || actionBusy"
          @click="checkAbnormal"
        >
          {{ t('health.checkAbnormal') }}
        </button>
        <span v-if="scanRunning" class="health-actions__hint">{{ t('health.scanHint') }}</span>
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
        <span>{{ t('health.listHead.status') }}</span>
        <span>{{ t('health.listHead.count', { count: filteredViews.length }) }}</span>
      </div>

      <p v-if="locateError" class="health-notice health-notice--error" role="alert">
        {{ locateError }}
      </p>

      <ul v-if="filteredViews.length > 0" class="health-list">
        <HealthRow
          v-for="view in filteredViews"
          :key="view.entry.key"
          :view="view"
          :locating="locatingId === view.entry.bookmarkId"
          :manageable="Boolean(manager && bookmarkFor(view.entry))"
          :busy="actionBusy"
          :scan-running="scanRunning"
          @recheck="runRecheck(view)"
          @ignore="ignoreEntry(view)"
          @locate="locateEntry(view.entry)"
          @edit="editEntry(view.entry)"
          @delete="deleteEntry(view.entry)"
        />
      </ul>

      <p v-else class="health-empty__text health-empty__text--list">
        {{ t('health.emptyFiltered') }}
      </p>

      <HealthIgnoredList
        v-if="ignoredEntries.length > 0"
        :entries="ignoredEntries"
        :disabled="actionBusy || scanRunning"
        @restore="unignore"
      />
    </template>

    <template #footer>
      <div class="bh-actions">
        <button
          class="bh-button bh-button--secondary"
          type="button"
          :disabled="actionBusy"
          @click="closePanel"
        >
          {{ t('common.close') }}
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
