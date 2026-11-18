import { defineConfig } from 'vitest/config';

/**
 * 单元测试只覆盖纯数据逻辑、Chrome API 封装与同步状态机，
 * 不依赖真实浏览器环境，因此使用 Node 环境。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Windows 受限环境可能禁止 child_process 管道；线程池无需创建管道子进程。
    pool: 'threads',
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 5000,
  },
});
