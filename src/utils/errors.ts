/** 将未知异常转换为可读文本。 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || error.name || '未知错误';
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return '未知错误';
}
