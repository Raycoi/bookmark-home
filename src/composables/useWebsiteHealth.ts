import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  type InjectionKey,
  type Ref,
} from 'vue';
import { HEALTH_STATE_STORAGE_KEY } from '../config/healthPolicy';
import type {
  HealthFilter,
  HealthRequest,
  HealthResponse,
  HealthSnapshot,
  WebsiteHealthRecord,
  WebsiteHealthStatus,
} from '../types/websiteHealth';
import type { HomepageData } from '../types/bookmark';
import {
  collectHomepageHealthEntries,
  type HealthBookmarkEntry,
} from '../utils/healthBookmarks';
import {
  healthStatusLabel,
  healthStatusTone,
  isAbnormalHealthStatus,
  isHealthyHealthStatus,
} from '../utils/healthStatus';
import { isPrivateHealthUrl, normalizeHealthUrl } from '../utils/healthUrl';
import { getErrorMessage } from '../utils/errors';

export interface HealthStatusView {
  rawUrl: string;
  normalizedUrl: string | null;
  status: WebsiteHealthStatus;
  label: string;
  tone: 'ok' | 'info' | 'warn' | 'error' | 'neutral';
  record: WebsiteHealthRecord | null;
  stale: boolean;
}

export interface HealthBookmarkView extends HealthStatusView {
  entry: HealthBookmarkEntry;
}

export interface HealthCounts {
  total: number;
  healthy: number;
  abnormal: number;
  pending: number;
  checking: number;
  unknown: number;
  unsupported: number;
  private: number;
  unlisted: number;
}

export interface HealthDetailState {
  rawUrl: string;
  x: number;
  y: number;
}

export interface UseWebsiteHealthOptions {
  homepage: Readonly<Ref<HomepageData | null>>;
}

const REFRESH_DEBOUNCE_MS = 160;

export type WebsiteHealthContext = ReturnType<typeof useWebsiteHealth>;

export const WEBSITE_HEALTH_KEY: InjectionKey<WebsiteHealthContext> =
  Symbol('website-health');

export function useWebsiteHealthContext(): WebsiteHealthContext | null {
  return inject(WEBSITE_HEALTH_KEY, null);
}

/**
 * 新标签页侧的健康检查只读状态。
 *
 * 挂载时仅请求缓存快照；不会入队、不会发网络请求。
 */
export function useWebsiteHealth(options: UseWebsiteHealthOptions) {
  const snapshot = shallowRef<HealthSnapshot | null>(null);
  const loaded = ref(false);
  const loading = ref(true);
  const error = ref<string | null>(null);
  const notice = ref<string | null>(null);
  const noticeTone = ref<'success' | 'error'>('success');
  const actionBusy = ref(false);
  const currentNow = ref(Date.now());
  const panelOpen = ref(false);
  const activeFilter = ref<HealthFilter>('all');
  const detail = ref<HealthDetailState | null>(null);

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotRequestId = 0;

  const entries = computed(() => collectHomepageHealthEntries(options.homepage.value));
  const checkingSet = computed(
    () => new Set(snapshot.value?.checkingUrls ?? []),
  );

  const views = computed<HealthBookmarkView[]>(() =>
    entries.value.map((entry) => {
      const view = buildView(entry.rawUrl, snapshot.value, checkingSet.value, currentNow.value);
      return { ...view, entry };
    }),
  );

  const counts = computed<HealthCounts>(() => {
    const result: HealthCounts = {
      total: views.value.length,
      healthy: 0,
      abnormal: 0,
      pending: 0,
      checking: 0,
      unknown: 0,
      unsupported: 0,
      private: 0,
      unlisted: 0,
    };

    for (const view of views.value) {
      if (isHealthyHealthStatus(view.status)) {
        result.healthy += 1;
      } else if (isAbnormalHealthStatus(view.status)) {
        result.abnormal += 1;
      } else if (view.status === 'pending') {
        result.pending += 1;
      } else if (view.status === 'checking') {
        result.checking += 1;
      } else if (view.status === 'unknown') {
        result.unknown += 1;
      } else if (view.status === 'private') {
        result.private += 1;
      } else {
        result.unsupported += 1;
      }

      if (!view.entry.isHomepageVisible) {
        result.unlisted += 1;
      }
    }

    return result;
  });

  const abnormalCount = computed(() => counts.value.abnormal);
  const scan = computed(() => snapshot.value?.scan ?? null);
  const scanRunning = computed(() => scan.value?.status === 'running');
  const progressPercent = computed(() => {
    const current = scan.value;
    if (!current || current.total === 0) {
      return 0;
    }
    return Math.min(100, Math.round((current.completed / current.total) * 100));
  });

  const filteredViews = computed(() => {
    const filtered = views.value.filter((view) => matchesFilter(view, activeFilter.value));
    return filtered.sort(compareViews);
  });

  const detailView = computed<HealthStatusView | null>(() => {
    if (!detail.value) {
      return null;
    }
    const entry = entries.value.find(
      (item) =>
        item.rawUrl === detail.value?.rawUrl ||
        item.normalizedUrl === normalizeHealthUrl(detail.value?.rawUrl),
    );
    return entry
      ? buildView(entry.rawUrl, snapshot.value, checkingSet.value, currentNow.value)
      : buildView(detail.value.rawUrl, snapshot.value, checkingSet.value, currentNow.value);
  });

  function viewForUrl(rawUrl: string): HealthStatusView | null {
    if (!loaded.value) {
      return null;
    }
    return buildView(rawUrl, snapshot.value, checkingSet.value, currentNow.value);
  }

  async function loadSnapshot(): Promise<void> {
    if (actionBusy.value) {
      return;
    }

    const requestId = ++snapshotRequestId;
    loading.value = true;
    currentNow.value = Date.now();
    const previousScan = snapshot.value?.scan ?? null;

    try {
      const response = await sendHealthMessage({ type: 'HEALTH_GET_SNAPSHOT' });
      if (requestId !== snapshotRequestId) {
        return;
      }
      if (!response.ok || !response.snapshot) {
        error.value = response.error ?? '读取健康检查缓存失败';
        return;
      }

      snapshot.value = response.snapshot;
      loaded.value = true;
      error.value = null;
      const nextScan = response.snapshot.scan;
      if (previousScan?.status === 'running' && nextScan?.status === 'completed') {
        noticeTone.value = 'success';
        notice.value = '检测完成';
      } else if (
        previousScan?.status === 'running' &&
        nextScan?.status === 'cancelled'
      ) {
        noticeTone.value = 'success';
        notice.value = '检测已取消';
      }
    } catch (caught) {
      if (requestId === snapshotRequestId) {
        error.value = `读取健康检查缓存失败：${getErrorMessage(caught)}`;
      }
    } finally {
      if (requestId === snapshotRequestId) {
        loading.value = false;
      }
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void loadSnapshot();
    }, REFRESH_DEBOUNCE_MS);
  }

  function onStorageChanged(
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void {
    if (areaName === 'local' && HEALTH_STATE_STORAGE_KEY in changes) {
      scheduleRefresh();
    }
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      scheduleRefresh();
    }
  }

  async function runAction(
    action: () => Promise<HealthResponse>,
    successNotice: string,
  ): Promise<void> {
    if (actionBusy.value) {
      return;
    }

    actionBusy.value = true;
    notice.value = null;
    currentNow.value = Date.now();
    const actionRequestId = ++snapshotRequestId;
    loading.value = false;

    try {
      const response = await action();
      if (actionRequestId !== snapshotRequestId) {
        return;
      }
      if (!response.ok) {
        noticeTone.value = 'error';
        notice.value = response.error ?? '健康检查操作失败';
        return;
      }

      if (response.snapshot) {
        snapshot.value = response.snapshot;
        loaded.value = true;
      }
      error.value = null;
      noticeTone.value = 'success';
      notice.value = response.notice ?? successNotice;
    } catch (caught) {
      if (actionRequestId === snapshotRequestId) {
        noticeTone.value = 'error';
        notice.value = `健康检查操作失败：${getErrorMessage(caught)}`;
      }
    } finally {
      actionBusy.value = false;
    }
  }

  function checkAll(): Promise<void> {
    return runAction(
      () => sendHealthMessage({ type: 'HEALTH_CHECK_ALL' }),
      '已加入全部书签检测队列',
    );
  }

  function checkAbnormal(): Promise<void> {
    return runAction(
      () => sendHealthMessage({ type: 'HEALTH_CHECK_ABNORMAL' }),
      '已加入异常网站检测队列',
    );
  }

  function recheck(rawUrl: string): Promise<void> {
    return runAction(
      () => sendHealthMessage({ type: 'HEALTH_RECHECK_URL', url: rawUrl }),
      '已加入重新检测队列',
    );
  }

  function cancelScan(): Promise<void> {
    return runAction(
      () => sendHealthMessage({ type: 'HEALTH_CANCEL_SCAN' }),
      '已取消尚未执行的检测任务',
    );
  }

  function openPanel(filter: HealthFilter = 'all'): void {
    activeFilter.value = filter;
    panelOpen.value = true;
    currentNow.value = Date.now();
  }

  function closePanel(): void {
    panelOpen.value = false;
  }

  function setFilter(filter: HealthFilter): void {
    activeFilter.value = filter;
  }

  function openDetail(rawUrl: string, x: number, y: number): void {
    currentNow.value = Date.now();
    notice.value = null;
    detail.value = { rawUrl, x, y };
  }

  function closeDetail(): void {
    detail.value = null;
  }

  function openPanelFromDetail(): void {
    if (!detail.value) {
      return;
    }
    detail.value = null;
    panelOpen.value = true;
    activeFilter.value = 'all';
    currentNow.value = Date.now();
  }

  onMounted(() => {
    void loadSnapshot();
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onStorageChanged);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  });

  onUnmounted(() => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  return {
    loaded,
    loading,
    error,
    notice,
    noticeTone,
    actionBusy,
    counts,
    abnormalCount,
    scan,
    scanRunning,
    progressPercent,
    filteredViews,
    activeFilter,
    panelOpen,
    detail,
    detailView,
    loadSnapshot,
    viewForUrl,
    checkAll,
    checkAbnormal,
    recheck,
    cancelScan,
    openPanel,
    closePanel,
    setFilter,
    openDetail,
    closeDetail,
    openPanelFromDetail,
  };
}

function buildView(
  rawUrl: string,
  snapshot: HealthSnapshot | null,
  checkingUrls: ReadonlySet<string>,
  now: number,
): HealthStatusView {
  const normalizedUrl = normalizeHealthUrl(rawUrl);
  if (!normalizedUrl) {
    return {
      rawUrl,
      normalizedUrl: null,
      status: 'unsupported',
      label: healthStatusLabel('unsupported'),
      tone: healthStatusTone('unsupported'),
      record: null,
      stale: false,
    };
  }

  const record = snapshot?.records[normalizedUrl] ?? null;
  let status: WebsiteHealthStatus;

  if (isPrivateHealthUrl(normalizedUrl)) {
    status = 'private';
  } else if (checkingUrls.has(normalizedUrl)) {
    status = 'checking';
  } else if (record) {
    status = record.status;
  } else {
    status = 'pending';
  }

  return {
    rawUrl,
    normalizedUrl,
    status,
    label: healthStatusLabel(status),
    tone: healthStatusTone(status),
    record: status === 'private' ? null : record,
    stale: status === 'private' ? false : record ? record.nextCheckAt <= now : false,
  };
}

function matchesFilter(view: HealthBookmarkView, filter: HealthFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'healthy':
      return isHealthyHealthStatus(view.status);
    case 'abnormal':
      return isAbnormalHealthStatus(view.status);
    case 'pending':
      return view.status === 'pending' || view.status === 'checking';
    case 'unknown':
      return view.status === 'unknown';
    case 'unsupported':
      return view.status === 'unsupported';
    case 'private':
      return view.status === 'private';
    case 'unlisted':
      return !view.entry.isHomepageVisible;
  }
}

function compareViews(left: HealthBookmarkView, right: HealthBookmarkView): number {
  return (
    statusSortWeight(left.status) - statusSortWeight(right.status) ||
    left.entry.title.localeCompare(right.entry.title, 'zh-CN')
  );
}

function statusSortWeight(status: WebsiteHealthStatus): number {
  switch (status) {
    case 'not_found':
    case 'gone':
    case 'restricted':
    case 'server_error':
      return 0;
    case 'unknown':
      return 1;
    case 'pending':
      return 2;
    case 'checking':
      return 3;
    case 'redirected':
    case 'healthy':
      return 4;
    case 'private':
      return 5;
    case 'unsupported':
      return 6;
  }
}

function sendHealthMessage(message: HealthRequest): Promise<HealthResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('当前环境无法连接扩展后台'));
      return;
    }

    chrome.runtime.sendMessage(
      message,
      (response: HealthResponse | undefined) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('扩展后台没有返回健康检查数据'));
          return;
        }
        resolve(response);
      },
    );
  });
}
