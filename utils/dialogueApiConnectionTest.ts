import { extractContent, safeResponseJson } from './safeApi';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';

type DialogueTestConfig = { baseUrl: string; apiKey: string; model: string; stream: boolean };

const errorText = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    if (value && typeof value === 'object') {
        const entry = value as Record<string, unknown>;
        for (const key of ['message', 'detail', 'code', 'type']) {
            if (typeof entry[key] === 'string' && entry[key]) return entry[key] as string;
        }
    }
    return '';
};

const providerError = (raw: string): string => {
    try {
        const data = JSON.parse(raw);
        const err = data?.error ?? data?.message;
        return errorText(err).slice(0, 180);
    } catch {
        return raw.trimStart().startsWith('<') ? '服务端返回 HTML 错误页面' : raw.replace(/\s+/g, ' ').trim().slice(0, 120);
    }
};

const httpReason = (status: number): string => {
    switch (status) {
        case 400: case 422: return '请求参数或模型不兼容';
        case 401: return '密钥鉴权失败';
        case 402: return '余额或额度不足';
        case 403: return '权限不足或请求被拦截';
        case 404: return 'API 路径或模型不存在';
        case 408: case 504: return '服务端响应超时';
        case 429: return '请求限流或额度受限';
        default: return status >= 500 ? '中转站或上游服务器异常' : '接口拒绝请求';
    }
};

/**
 * Existing model test: one short real completion, no retries.
 * A request reaching the provider may be billed even if the browser sees a failure.
 */
export async function testDialogueApiConnection(
    config: DialogueTestConfig,
    fetchImpl: typeof fetch = fetch,
): Promise<string> {
    const baseUrl = normalizeApiBaseUrl(config.baseUrl);
    const key = normalizeApiCredential(config.apiKey);
    const model = normalizeApiModel(config.model);
    if (!baseUrl || !key || !model) return '❌ 请填写完整的 URL、Key 和模型；未发送请求';

    let endpoint: string;
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol');
        if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.protocol === 'http:'
            && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
            return '❌ HTTPS 页面无法连接 HTTP API；未发送请求';
        }
        endpoint = baseUrl + '/chat/completions';
    } catch {
        return '❌ API 地址格式错误；未发送请求';
    }

    try {
        const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 5,
                stream: config.stream,
            }),
        });

        if (!response.ok) {
            const raw = await response.text().catch(() => '');
            const detail = providerError(raw);
            return '❌ HTTP ' + response.status + '（' + httpReason(response.status) + '）' + (detail ? '：' + detail : '');
        }

        let data: any;
        try {
            data = await safeResponseJson(response);
        } catch (error) {
            return '❌ 接口已响应，但回复解析失败：' + (errorText(error) || '响应格式异常');
        }

        if (data?.error) return '❌ 接口返回错误：' + (errorText(data.error) || '服务端未提供原因');
        const choice = data?.choices?.[0];
        if (!choice) return '❌ 接口返回成功状态，但没有模型回复数据';
        if (choice.finish_reason === 'content_filter') return '❌ 模型回复被内容审核拦截';
        if (choice.message?.refusal) return '❌ 模型拒绝了测试请求';
        if (data.__sullyRawStreamTerminal === false) return '❌ 流式回复没有正常结束，可能已生成但传输中断';
        if (choice.finish_reason === 'length') return '❌ 模型回复被 5 tokens 上限截断，未完成测试';

        const reply = extractContent(data, false);
        if (!reply) {
            if (choice.message?.reasoning_content || choice.message?.reasoning) {
                return '❌ 模型只返回了推理内容，没有回复正文（5 tokens 可能不够）';
            }
            return '❌ 模型没有返回有效回复正文';
        }
        return '✅ 连接成功 — 模型回复: "' + reply.slice(0, 30) + '"';
    } catch (error) {
        const msg = errorText(error);
        if (error instanceof TypeError || /failed to fetch|networkerror|load failed|cors/i.test(msg)) {
            return '❌ 网络或跨域连接失败；浏览器无法确认请求是否到达上游';
        }
        if (/abort|timeout|超时/i.test(msg)) return '❌ 请求超时或中断；无法确认上游是否已处理';
        return '❌ 测试请求失败：' + (msg || '未知网络错误');
    }
}
