import type {
  HealthRequest,
  HealthResponse,
  HealthSnapshot,
} from '../types/websiteHealth';
import type { HealthCheckScheduler } from './healthCheckScheduler';

export interface HealthMessageScheduler {
  startScan: HealthCheckScheduler['startScan'];
  cancelScan: HealthCheckScheduler['cancelScan'];
  recheck: HealthCheckScheduler['recheck'];
  getSnapshot: HealthCheckScheduler['getSnapshot'];
}

/** 类型守卫：只处理健康检查消息，不拦截其他扩展消息。 */
export function isHealthRequest(value: unknown): value is HealthRequest {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const type = (value as { type?: unknown }).type;
  return (
    type === 'HEALTH_GET_SNAPSHOT' ||
    type === 'HEALTH_CHECK_ALL' ||
    type === 'HEALTH_CHECK_ABNORMAL' ||
    type === 'HEALTH_RECHECK_URL' ||
    type === 'HEALTH_CANCEL_SCAN'
  );
}

/**
 * 处理新标签页发来的健康检查消息。
 *
 * `HEALTH_GET_SNAPSHOT` 只读缓存，绝不入队或发起网络检测。
 */
export async function handleHealthRequest(
  message: HealthRequest,
  scheduler: HealthMessageScheduler,
): Promise<HealthResponse> {
  try {
    switch (message.type) {
      case 'HEALTH_GET_SNAPSHOT':
        return snapshotResponse(await scheduler.getSnapshot());

      case 'HEALTH_CHECK_ALL':
      case 'HEALTH_CHECK_ABNORMAL': {
        const mode = message.type === 'HEALTH_CHECK_ALL' ? 'all' : 'abnormal';
        const result = await scheduler.startScan(mode);
        const snapshot = await scheduler.getSnapshot();
        return {
          ok: true,
          snapshot,
          ...(result.notice ? { notice: result.notice } : {}),
        };
      }

      case 'HEALTH_RECHECK_URL': {
        if (typeof message.url !== 'string' || message.url.trim().length === 0) {
          return { ok: false, error: '缺少要检测的 URL' };
        }
        const accepted = await scheduler.recheck(message.url);
        if (!accepted) {
          return { ok: false, error: '该 URL 不支持检测' };
        }
        return snapshotResponse(await scheduler.getSnapshot());
      }

      case 'HEALTH_CANCEL_SCAN':
        return snapshotResponse(await scheduler.cancelScan());
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '健康检查请求失败',
    };
  }
}

function snapshotResponse(snapshot: HealthSnapshot): HealthResponse {
  return { ok: true, snapshot };
}
