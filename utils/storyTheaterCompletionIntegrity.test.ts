import { describe, expect, it, vi } from 'vitest';
import { readStoryCompletion } from './storyTheaterCompletionIntegrity';
import { assembleUpgradedResponse } from './streamUpgrade';

const stream = (...lines: string[]) => new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/event-stream' },
});
const proseEvent = 'data: {"choices":[{"delta":{"content":"他刚走到门口"}}]}';

describe('剧情保留已收到的正文', () => {
    it.each(['length', 'MAX_TOKENS', 'content_filter'])('保留 HTTP 200 已返回的正文和具体结束原因 %s', async finish_reason => {
        const tokens = vi.fn();
        const result = await readStoryCompletion(Response.json({
            usage: { prompt_tokens: 26838, completion_tokens: 4404 },
            choices: [{ finish_reason, message: { content: '门缓缓开了。' } }],
        }), false, 4404, tokens);
        expect(result.content).toBe('门缓缓开了。');
        expect(result.interruption).toContain(finish_reason);
        expect(tokens).toHaveBeenCalledWith(26838);
    });

    it('标记只有开头正文但没有结束标记的流，兼容透明升级和原始 SSE', async () => {
        for (const response of [stream(proseEvent), await assembleUpgradedResponse(stream(proseEvent))]) {
            await expect(readStoryCompletion(response, false)).resolves.toEqual({
                content: '他刚走到门口', interruption: expect.stringContaining('缺少结束标记'),
            });
        }
    });

    it('保留流读取抛错前已收到的正文，并显示浏览器错误', async () => {
        let sent = false;
        const body = new ReadableStream({
            pull(controller) {
                if (!sent) {
                    controller.enqueue(new TextEncoder().encode(proseEvent + '\n\n'));
                    sent = true;
                } else {
                    controller.error(new TypeError('connection reset'));
                }
            },
        });
        const response = new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
        await expect(readStoryCompletion(response, false)).resolves.toEqual({
            content: '他刚走到门口', interruption: expect.stringContaining('connection reset'),
        });
    });

    it.each([false, true])('响应体等待超过原来的 3 分钟仍继续接收（流式：%s）', async isStream => {
        vi.useFakeTimers();
        try {
            let controller!: ReadableStreamDefaultController<Uint8Array>;
            const body = new ReadableStream<Uint8Array>({ start(streamController) { controller = streamController; } });
            const encoder = new TextEncoder();
            const expected = '他刚走到门口，门开了。';
            const response = new Response(body, {
                headers: { 'Content-Type': isStream ? 'text/event-stream' : 'application/json' },
            });
            const result = readStoryCompletion(response, false);
            const finished = vi.fn();
            void result.then(finished, finished);
            controller.enqueue(encoder.encode(isStream ? proseEvent + '\n\n' : '{"choices":[{"message":{"content":"他刚走到门口'));
            await vi.advanceTimersByTimeAsync(360000);
            expect(finished).not.toHaveBeenCalled();
            controller.enqueue(encoder.encode(isStream
                ? 'data: {"choices":[{"delta":{"content":"，门开了。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
                : '，门开了。"},"finish_reason":"stop"}]}'));
            controller.close();
            await expect(result).resolves.toEqual({ content: expected, interruption: undefined });
        } finally {
            vi.useRealTimers();
        }
    });

    it('stop 或 DONE 都能正常结束，普通兼容 JSON 可以省略结束原因', async () => {
        const stop = 'data: {"choices":[{"delta":{"content":"。"},"finish_reason":"stop"}]}';
        for (const [response, content] of [
            [stream(proseEvent, stop), '他刚走到门口。'],
            [stream(proseEvent, 'data: [DONE]'), '他刚走到门口'],
            [Response.json({ choices: [{ message: { content: '正常正文' } }] }), '正常正文'],
        ] as const) {
            await expect(readStoryCompletion(response, false)).resolves.toEqual({ content, interruption: undefined });
        }
    });

    it('只返回思考时不把它当成已交付正文，酒馆仍保留有正文时的排版', async () => {
        const completion = (content: string) => Response.json({ choices: [{ message: { content, reasoning_content: '思考' } }] });
        await expect(readStoryCompletion(completion(''), false)).rejects.toThrow('只返回了思考内容');
        await expect(readStoryCompletion(completion(''), true)).rejects.toThrow('只返回了思考内容');
        await expect(readStoryCompletion(completion('<content>正文</content>'), true)).resolves.toMatchObject({
            content: '<thinking>思考</thinking>\n<content>正文</content>',
        });
    });

    it('报告过滤、HTTP 错误和流内错误的实际细节', async () => {
        await expect(readStoryCompletion(Response.json({
            choices: [{ finish_reason: 'content_filter', message: { content: '' } }],
        }), false)).rejects.toThrow('content_filter');
        await expect(readStoryCompletion(Response.json({
            error: { message: 'context window exceeded' },
        }, { status: 400 }), false)).rejects.toThrow('API Error 400：context window exceeded');
        await expect(readStoryCompletion(stream(proseEvent, 'data: {"error":{"message":"upstream overloaded"}}', 'data: [DONE]'), false)).resolves.toMatchObject({
            content: '他刚走到门口', interruption: 'API Error 200：upstream overloaded',
        });
    });

    it('从非流式截断 JSON 恢复已经下载的正文及转义文字', async () => {
        const raw = '{"choices":[{"message":{"content":"门开了，\\n他说：\\\"回来\\u5427';
        await expect(readStoryCompletion(new Response(raw), false)).resolves.toMatchObject({
            content: '门开了，\n他说："回来吧',
            interruption: expect.stringContaining('非流式 JSON 响应在传输中截断'),
        });
        await expect(readStoryCompletion(new Response('{"error":{"message":"假正文"'), false)).rejects.toThrow('无效JSON');
    });

    it('流式结束后即使网关未关闭连接也交付，且正确拼接标准多行事件', async () => {
        const body = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(
                    'data: {"choices":[\n' +
                    'data: {"message":{"content":[{"type":"text","text":{"value":"完整排版"}}]}}]}\n\n' +
                    'data:  [DONE]\n\n',
                ));
            },
        });
        await expect(readStoryCompletion(new Response(body), false)).resolves.toEqual({
            content: '完整排版', interruption: undefined,
        });
    });

    it.each(['', '他刚走到门口'])('过滤结束事件跨多行且连接保持打开时交付已有正文或明确报错 %j', async content => {
        vi.useFakeTimers();
        try {
            const body = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode([
                        ...(content ? [proseEvent, ''] : []),
                        'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}', '',
                        'data: {"choices":[', 'data: {"finish_reason":"content_filter"}]}', '', '',
                    ].join('\n')));
                },
            });
            const result = readStoryCompletion(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), false);
            const assertion = content
                ? expect(result).resolves.toEqual({ content, interruption: '接口报告内容过滤（结束原因 content_filter）' })
                : expect(result).rejects.toThrow('接口报告内容过滤（结束原因 content_filter），只收到思考内容，未收到可读正文');
            await vi.advanceTimersByTimeAsync(3000);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it('兼容代理只返回 Responses 过滤结束原因而没有正文对象时仍准确报告过滤', async () => {
        await expect(readStoryCompletion(Response.json({
            status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [],
        }), false)).rejects.toThrow('接口报告内容过滤（结束原因 content_filter）');
    });

    it('跳过坏帧并保存有效正文，同时提示实际丢帧数', async () => {
        const response = stream(proseEvent, 'data: {"choices":', 'data: {"choices":[{"text":"。","finish_reason":"stop"}]}', 'data: [DONE]');
        await expect(readStoryCompletion(response, false)).resolves.toMatchObject({
            content: '他刚走到门口。', interruption: expect.stringContaining('1 个无法解析的数据帧'),
        });
    });

    it('从兼容代理的文本选择、Gemini 和 Responses 整包响应读取正文', async () => {
        for (const data of [
            { choices: [{ message: { content: '<content></content>' } }, { text: '可读正文' }] },
            { candidates: [{ content: { parts: [{ text: '隐藏推理', thought: true }, { text: '可读正文' }] }, finishReason: 'STOP' }] },
            { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '可读正文' }] }] },
        ]) {
            await expect(readStoryCompletion(Response.json(data), false)).resolves.toMatchObject({ content: '可读正文' });
        }
    });

    it('区分空排版、拒绝、Gemini 安全拦截和带错误码的 HTTP 失败', async () => {
        await expect(readStoryCompletion(Response.json({ choices: [{ message: { content: '<story_text>&nbsp;</story_text>' } }] }), false)).rejects.toThrow('没有生成正文');
        await expect(readStoryCompletion(stream('data: {"choices":[{"delta":{"refusal":"服务拒绝生成"}}]}', 'data: [DONE]'), false)).rejects.toThrow('服务拒绝生成');
        await expect(readStoryCompletion(Response.json({ promptFeedback: { blockReason: 'SAFETY' } }), false)).rejects.toThrow('SAFETY');
        await expect(readStoryCompletion(Response.json({ error: { message: 'quota exhausted', code: 'insufficient_quota' } }, { status: 429 }), false)).rejects.toThrow('错误码 insufficient_quota');
    });

});
