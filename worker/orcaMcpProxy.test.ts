/**
 * Orca 影视 MCP 的公共免鉴权 CORS 中转。
 * 锁定固定上游、协议头/SSE/session 透传，不让私人 MCP 凭据进入公共代理。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error 中心 Worker 是纯 JS，不参与 TypeScript allowJs
import worker from './index.js';

const target = 'https://orca-mcp.mmdju.workers.dev/mcp';
const endpoint = 'https://proxy.test/mcp/orca';
const call = (payload: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(endpoint, {
        method: 'POST',
        headers: { Origin: 'https://example.github.io', 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
    }), {}, { waitUntil: () => {} });
const rpc = (method: string) => ({ jsonrpc: '2.0', id: 1, method, params: {} });

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Orca MCP 安全中转', () => {
    it('预检允许协议版本头，不需要用户部署代理或传 Key', async () => {
        const res = await worker.fetch(new Request(endpoint, {
            method: 'OPTIONS',
            headers: { Origin: 'https://example.github.io', 'Access-Control-Request-Headers': 'content-type,mcp-protocol-version' },
        }), {}, {});
        expect(res.status).toBe(204);
        expect(res.headers.get('Access-Control-Allow-Headers')).toContain('MCP-Protocol-Version');
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io');
    });

    it('固定转发到原作者 URL，完整透传 MCP 版本和会话，暴露 Session-Id', async () => {
        const mock = vi.fn(async (url: string, init: RequestInit) => {
            expect(url).toBe(target);
            expect(init.method).toBe('POST');
            expect(JSON.parse(String(init.body)).method).toBe('tools/list');
            const headers = init.headers as Record<string, string>;
            expect(headers['Mcp-Session-Id']).toBe('sid-abc');
            expect(headers['MCP-Protocol-Version']).toBe('2025-11-25');
            expect(headers.Authorization).toBeUndefined();
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'movies_search' }] } }), {
                headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sid-abc' },
            });
        });
        vi.stubGlobal('fetch', mock);
        const res = await call(rpc('tools/list'), { 'Mcp-Session-Id': 'sid-abc', 'MCP-Protocol-Version': '2025-11-25' });
        expect(res.status).toBe(200);
        expect(res.headers.get('Mcp-Session-Id')).toBe('sid-abc');
        expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Mcp-Session-Id');
        expect((await res.json()).result.tools[0].name).toBe('movies_search');
        expect(mock).toHaveBeenCalledTimes(1);
    });

    it('SSE 不改写，原封不动传回客户端并维持状态码', async () => {
        const sse = 'event: message\\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\\n\\n';
        vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, {
            status: 200, headers: { 'Content-Type': 'text/event-stream' },
        })));
        const res = await call(rpc('initialize'));
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');
        expect(await res.text()).toBe(sse);
    });

    it('拒绝私人鉴权、异常方法及请求体，不向第三方发送任何内容', async () => {
        const mock = vi.fn();
        vi.stubGlobal('fetch', mock);
        expect((await call(rpc('initialize'), { Authorization: 'Bearer secret' })).status).toBe(400);
        expect((await call(rpc('tools/list'), { 'X-MCP-Forward-Headers': 'X-API-Key' })).status).toBe(400);
        expect((await call(rpc('secrets/list'))).status).toBe(400);
        expect((await worker.fetch(new Request(endpoint, { method: 'GET' }), {}, {})).status).toBe(405);
        expect(mock).not.toHaveBeenCalled();
    });

    it('上游不可用时返回 502 而不是假成功', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network unavailable'); }));
        const res = await call(rpc('tools/list'));
        expect(res.status).toBe(502);
        expect((await res.json()).error).toBe('Orca MCP upstream unavailable');
    });
});
