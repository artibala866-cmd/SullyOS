import { describe, expect, it, vi } from 'vitest';
import { testDialogueApiConnection } from './dialogueApiConnectionTest';

const config = {
    baseUrl: 'https://gateway.example.test/v1/',
    apiKey: 'sk-test',
    model: 'test-model',
    stream: false,
};

const mockFetch = (fn: ReturnType<typeof vi.fn>): typeof fetch => fn as unknown as typeof fetch;
const jsonResponse = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (content: string, finishReason: string | null = 'stop') =>
    jsonResponse({ choices: [{ message: { content }, finish_reason: finishReason }] });

describe('设置里的原版模型测试', () => {
    it('只发一次真实回复请求，不重试；不向服务端设置回复 Token 上限', async () => {
        const fetchMock = vi.fn().mockResolvedValue(completion('Hello!'));
        const result = await testDialogueApiConnection(config, mockFetch(fetchMock));
        expect(result).toContain('✅ 连接成功');
        expect(result).toContain('Hello!');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://gateway.example.test/v1/chat/completions');
        expect(options.method).toBe('POST');
        expect(options.headers.Authorization).toBe('Bearer sk-test');
        expect(JSON.parse(options.body)).toEqual({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hi' }],
            stream: false,
        });
    });

    it('URL 错误先在本地拦下，不请求模型', async () => {
        const fetchMock = vi.fn();
        const result = await testDialogueApiConnection({ ...config, baseUrl: 'not-a-url' }, mockFetch(fetchMock));
        expect(result).toContain('API 地址格式错误');
        expect(result).toContain('未发送请求');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        [400, '参数', 'unsupported model'],
        [401, '鉴权', 'invalid API key'],
        [402, '余额', 'insufficient balance'],
        [403, '权限', 'forbidden'],
        [404, '不存在', 'model not found'],
        [429, '限流', 'rate limited'],
        [500, '服务器异常', 'upstream error'],
    ])('HTTP %i 返回实际失败类别和上游原因，不自动再调用', async (status, reason, providerMessage) => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: providerMessage } }, status));
        const result = await testDialogueApiConnection(config, mockFetch(fetchMock));
        expect(result).toContain('❌ HTTP ' + status);
        expect(result).toContain(reason);
        expect(result).toContain(providerMessage);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('HTTP 200 携带 error，也不能显示成功', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'channel unavailable' } }));
        const result = await testDialogueApiConnection(config, mockFetch(fetchMock));
        expect(result).toContain('❌ 接口返回错误');
        expect(result).toContain('channel unavailable');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('HTTP 200 没有回复正文不能算成功', async () => {
        const fetchMock = vi.fn().mockResolvedValue(completion(''));
        const result = await testDialogueApiConnection(config, mockFetch(fetchMock));
        expect(result).toContain('❌ 模型没有返回有效回复正文');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('服务端返回长度上限时，不误称模型完整回复', async () => {
        const fetchMock = vi.fn().mockResolvedValue(completion('He', 'length'));
        const result = await testDialogueApiConnection(config, mockFetch(fetchMock));
        expect(result).toContain('❌ 模型回复被服务端输出长度上限截断');
    });

    it('仅有思考内容不等于模型正常出字', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ message: { content: '', reasoning_content: 'internal thought' }, finish_reason: 'stop' }],
        }));
        const result = await testDialogueApiConnection(config, mockFetch(fetchMock));
        expect(result).toContain('只返回了推理内容');
    });

    it('HTTP 200 流式回复缺失结束信号，不当作成功', async () => {
        const body = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] }) + '\n\n';
        const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
            headers: { 'Content-Type': 'text/event-stream' },
        }));
        const result = await testDialogueApiConnection({ ...config, stream: true }, mockFetch(fetchMock));
        expect(result).toContain('❌ 流式回复没有正常结束');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('网络失败不自动重试，也不能声称没有扣费', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        const result = await testDialogueApiConnection(config, mockFetch(fetchMock));
        expect(result).toContain('网络或跨域连接失败');
        expect(result).toContain('无法确认请求是否到达上游');
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
