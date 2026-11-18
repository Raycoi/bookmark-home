import {
  HEALTH_ALARM_CLEANUP,
  HEALTH_ALARM_MAINTENANCE,
  HEALTH_ALARM_TICK,
  HEALTH_CLEANUP_DELAY_MINUTES,
  HEALTH_MAINTENANCE_PERIOD_MINUTES,
  HEALTH_TICK_PERIOD_MINUTES,
} from '../config/healthPolicy';

export interface HealthAlarmsApi {
  get(name: string): Promise<{ name: string } | undefined>;
  create(name: string, info: chrome.alarms.AlarmCreateInfo): Promise<void>;
}

export interface EnsureAlarmResult {
  created: string[];
}

/** 重新注册周期 alarms；已存在则保留，避免 Service Worker 重启后调度丢失。 */
export async function ensureHealthAlarms(
  alarms: HealthAlarmsApi,
): Promise<EnsureAlarmResult> {
  const created: string[] = [];

  if (!(await alarms.get(HEALTH_ALARM_TICK))) {
    await alarms.create(HEALTH_ALARM_TICK, {
      delayInMinutes: 1,
      periodInMinutes: HEALTH_TICK_PERIOD_MINUTES,
    });
    created.push(HEALTH_ALARM_TICK);
  }

  if (!(await alarms.get(HEALTH_ALARM_MAINTENANCE))) {
    await alarms.create(HEALTH_ALARM_MAINTENANCE, {
      delayInMinutes: 1,
      periodInMinutes: HEALTH_MAINTENANCE_PERIOD_MINUTES,
    });
    created.push(HEALTH_ALARM_MAINTENANCE);
  }

  return { created };
}

/** 书签删除/URL 修改后的短延迟清理；一次性 alarm 由浏览器自动移除。 */
export async function scheduleHealthCleanup(
  alarms: HealthAlarmsApi,
): Promise<void> {
  await alarms.create(HEALTH_ALARM_CLEANUP, {
    delayInMinutes: HEALTH_CLEANUP_DELAY_MINUTES,
  });
}
