import { extractModelIds } from './modelList';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';

export type ApiConnectionPreflightResult = {
    ok: boolean;
    message: string;
    /** A /models check never exercises the billable chat-completion route. */
    generationVerified: false;
};

/**
 * Connection testing must NEVER spend the user's model credits.
 * Calling /chat/completions with even a two-letter prompt can reach the
 * upstream, be charged, and later fail to return through a CORS/gateway hop.
 * Only make a single, read-only GET /models request. Do not retry it or
 * quietly fall back to a paid completion when the endpoint is unsupported.
 */
export async function checkApiConnectionWithoutGeneration(
    config: { baseUrl: string; apiKey: string; model: string },
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 12000,
): Promise<ApiConnectionPreflightResult> {
    const url = normalizeApiBaseUrl(config.baseUrl);
    const key = normalizeApiCredential(config.apiKey);
    const model = normalizeApiModel(config.model);
    if (!url || !key || !model) {
        return { ok: false, generationVerified: false, message: '❌ 请先填写 API 地址、密钥和模型；没有发起任何请求。' };
    }
    try {
        const parsed = new URL(url);
        if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
        if (typeof window !== 'undefined' && window.location.protocol === 'https:'
            && parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
            return { ok: false, generationVerified: false, message: '❌ HTTPS 页面不能直接连接 HTTP API；未发起生成请求。' };
        }
    } catch {
        return { ok: false, generationVerified: false, message: '❌ API 地址不是有效的 http(s) URL；没有发起请求。' };
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
        const response = await fetchImpl(`${url}/models`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${key}` },
            cache: 'no-store',
            credentials: 'omit',
            signal: controller.signal,
        });
        if (response.status === 404 || response.status === 405 || response.status === 501) {
            return {
                ok: false, generationVerified: false,
                message: `⚠️ /models 返回 HTTP ${response.status}：站子可能不提供模型列表，无法无扣费验证生成；本次没有调用生成接口。`,
            };
        }
        if (response.status === 401 || response.status === 403) {
            return {
                ok: false, generationVerified: false,
                message: `❌ /models 返回 HTTP ${response.status}：密钥或模型列表权限未通过；本次没有调用生成接口。`,
            };
        }
        if (!response.ok) {
            return {
                ok: false, generationVerified: false,
                message: `❌ /models 返回 HTTP ${response.status}：站子接口异常；本次没有调用生成接口。`,
            };
        }
        let ids: string[] = [];
        try { ids = extractModelIds(await response.json()); }
        catch { /* A successful HTTP response isn't necessarily a model list. */ }
        if (!ids.length) {
            return {
                ok: true, generationVerified: false,
                message: '⚠️ /models 已响应，但未返回可识别的模型列表。只能证明接口可达，不能证明模型能生成；本次没有调用生成接口。',
            };
        }
        const available = ids.some(id => id.toLowerCase() === model.toLowerCase());
        return {
            ok: true, generationVerified: false,
            message: available
                ? `✅ /models 可访问，列表包含 ${model}。这不是模型试答，不能证明生成可用；本次没有调用生成接口。`
                : `⚠️ /models 可访问（${ids.length} 个模型），列表没有 ${model}。部分站子模型列表不全，不能据此断定不可用；本次没有调用生成接口。`,
        };
    } catch {
        return {
            ok: false, generationVerified: false,
            message: timedOut
                ? '❌ /models 连通性检查超时，已取消；没有发起付费生成请求。'
                : '❌ /models 连接失败：可能是网络、网关或 CORS，浏览器无法进一步确认；没有发起付费生成请求。',
        };
    } finally {
        clearTimeout(timer);
    }
}
