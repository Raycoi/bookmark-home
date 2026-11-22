import { defineBackground } from 'wxt/utils/define-background';
import {
  HEALTH_ALARM_CLEANUP,
  HEALTH_ALARM_MAINTENANCE,
  HEALTH_ALARM_TICK,
  HEALTH_INITIAL_TIMEOUT_MS,
  HEALTH_TIMEOUT_MS,
} from '../src/config/healthPolicy';
import { bookmarkService } from '../src/services/bookmarkService';
import {
  ensureHealthAlarms,
  scheduleHealthCleanup,
  type HealthAlarmsApi,
} from '../src/services/healthAlarmService';
import { createHealthCacheService } from '../src/services/healthCacheService';
import { createHealthCheckScheduler } from '../src/services/healthCheckScheduler';
import { handleHealthRequest, isHealthRequest } from '../src/services/healthMessages';
import { checkWebsiteHealth } from '../src/services/websiteHealthService';
import { collectNativeBookmarkUrls } from '../src/utils/healthUrl';
import { getErrorMessage } from '../src/utils/errors';
import { initLanguage } from '../src/i18n';

/**
 * Manifest V3 后台入口。
 *
 * 新标签页打开时只通过消息读取快照；真正的网络检测、任务持久化和
 * 定时调度都在这里完成。Chrome Bookmarks 仍然是唯一书签数据源。
 */
export default defineBackground(() => {
  /**
   * Service Worker 里的 t() 需要用户语言。
   *
   * 初始化失败（存储不可读等）只回退到默认语言，绝不阻断后台任务。
   */
  const languageReady: Promise<void> = initLanguage().catch((error) => {
    console.warn('[Bookmark Home] 初始化语言失败', getErrorMessage(error));
  });

  const alarms = chrome.alarms as unknown as HealthAlarmsApi;
  const cache = createHealthCacheService();
  const scheduler = createHealthCheckScheduler({
    cache,
    checkUrl: (url, attempt) =>
      checkWebsiteHealth(url, {
        timeoutMs:
          attempt === 2 ? HEALTH_TIMEOUT_MS : HEALTH_INITIAL_TIMEOUT_MS,
        initialTimeoutMs:
          attempt === 2 ? HEALTH_TIMEOUT_MS : HEALTH_INITIAL_TIMEOUT_MS,
        maxRetries: 0,
      }),
    getReferencedUrls: async () => {
      const tree = await bookmarkService.getTree();
      return collectNativeBookmarkUrls(tree);
    },
  });

  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  let ready: Promise<void> | null = null;
  let healthKeepAliveTimer: ReturnType<typeof setInterval> | null = null;

  function stopHealthKeepAlive(): void {
    if (healthKeepAliveTimer) {
      clearInterval(healthKeepAliveTimer);
      healthKeepAliveTimer = null;
    }
  }

  async function tickHealthKeepAlive(): Promise<void> {
    try {
      chrome.runtime.getPlatformInfo?.(() => {
        void chrome.runtime.lastError;
      });
      const snapshot = await scheduler.getSnapshot();
      if (!snapshot.scan || snapshot.scan.status !== 'running') {
        stopHealthKeepAlive();
      }
    } catch {
      stopHealthKeepAlive();
    }
  }

  function startHealthKeepAlive(): void {
    if (healthKeepAliveTimer) {
      return;
    }
    void tickHealthKeepAlive();
    healthKeepAliveTimer = setInterval(() => {
      void tickHealthKeepAlive();
    }, 20_000);
  }

  async function initializeBackground(): Promise<void> {
    // 语言失败已在上游吞掉，这里不会阻塞健康检查初始化。
    await languageReady;
    await ensureHealthAlarms(alarms);
    await scheduler.initialize();
    if ((await scheduler.getSnapshot()).scan?.status === 'running') {
      startHealthKeepAlive();
    }
    console.info('[Bookmark Home] 健康检查后台已初始化');
  }

  function ensureReady(): Promise<void> {
    if (!ready) {
      ready = initializeBackground().catch((error) => {
        // 允许下一次事件重新尝试初始化，而不是让失败 Promise 永久缓存。
        ready = null;
        throw error;
      });
    }
    return ready;
  }

  function runSafely(action: string, task: () => Promise<void>): Promise<void> {
    return task().catch((error) => {
      console.warn(
        `[Bookmark Home] 健康检查${action}失败`,
        getErrorMessage(error),
      );
    });
  }

  function scheduleCleanupSoon(): void {
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
    }
    cleanupTimer = setTimeout(() => {
      cleanupTimer = null;
      runSafely('清理缓存', async () => {
        await ensureReady();
        await scheduler.cleanupOrphans();
      });
    }, 1_500);

    void scheduleHealthCleanup(alarms).catch((error) => {
      console.warn(
        '[Bookmark Home] 注册健康检查清理 alarm 失败',
        getErrorMessage(error),
      );
    });
  }

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      if (!isHealthRequest(message)) {
        return false;
      }

      void ensureReady()
        .then(async () => {
          const response = await handleHealthRequest(message, scheduler);
          if (
            (message.type === 'HEALTH_CHECK_ALL' ||
              message.type === 'HEALTH_CHECK_ABNORMAL') &&
            response.ok
          ) {
            startHealthKeepAlive();
          }
          if (message.type === 'HEALTH_CANCEL_SCAN') {
            stopHealthKeepAlive();
          }
          return response;
        })
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            ok: false,
            error: getErrorMessage(error),
          });
        });

      // 异步 sendResponse 需要保持消息通道。
      return true;
    },
  );

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEALTH_ALARM_TICK) {
      return runSafely('调度', async () => {
        await ensureReady();
        if ((await scheduler.getSnapshot()).scan?.status === 'running') {
          startHealthKeepAlive();
        }
        await scheduler.requestPass();
      });
    }

    if (alarm.name === HEALTH_ALARM_MAINTENANCE) {
      return runSafely('维护', async () => {
        await ensureReady();
        if ((await scheduler.getSnapshot()).scan?.status === 'running') {
          startHealthKeepAlive();
        }
        await scheduler.cleanupOrphans();
        await scheduler.refreshExpiredTasks();
        await scheduler.requestPass();
      });
    }

    if (alarm.name === HEALTH_ALARM_CLEANUP) {
      return runSafely('清理缓存', async () => {
        await ensureReady();
        await scheduler.cleanupOrphans();
      });
    }
  });

  function queueBookmark(rawUrl: string): void {
    void ensureReady()
      .then(() => scheduler.queueBookmarkUrl(rawUrl, 'bookmark_created'))
      .catch((error) => {
        console.warn(
          '[Bookmark Home] 新增/修改书签加入健康检查队列失败',
          getErrorMessage(error),
        );
      });
  }

  function queueImportedBookmarks(): void {
    void ensureReady()
      .then(async () => {
        const tree = await bookmarkService.getTree();
        const urls = collectNativeBookmarkUrls(tree);
        await scheduler.queueBookmarkUrls(urls, 'bookmark_created');
        console.info('[Bookmark Home] 导入书签已加入健康检查队列', urls.length);
      })
      .catch((error) => {
        console.warn(
          '[Bookmark Home] 导入书签加入健康检查队列失败',
          getErrorMessage(error),
        );
      });
  }

  chrome.bookmarks.onCreated.addListener((_id, node) => {
    if (node.url) {
      queueBookmark(node.url);
    }
  });

  chrome.bookmarks.onChanged.addListener((_id, changeInfo) => {
    if (changeInfo.url) {
      queueBookmark(changeInfo.url);
    }
    scheduleCleanupSoon();
  });

  chrome.bookmarks.onRemoved.addListener(() => {
    scheduleCleanupSoon();
  });

  chrome.bookmarks.onImportEnded.addListener(() => {
    console.info('[Bookmark Home] 收到书签导入完成事件');
    scheduleCleanupSoon();
    queueImportedBookmarks();
  });

  chrome.runtime.onInstalled.addListener(() => {
    void ensureReady().catch((error) => {
      console.warn(
        '[Bookmark Home] 健康检查后台初始化失败',
        getErrorMessage(error),
      );
    });
  });

  chrome.runtime.onStartup.addListener(() => {
    void ensureReady().catch((error) => {
      console.warn(
        '[Bookmark Home] 健康检查后台初始化失败',
        getErrorMessage(error),
      );
    });
  });

  void ensureReady().catch((error) => {
    console.warn(
      '[Bookmark Home] 健康检查后台初始化失败',
      getErrorMessage(error),
    );
  });
});
