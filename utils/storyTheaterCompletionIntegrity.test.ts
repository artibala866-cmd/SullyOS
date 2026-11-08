import { describe, expect, it } from 'vitest';
import { assembleUpgradedResponse } from './streamUpgrade';
import { safeResponseJson } from './safeApi';
import { assertCompleteStoryResponse } from './storyTheaterCompletionIntegrity';

const upgraded = (lines: string[]) => assembleUpgradedResponse(new Response(
    lines.join('\n') + '\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
));

describe('剧情完整生成入库守卫', () => {
    it('上游只返回开头正文就断开：SSE 能拼 JSON 也必须拒绝保存半截', async () => {
        const response = await upgraded([
            'data: {"id":"partial","choices":[{"delta":{"content":"他刚走到门口"}}]}',
        ]);
        const data = await response.json();
        expect(data.choices[0].message.content).toBe('他刚走到门口');
        expect(response.headers.get('X-Sully-Upgraded-Stream')).toBe('1');
        expect(response.headers.get('X-Sully-Stream-Terminal')).toBe('0');
        expect(() => assertCompleteStoryResponse(response, data)).toThrow('提前中断');
    });

    it('正常的 stop 结束或只有 DONE 的兼容中转，都可以保存完整结果', async () => {
        const completed = await upgraded([
            'data: {"choices":[{"delta":{"content":"完整"}}]}',
            'data: {"choices":[{"delta":{"content":"剧情"},"finish_reason":"stop"}]}',
        ]);
        expect(completed.headers.get('X-Sully-Stream-Terminal')).toBe('1');
        const completeData = await completed.json();
        expect(() => assertCompleteStoryResponse(completed, completeData)).not.toThrow();

        const doneOnly = await upgraded([
            ': OPENROUTER PROCESSING',
            'data: {"choices":[{"delta":{"content":"最终一句"}}]}',
            'data: [DONE]',
        ]);
        expect(doneOnly.headers.get('X-Sully-Stream-Terminal')).toBe('1');
        const doneOnlyData = await doneOnly.json();
        expect(() => assertCompleteStoryResponse(doneOnly, doneOnlyData)).not.toThrow();
    });

    it('中转无视 stream:false 返回原始 SSE：无结束信号不能保存付费半截剧情', async () => {
        const response = new Response('data: {"choices":[{"delta":{"content":"半截剧情"}}]}\\n', {
            headers: { 'Content-Type': 'text/event-stream' },
        });
        const data = await safeResponseJson(response);
        expect(data.choices[0].message.content).toBe('半截剧情');
        expect(data.__sullyRawStreamTerminal).toBe(false);
        expect(Object.keys(data)).not.toContain('__sullyRawStreamTerminal');
        expect(() => assertCompleteStoryResponse(response, data)).toThrow('提前中断');
    });

    it('中转原始 SSE 显式发出 DONE：没有 finish_reason 仍可保存完整正文', async () => {
        const response = new Response([
            'data: {"choices":[{"delta":{"content":"完整剧情"}}]}',
            'data: [DONE]',
        ].join('\\n') + '\\n', { headers: { 'Content-Type': 'text/event-stream' } });
        const data = await safeResponseJson(response);
        expect(data.__sullyRawStreamTerminal).toBe(true);
        expect(() => assertCompleteStoryResponse(response, data)).not.toThrow();
    });

    it('上游返回 content_filter 即使有正文和输出 token 也必须拦截，不自动保存', () => {
        const response = new Response('{}', { status: 200 });
        expect(() => assertCompleteStoryResponse(response, {
            usage: { prompt_tokens: 37945, completion_tokens: 1122 },
            choices: [{ finish_reason: 'content_filter', message: { content: '被过滤的正文' } }],
        })).toThrow('content_filter');
    });

    it('模型达到输出上限不将截断内容误当完整，普通兼容 JSON 不要求 finish_reason', () => {
        const plain = new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        expect(() => assertCompleteStoryResponse(plain, { choices: [{ message: { content: '正常内容' } }] })).not.toThrow();
        expect(() => assertCompleteStoryResponse(plain, { choices: [{ message: { content: '半截' }, finish_reason: 'length' }] })).toThrow('输出上限');
        expect(() => assertCompleteStoryResponse(plain, { choices: [{ finish_reason: 'content_filter' }] })).toThrow('拦截');
    });
});
