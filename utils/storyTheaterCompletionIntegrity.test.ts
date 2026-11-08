import { describe, expect, it } from 'vitest';
import { assembleUpgradedResponse } from './streamUpgrade';
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
        expect(() => assertCompleteStoryResponse(completed, await completed.json())).not.toThrow();

        const doneOnly = await upgraded([
            ': OPENROUTER PROCESSING',
            'data: {"choices":[{"delta":{"content":"最终一句"}}]}',
            'data: [DONE]',
        ]);
        expect(doneOnly.headers.get('X-Sully-Stream-Terminal')).toBe('1');
        expect(() => assertCompleteStoryResponse(doneOnly, await doneOnly.json())).not.toThrow();
    });

    it('模型达到输出上限不将截断内容误当完整，普通兼容 JSON 不要求 finish_reason', () => {
        const plain = new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        expect(() => assertCompleteStoryResponse(plain, { choices: [{ message: { content: '正常内容' } }] })).not.toThrow();
        expect(() => assertCompleteStoryResponse(plain, { choices: [{ message: { content: '半截' }, finish_reason: 'length' }] })).toThrow('输出上限');
        expect(() => assertCompleteStoryResponse(plain, { choices: [{ finish_reason: 'content_filter' }] })).toThrow('拦截');
    });
});
