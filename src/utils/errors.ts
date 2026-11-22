import { t } from '../i18n';

/** 将未知异常转换为可读文本。 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || error.name || t('common.unknownError');
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return t('common.unknownError');
}
