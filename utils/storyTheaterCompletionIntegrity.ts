import { extractContent, safeResponseJson } from './safeApi';
import { describeEmptyStoryCompletion, describeStoryApiError } from './storyTheater';
import { extractSillyTavernStoryContent } from './storySillyTavernImport';

export interface StoryCompletion {
    content: string;
    interruption?: string;
}

function storyChoices(data: any): any[] {
    if (Array.isArray(data?.choices) && data.choices.length) return data.choices;
    if (Array.isArray(data?.candidates) && data.candidates.length) {
        return data.candidates.map((candidate: any) => ({
            finish_reason: candidate?.finishReason,
            message: { content: candidate?.content?.parts },
        }));
    }
    const messages = Array.isArray(data?.output)
        ? data.output.filter((item: any) => item?.type === 'message' && item?.role === 'assistant')
        : [];
    if (messages.length || typeof data?.output_text === 'string') {
        const parts = messages.flatMap((item: any) => Array.isArray(item.content) ? item.content : []);
        return [{
            finish_reason: data.incomplete_details?.reason ?? (data.status === 'completed' ? 'stop' : data.status),
            message: { content: parts.length ? parts : data.output_text },
        }];
    }
    return [];
}

function providerError(status: number, data: any): string {
    const detail = describeStoryApiError(status, data);
    const code = data?.error?.code ?? data?.error?.type ?? data?.code;
    return (typeof code === 'string' || typeof code === 'number') && !detail.includes(String(code))
        ? `${detail}（错误码 ${String(code).slice(0, 100)}）`
        : detail;
}

function visibleStoryText(text: string): boolean {
    const safeText = text.replace(/<!--[^]*?(?:-->|$)/g, '')
        .replace(/<(script|style|iframe|object)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, '');
    if (/<(?:img|video|audio|svg)\b/i.test(safeText)) return true;
    return !!safeText.replace(/<\/?[a-z][^>]*>/gi, '')
        .replace(/&(?:nbsp|#160|#x0*a0);|[\u200B-\u200D\uFEFF]/gi, '').trim();
}

/** Classify the same response for the reading page and API call history. */
export function inspectStoryCompletion(response: Response, data: any, fromTavern = false, maxTokens?: number): StoryCompletion {
    if (!response.ok) throw new Error(providerError(response.status, data));

    const choices = storyChoices(data);
    let choice = choices[0];
    let content = '';
    for (const option of choices) {
        const message = option?.message;
        const candidate = { choices: [{ message: { ...message, content: message?.content ?? option?.text } }] };
        const prose = extractContent(candidate, false).replace(/[\uD800-\uDBFF]$/, '').trim();
        if (!visibleStoryText(prose)) continue;
        choice = option;
        content = fromTavern ? extractSillyTavernStoryContent(candidate).trim() || prose : prose;
        break;
    }

    const reportedReason = String(choice?.finish_reason ?? choice?.finishReason ?? data?.incomplete_details?.reason ?? data?.promptFeedback?.blockReason ?? '').trim();
    const reason = reportedReason.toLowerCase();
    const detail = data?.__sullyBodyReadError;
    const frameErrors = data?.__sullyInvalidStreamFrames;
    let interruption: string | undefined;
    if (data?.error) {
        interruption = providerError(response.status, data);
    } else if (['length', 'max_tokens', 'max_output_tokens'].includes(reason)) {
        interruption = `已达到输出上限（结束原因 ${reportedReason}${maxTokens ? `，本次请求最大输出 ${maxTokens} tokens` : ''}）`;
    } else if (['content_filter', 'safety', 'recitation', 'prohibited_content', 'blocklist', 'spii'].includes(reason) || data?.promptFeedback?.blockReason) {
        interruption = `接口报告内容过滤（结束原因 ${reportedReason}）`;
    } else if (['error', 'failed', 'cancelled', 'canceled', 'incomplete'].includes(reason)) {
        interruption = `接口报告生成中断（结束原因 ${reportedReason}）`;
    }
    const transportNotes = [
        detail && `读取响应时连接中断（${detail}）`,
        data?.__sullyTruncatedJson && '非流式 JSON 响应在传输中截断',
        frameErrors && `流式响应有 ${frameErrors} 个无法解析的数据帧`,
        (data?.__sullyRawStreamTerminal === false
            || (response.headers.get('X-Sully-Upgraded-Stream') === '1' && response.headers.get('X-Sully-Stream-Terminal') !== '1'))
            && '流式响应缺少结束标记',
    ].filter(Boolean);
    if (transportNotes.length) interruption = [interruption, `HTTP ${response.status} ${transportNotes.join('，')}`].filter(Boolean).join('；');

    if (!content) {
        const message = choice?.message;
        const refusalPart = Array.isArray(message?.content) ? message.content.find((item: any) => item?.type === 'refusal') : undefined;
        const refusal = message?.refusal ?? refusalPart?.refusal ?? refusalPart?.text;
        if (typeof refusal === 'string' && refusal.trim()) {
            throw new Error([interruption, `接口拒绝生成：${refusal.trim().slice(0, 500)}`].filter(Boolean).join('；'));
        }
        const thinkingOnly = message?.reasoning_content || message?.reasoning || message?.thinking
            || (Array.isArray(message?.content) && message.content.some((part: any) => part?.thought || part?.type === 'thinking'))
            || (typeof message?.content === 'string' && /<(?:think|thinking|thought)\b/i.test(message.content));
        if (interruption) throw new Error(`${interruption}，${thinkingOnly ? '只收到思考内容，' : ''}未收到可读正文`);
        if (thinkingOnly) throw new Error(`HTTP ${response.status} 只返回了思考内容${reportedReason ? `（结束原因 ${reportedReason}）` : ''}，未收到正文`);
        if (message?.tool_calls?.length || reason === 'tool_calls') throw new Error(`HTTP ${response.status} 只返回了工具调用，未收到正文`);
        if (!choices.length) throw new Error(`HTTP ${response.status} 没有返回可识别的剧情结果${data?.message ? `，${providerError(response.status, data)}` : ''}`);
        throw new Error(`HTTP ${response.status} ${describeEmptyStoryCompletion({ ...data, choices: [choice] })}`);
    }
    return { content, interruption };
}

export async function readStoryCompletion(
    response: Response,
    fromTavern: boolean,
    maxTokens?: number,
    onPromptTokens?: (tokens: number) => void,
): Promise<StoryCompletion> {
    const data = await safeResponseJson(response, { keepInterruptedBody: true });
    const promptTokens = Number(data?.usage?.prompt_tokens ?? data?.usage?.input_tokens ?? data?.usageMetadata?.promptTokenCount);
    if (Number.isFinite(promptTokens) && promptTokens > 0) onPromptTokens?.(promptTokens);
    return inspectStoryCompletion(response, data, fromTavern, maxTokens);
}
