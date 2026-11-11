import { describe, it, expect } from 'vitest';
import { upgradeChatBodyToStream, assembleUpgradedResponse } from './streamUpgrade';

// 透明流式升级：请求体改写 + SSE 响应拼回 JSON。
// 关键不变量：调用方拿到的最终 JSON 与不升级时结构等价（choices/usage/model）。

describe('upgradeChatBodyToStream', () => {
    it('stream:false → 升级为 stream:true + include_usage，其余字段不动', () => {
        const out = upgradeChatBodyToStream(JSON.stringify({ model: 'm', messages: [], stream: false, max_tokens: 8000 }));
        const parsed = JSON.parse(out!);
        expect(parsed.stream).toBe(true);
        expect(parsed.stream_options).toEqual({ include_usage: true });
        expect(parsed.max_tokens).toBe(8000);
    });

    it('缺省 stream → 同样升级', () => {
        const out = upgradeChatBodyToStream(JSON.stringify({ model: 'm', messages: [] }));
        expect(JSON.parse(out!).stream).toBe(true);
    });

    it('已是 stream:true（聊天主路径等自行开流的调用）→ 不碰，返回 null', () => {
        expect(upgradeChatBodyToStream(JSON.stringify({ model: 'm', stream: true }))).toBeNull();
    });

    it('非 JSON / 非对象 body → 返回 null 原样放行', () => {
        expect(upgradeChatBodyToStream('not-json')).toBeNull();
        expect(upgradeChatBodyToStream('[1,2]')).toBeNull();
    });

    it('保留调用方其他流式参数及输出上限', () => {
        const body = {
            model: 'my-model', stream: false, max_tokens: 30000,
            temperature: 1.2, stream_options: { include_obfuscation: false, vendor_option: 'kept' },
        };
        const upgraded = JSON.parse(upgradeChatBodyToStream(JSON.stringify(body))!);
        expect(upgraded.stream).toBe(true);
        expect(upgraded.max_tokens).toBe(30000);
        expect(upgraded.temperature).toBe(1.2);
        expect(upgraded.stream_options).toEqual({
            include_obfuscation: false, vendor_option: 'kept', include_usage: true,
        });
    });
});

describe('assembleUpgradedResponse', () => {

    it('完成后上游不关闭连接：收到 DONE 也能立即交付，且保留用量', async () => {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode((
                    'data: {"choices":[{"delta":{"content":"长回复完整"}}]}\\n\\n' +
                    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\\n\\n' +
                    'data: {"choices":[],"usage":{"prompt_tokens":123,"completion_tokens":45}}\\n\\n' +
                    'data: [DONE]\\n\\n'
                ).replaceAll('\\n', '\n')));
                // Intentionally never close: an open gateway socket is not
                // evidence that generation is still running after DONE.
            },
        });
        const response = await assembleUpgradedResponse(new Response(body, {
            headers: { 'Content-Type': 'text/event-stream' },
        }));
        const data = await response.json();
        expect(response.headers.get('X-Sully-Stream-Terminal')).toBe('1');
        expect(data.choices[0].message.content).toBe('长回复完整');
        expect(data.usage).toEqual({ prompt_tokens: 123, completion_tokens: 45 });
    });

    it('流中途断线：保留可恢复正文，并标明未完成和传输错误', async () => {
        const encoder = new TextEncoder();
        let sent = false;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (!sent) {
                    sent = true;
                    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"半段正文"}}]}\\n\\n'.replaceAll('\\n', '\n')));
                } else {
                    controller.error(new TypeError('connection reset'));
                }
            },
        });
        const response = await assembleUpgradedResponse(new Response(body, {
            headers: { 'Content-Type': 'text/event-stream' },
        }));
        const data = await response.json();
        expect(response.headers.get('X-Sully-Stream-Terminal')).toBe('0');
        expect(data.choices[0].message.content).toBe('半段正文');
        expect(data.__sullyBodyReadError).toContain('connection reset');
    });
    it('SSE 响应 → 拼回标准 chat.completion JSON', async () => {
        const sse = [
            'data: {"id":"c1","model":"real-backend","choices":[{"delta":{"role":"assistant","content":"你好"}}]}',
            'data: {"choices":[{"delta":{"content":"呀"}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
            'data: [DONE]',
            '',
        ].join('\n');
        const upstream = new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        const out = await assembleUpgradedResponse(upstream);
        expect(out.headers.get('content-type')).toContain('application/json');
        const data = await out.json();
        expect(data.choices[0].message.content).toBe('你好呀');
        expect(data.model).toBe('real-backend');
        expect(data.usage.total_tokens).toBe(12);
    });

    it('OpenRouter 心跳先于 data 时仍拼回标准 JSON', async () => {
        const sse = [
            ': OPENROUTER PROCESSING',
            '',
            'data: {"id":"c2","choices":[{"delta":{"content":"心跳后"}}]}',
            'data: {"choices":[{"delta":{"content":"正常"}}]}',
            'data: [DONE]',
            '',
        ].join('\n');
        const upstream = new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        const out = await assembleUpgradedResponse(upstream);
        const data = await out.json();
        expect(data.choices[0].message.content).toBe('心跳后正常');
    });

    it('代理无视 stream 返回整包 JSON → 原文透传（重新包装）', async () => {
        const json = JSON.stringify({ choices: [{ message: { content: '整包' } }] });
        const upstream = new Response(json, { status: 200, headers: { 'Content-Type': 'application/json' } });
        const out = await assembleUpgradedResponse(upstream);
        expect((await out.json()).choices[0].message.content).toBe('整包');
    });
});
