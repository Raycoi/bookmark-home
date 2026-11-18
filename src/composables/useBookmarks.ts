import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { BookmarkTreeError, transformBookmarkTree } from '../adapters/bookmarkAdapter';
import {
  bookmarkService,
  type BookmarkTreeDataSource,
} from '../services/bookmarkService';
import type { HomepageData } from '../types/bookmark';
import { getErrorMessage } from '../utils/errors';

export interface UseBookmarksOptions {
  /** 允许测试注入数据源；生产环境默认为 Chrome Bookmarks 服务。 */
  dataSource?: BookmarkTreeDataSource;
  /** 是否自动绑定 Vue 生命周期；测试中关闭后手动调用 start/stop。 */
  autoStart?: boolean;
  /** 事件合并窗口，避免一次操作触发多个事件时重复读取整棵树。 */
  debounceMs?: number;
  now?: () => number;
}

const DEFAULT_DEBOUNCE_MS = 80;

/**
 * 书签同步状态。
 *
 * 设计要点：
 * - 任何书签事件都重新读取完整原生树，不维护页面侧增量数组；
 * - 用递增 requestToken 丢弃过期请求结果，避免慢请求覆盖新状态；
 * - 多个事件在短窗口内合并，降低连续操作时的 API 压力；
 * - Chrome 页面重新可见时主动补读，修复休眠期间可能错过的事件。
 */
export function useBookmarks(options: UseBookmarksOptions = {}) {
  const dataSource = options.dataSource ?? bookmarkService;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = options.now ?? Date.now;

  const data = shallowRef<HomepageData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const stale = ref(false);
  const lastUpdatedAt = ref<number | null>(null);

  let started = false;
  let requestToken = 0;
  let unsubscribe: (() => void) | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRefresh: { promise: Promise<void>; resolve: () => void } | null = null;
  let subscriptionError: string | null = null;

  function cancelScheduledRefresh(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (pendingRefresh) {
      pendingRefresh.resolve();
      pendingRefresh = null;
    }
  }

  async function refresh(): Promise<void> {
    if (!started) {
      return;
    }

    cancelScheduledRefresh();

    const token = ++requestToken;
    loading.value = true;

    try {
      const tree = await dataSource.getTree();
      if (!started || token !== requestToken) {
        return;
      }

      data.value = transformBookmarkTree(tree);
      // 读取成功不能掩盖订阅失败，否则页面会静默失去自动同步能力。
      error.value = subscriptionError;
      stale.value = false;
      lastUpdatedAt.value = now();
    } catch (caught) {
      if (!started || token !== requestToken) {
        return;
      }
      error.value = formatReadError(caught);
      // 仅保留当前内存中的上次成功数据，不写任何离线副本。
      stale.value = data.value !== null;
    } finally {
      if (started && token === requestToken) {
        loading.value = false;
      }
    }
  }

  /**
   * 合并书签事件与写操作后的刷新请求。
   *
   * 80ms 窗口内只读取一次完整树；没有事件时由同一窗口的定时器兜底。
   */
  function refreshSoon(): Promise<void> {
    if (!started) {
      return Promise.resolve();
    }

    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    if (!pendingRefresh) {
      let resolve!: () => void;
      const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
      });
      pendingRefresh = { promise, resolve };
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const pending = pendingRefresh;
      pendingRefresh = null;
      void refresh().then(() => pending?.resolve());
    }, debounceMs);

    return pendingRefresh.promise;
  }

  function scheduleRefresh(): void {
    if (!started) {
      return;
    }
    void refreshSoon();
  }

  function onVisibilityChange(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      scheduleRefresh();
    }
  }

  async function start(): Promise<void> {
    if (started) {
      return;
    }

    started = true;
    loading.value = true;
    subscriptionError = null;
    stale.value = false;

    try {
      unsubscribe = dataSource.subscribe(scheduleRefresh);
    } catch (caught) {
      subscriptionError = `监听书签变化失败：${getErrorMessage(caught)}`;
      error.value = subscriptionError;
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    await refresh();
  }

  function stop(): void {
    if (!started) {
      return;
    }

    started = false;
    requestToken += 1;
    cancelScheduledRefresh();

    unsubscribe?.();
    unsubscribe = null;

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }

    loading.value = false;
  }

  if (options.autoStart !== false) {
    onMounted(() => {
      void start();
    });
    onUnmounted(stop);
  }

  return {
    data,
    loading,
    error,
    stale,
    lastUpdatedAt,
    start,
    stop,
    refresh,
    refreshSoon,
    scheduleRefresh,
  };
}

function formatReadError(error: unknown): string {
  if (error instanceof BookmarkTreeError) {
    return error.message;
  }
  return `读取书签失败：${getErrorMessage(error)}`;
}
