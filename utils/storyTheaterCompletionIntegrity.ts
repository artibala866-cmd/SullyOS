import { extractContent, safeResponseJson } from './safeApi';
import { describeEmptyStoryCompletion, describeStoryApiError } from './storyTheater';
import { extractSillyTavernStoryContent } from './storySillyTavernImport';

export interface StoryCompletion {
    content: string;
    interruption?: string;
}

/** A transport or model stop can leave paid, readable prose in the response. */
export async function readStoryCompletion(
    response: Response,
    fromTavern: boolean,
    maxTokens?: number,
    onPromptTokens?: (tokens: number) => void,
): Promise<StoryCompletion> {
    const data = await safeResponseJson(response, { keepInterruptedBody: true });
    if (!response.ok) throw new Error(describeStoryApiError(response.status, data));

    const promptTokens = Number(data?.usage?.prompt_tokens);
    if (Number.isFinite(promptTokens) && promptTokens > 0) onPromptTokens?.(promptTokens);
    const choice = data?.choices?.[0];
    const reportedReason = String(choice?.finish_reason ?? choice?.finishReason ?? '').trim();
    const reason = reportedReason.toLowerCase();
    const prose = extractContent(data, false);
    const content = prose && fromTavern ? extractSillyTavernStoryContent(data).trim() || prose : prose;

    let interruption: string | undefined;
    if (data?.error) {
        interruption = describeStoryApiError(response.status, data);
    } else if (reason === 'length' || reason === 'max_tokens' || reason === 'max_output_tokens') {
        interruption = `已达到输出上限（结束原因 ${reportedReason}${maxTokens ? `，本次请求最大输出 ${maxTokens} tokens` : ''}）`;
    } else if (reason === 'content_filter' || reason === 'safety') {
        interruption = `接口报告内容过滤（结束原因 ${reportedReason}）`;
    } else if (reason === 'error' || reason === 'cancelled' || reason === 'canceled' || reason === 'incomplete') {
        interruption = `接口报告生成中断（结束原因 ${reportedReason}）`;
    } else if (data?.__sullyRawStreamTerminal === false
        || (response.headers.get('X-Sully-Upgraded-Stream') === '1' && response.headers.get('X-Sully-Stream-Terminal') !== '1')) {
        const detail = data?.__sullyBodyReadError;
        interruption = detail
            ? `HTTP ${response.status} 流式响应读取中断（${detail}），未收到结束标记`
            : `HTTP ${response.status} 流式响应结束时缺少结束标记`;
    }

    if (!content) {
        if (interruption) throw new Error(`${interruption}，未收到可读正文`);
        const message = choice?.message;
        if (typeof message?.refusal === 'string' && message.refusal.trim()) {
            throw new Error(`接口拒绝生成：${message.refusal.trim().slice(0, 500)}`);
        }
        if (message?.reasoning_content || message?.reasoning || message?.thinking) {
            throw new Error(`HTTP ${response.status} 只返回了思考内容${reportedReason ? `（结束原因 ${reportedReason}）` : ''}，未收到正文`);
        }
        throw new Error(describeEmptyStoryCompletion(data));
    }
    return { content, interruption };
}
