import { describe, expect, it, vi } from 'vitest';
import {
  checkWebsiteHealth,
  PrivateHealthUrlError,
  UnsupportedHealthUrlError,
  type HealthFetch,
} from '../src/services/websiteHealthService';

function response(
  status: number,
  options: { url?: string; redirected?: boolean; body?: BodyInit | null } = {},
): Response {
  const result = new Response(options.body ?? null, { status });
  Object.defineProperty(result, 'url', {
    configurable: true,
    value: options.url ?? '',
  });
  Object.defineProperty(result, 'redirected', {
    configurable: true,
    value: options.redirected ?? false,
  });
  return result;
}

function singleResponse(status: number, options?: Parameters<typeof response>[1]) {
  const fetchImpl = vi.fn<HealthFetch>(async () => response(status, options));
  return { fetchImpl, options };
}

async function checkStatus(status: number, options?: Parameters<typeof response>[1]) {
  const { fetchImpl } = singleResponse(status, options);
  const result = await checkWebsiteHealth('https://example.com/path', {
    fetchImpl,
    maxRetries: 0,
  });
  return { result, fetchImpl };
}

describe('HTTP 健康检测', () => {
  it.each([
    [200, 'healthy'],
    [204, 'healthy'],
    [301, 'redirected'],
    [302, 'redirected'],
    [401, 'restricted'],
    [403, 'restricted'],
    [404, 'not_found'],
    [410, 'gone'],
    [500, 'server_error'],
    [502, 'server_error'],
    [503, 'server_error'],
    [400, 'unknown'],
    [429, 'restricted'],
  ] as const)('HTTP %i -> %s', async (httpStatus, expected) => {
    const { result } = await checkStatus(httpStatus);
    expect(result.status).toBe(expected);
    expect(result.httpStatus).toBe(httpStatus);
    expect(result.method).toBe('HEAD');
  });

  it('没有跟随到最终状态时，3xx 仍分类为已跳转', async () => {
    const { result } = await checkStatus(301);
    expect(result.status).toBe('redirected');
  });

  it('跟随跳转后最终 2xx 记录最终 URL 并显示已跳转', async () => {
    const { result, fetchImpl } = await checkStatus(200, {
      url: 'https://www.example.com/final',
      redirected: true,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/path',
      expect.objectContaining({
        method: 'HEAD',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
      }),
    );
    expect(result.status).toBe('redirected');
    expect(result.finalUrl).toBe('https://www.example.com/final');
    expect(result.httpStatus).toBe(200);
  });

  it('HTTP 404 不触发 GET 回退', async () => {
    const { result, fetchImpl } = await checkStatus(404);
    expect(result.status).toBe('not_found');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('HEAD');
  });

  it.each([405, 501])('HEAD %i 时用带 Range 的 GET 回退', async (headStatus) => {
    const fetchImpl = vi
      .fn<HealthFetch>()
      .mockResolvedValueOnce(response(headStatus))
      .mockResolvedValueOnce(response(200));

    const result = await checkWebsiteHealth('https://example.com/file', {
      fetchImpl,
      maxRetries: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('HEAD');
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe('GET');
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toEqual({
      Range: 'bytes=0-0',
    });
    expect(result).toMatchObject({
      status: 'healthy',
      httpStatus: 200,
      method: 'GET',
    });
  });

  it('GET 回退也会取消响应体，避免下载大文件', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    const cancel = vi.spyOn(body, 'cancel');
    const getResponse = response(200, { body });
    const fetchImpl = vi
      .fn<HealthFetch>()
      .mockResolvedValueOnce(response(405))
      .mockResolvedValueOnce(getResponse);

    await checkWebsiteHealth('https://example.com/file', {
      fetchImpl,
      maxRetries: 0,
    });

    expect(cancel).toHaveBeenCalled();
  });

  it('HEAD 之外的失败不会自动当作网站失效', async () => {
    const { result } = await checkStatus(400);
    expect(result.status).toBe('unknown');
    expect(result.errorMessage).toContain('无法确认');
  });
});

describe('健康检测超时、网络错误与重试', () => {
  it('超时会真正 abort 请求并返回无法确认', async () => {
    let aborted = false;
    const fetchImpl: HealthFetch = (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };

    const result = await checkWebsiteHealth('https://timeout.example/', {
      fetchImpl,
      timeoutMs: 15,
      maxRetries: 0,
    });

    expect(aborted).toBe(true);
    expect(result.status).toBe('unknown');
    expect(result.errorMessage).toContain('超时');
  });

  it('网络中断自动重试一次，仍失败时返回 unknown', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi
      .fn<HealthFetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await checkWebsiteHealth('https://dns.example/', {
      fetchImpl,
      maxRetries: 1,
      retryDelayMs: 3_000,
      sleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3_000);
    expect(result.status).toBe('unknown');
    expect(result.retryCount).toBe(1);
  });

  it('5xx 自动重试一次，第二次成功返回正常', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi
      .fn<HealthFetch>()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));

    const result = await checkWebsiteHealth('https://retry.example/', {
      fetchImpl,
      maxRetries: 1,
      sleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('healthy');
    expect(result.retryCount).toBe(1);
  });

  it('404 不会重试', async () => {
    const { result, fetchImpl } = await checkStatus(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('not_found');
  });

  it('DNS/TLS 等不可区分错误都归为 unknown', async () => {
    const fetchImpl = vi
      .fn<HealthFetch>()
      .mockRejectedValue(
        Object.assign(new Error('certificate verify failed'), { code: 'CERT' }),
      );

    const result = await checkWebsiteHealth('https://tls.example/', {
      fetchImpl,
      maxRetries: 0,
    });

    expect(result.status).toBe('unknown');
    expect(result.httpStatus).toBeUndefined();
    expect(result.errorMessage).toContain('网络连接异常');
  });

  it('非 HTTP(S) 地址不发起请求', async () => {
    const fetchImpl = vi.fn<HealthFetch>();
    await expect(
      checkWebsiteHealth('chrome://settings', { fetchImpl }),
    ).rejects.toBeInstanceOf(UnsupportedHealthUrlError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('内网/本机地址不发起请求', async () => {
    const fetchImpl = vi.fn<HealthFetch>();
    await expect(
      checkWebsiteHealth('http://127.0.0.1:43123/', { fetchImpl }),
    ).rejects.toBeInstanceOf(PrivateHealthUrlError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
