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
});
