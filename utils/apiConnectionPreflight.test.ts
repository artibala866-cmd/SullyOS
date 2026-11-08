import { describe, expect, it, vi } from 'vitest';
import { checkApiConnectionWithoutGeneration } from './apiConnectionPreflight';

const config = {
    baseUrl: 'https://api.example.test/v1/',
    apiKey: 'test-secret',
    model: 'gemini-4-argon',
};

const asFetch = (fn: ReturnType<typeof vi.fn>): typeof fetch => fn as unknown as typeof fetch;

describe('免费 API 连通性检查（禁止意外扣费）', () => {
    it('只调用一次 GET /models，绝不发送付费 /chat/completions', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: [{ id: 'gemini-4-argon' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const result = await checkApiConnectionWithoutGeneration(config, asFetch(fetchMock));
        expect(result.ok).toBe(true);
        expect(result.generationVerified).toBe(false);
        expect(result.message).toContain('不能证明生成可用');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.example.test/v1/models');
        expect(options.method).toBe('GET');
        expect(options.body).toBeUndefined();
        expect(options.credentials).toBe('omit');
        expect(options.headers.Authorization).toBe('Bearer test-secret');
    });

    it('模型列表不含目标模型时不误报生成成功，不会偷偷回退付费测试', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'other' }] })));
        const result = await checkApiConnectionWithoutGeneration(config, asFetch(fetchMock));
        expect(result.ok).toBe(true);
        expect(result.message).toContain('列表没有 gemini-4-argon');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('站子不提供模型列表时也不发送付费生成', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));
        const result = await checkApiConnectionWithoutGeneration(config, asFetch(fetchMock));
        expect(result.ok).toBe(false);
        expect(result.message).toContain('无法无扣费验证');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('网络 / CORS 失败后不重发付费请求', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        const result = await checkApiConnectionWithoutGeneration(config, asFetch(fetchMock));
        expect(result.ok).toBe(false);
        expect(result.message).toContain('没有发起付费生成');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('超时会取消请求，不会继续挂住数分钟，也不会调用生成接口', async () => {
        const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            }));
        const result = await checkApiConnectionWithoutGeneration(config, asFetch(fetchMock), 5);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('超时');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    });

    it('401 返回密钥权限问题提示，但不误称已经尝试生成', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
        const result = await checkApiConnectionWithoutGeneration(config, asFetch(fetchMock));
        expect(result.ok).toBe(false);
        expect(result.message).toContain('HTTP 401');
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
