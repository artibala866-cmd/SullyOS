import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { callMcpTool, createMcpServer, resetMcpSession, testMcpConnection, type McpServerConfig } from './mcpClient';

const ORCA = 'https://orca-mcp.mmdju.workers.dev/mcp';
const RELAY = 'https://proxy.friedsully.com/mcp/orca';
const server = (patch: Partial<McpServerConfig> = {}): McpServerConfig => ({
    ...createMcpServer('电影与剧集 · Orca', ORCA),
    presetId: 'realtime.orca',
    ...patch,
});

beforeEach(() => {
    localStorage.removeItem('sully_proxy_worker_url_v1');
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// 模拟真实 Streamable HTTP initialize -> notifications/initialized -> tools/list -> tools/call。
// 不使用旧版 SSE 双端点，也不以配置表存在冒充连接成功。
function mockTransport() {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        const path = String(url);
        const rpc = JSON.parse(String(init.body));
        calls.push({ url: path, method: rpc.method });
        if (path === ORCA) throw new TypeError('Failed to fetch'); // 浏览器 CORS
        if (path !== RELAY) throw new Error('unexpected endpoint ' + path);
        if (rpc.method === 'initialize') return new Response(JSON.stringify({
            jsonrpc: '2.0', id: rpc.id, result: {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'Orca MCP', version: '1.0.0' },
            },
        }), { headers: { 'Content-Type': 'application/json' } });
        if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
        if (rpc.method === 'tools/list') return new Response(JSON.stringify({
            jsonrpc: '2.0', id: rpc.id, result: {
                tools: [{ name: 'movies_search', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }],
            },
        }), { headers: { 'Content-Type': 'application/json' } });
        if (rpc.method === 'tools/call') return new Response(JSON.stringify({
            jsonrpc: '2.0', id: rpc.id, result: {
                content: [{ type: 'text', text: JSON.stringify({ title: '电影测试', query: rpc.params.arguments.query }) }],
            },
        }), { headers: { 'Content-Type': 'application/json' } });
        throw new Error('unexpected RPC ' + rpc.method);
    }));
    return calls;
}

describe('Orca 影视 MCP 直连失败后的专用转发', () => {
    it('只在真正握手失败后走固定中转，发现工具并能继续实际调用', async () => {
        const calls = mockTransport();
        const cfg = server();
        const tested = await testMcpConnection(cfg);
        expect(tested.ok).toBe(true);
        expect(tested.tools?.map(t => t.name)).toEqual(['movies_search']);
        expect(calls[0]).toEqual({ url: ORCA, method: 'initialize' });
        expect(calls.some(c => c.url === RELAY && c.method === 'tools/list')).toBe(true);
        const result = await callMcpTool({ ...cfg, tools: tested.tools }, 'movies_search', { query: '流浪地球' });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ title: '电影测试', query: '流浪地球' });
        expect(calls[calls.length - 1]).toEqual({ url: RELAY, method: 'tools/call' });
        resetMcpSession(cfg.id);
    });

    it('从未测试过的已保存工具在聊天执行时也能自动恢复', async () => {
        const calls = mockTransport();
        const cfg = server({ tools: [{ name: 'movies_search', inputSchema: { type: 'object', properties: {} } }] });
        const result = await callMcpTool(cfg, 'movies_search', { query: 'Dune' });
        expect(result.success).toBe(true);
        expect(calls.filter(c => c.url === ORCA)).toHaveLength(1);
        expect(calls.some(c => c.url === RELAY && c.method === 'tools/call')).toBe(true);
        resetMcpSession(cfg.id);
    });

    it('用户带有 Token、自定义端点或其他 MCP 时，绝不能把凭据发送给公共中转', async () => {
        const calls = mockTransport();
        const configs = [
            server({ token: 'private-secret' }),
            server({ url: 'https://other.example/mcp' }),
            server({ customHeaders: [{ name: 'Authorization', value: 'secret' }] }),
            server({ proxyUrl: 'https://user.example/proxy' }),
            server({ presetId: undefined }),
        ];
        for (const cfg of configs) {
            await testMcpConnection(cfg);
            resetMcpSession(cfg.id);
        }
        expect(calls.every(c => c.url !== RELAY)).toBe(true);
    });

    it('协议错误不能被当成 CORS 去自动中转', async () => {
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            calls.push(String(url));
            return new Response('nope', { status: 403 });
        }));
        const cfg = server();
        const result = await testMcpConnection(cfg);
        expect(result.ok).toBe(false);
        expect(calls).toEqual([ORCA]);
        resetMcpSession(cfg.id);
    });
});
