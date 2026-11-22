import type { ToastState } from '../../types/management';

/** 操作反馈的附加选项；撤销动作依赖 actionLabel 与 action。 */
export interface NotifyOptions {
  actionLabel?: string;
  action?: () => void | Promise<void>;
  timeoutMs?: number;
}

/** 页面内操作反馈函数；子 composable 通过它复用统一的 toast 展示。 */
export type Notify = (
  tone: ToastState['tone'],
  message: string,
  options?: NotifyOptions,
) => void;
