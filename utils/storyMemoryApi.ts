import type { APIConfig, ApiPreset, StoryTheaterEntry } from '../types';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';

/** Atomic, per-story snapshot: no global writes, no implicit Key/Model borrowing. */
export type StoryMemoryApi = Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;

export function normalizeStoryMemoryApi(value: unknown): StoryMemoryApi | undefined {
    if (value == null) return undefined;
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
        baseUrl: typeof raw.baseUrl === 'string' ? normalizeApiBaseUrl(raw.baseUrl) : '',
        apiKey: typeof raw.apiKey === 'string' ? normalizeApiCredential(raw.apiKey) : '',
        model: typeof raw.model === 'string' ? normalizeApiModel(raw.model) : '',
    };
}

/** Copy an API preset into this story; deleting/editing the preset never switches it later. */
export function storyMemoryApiFromPreset(preset: ApiPreset): StoryMemoryApi {
    return normalizeStoryMemoryApi(preset?.config) || { baseUrl: '', apiKey: '', model: '' };
}

export function storyMemoryApiValidationError(config: StoryMemoryApi): string | null {
    if (!config.baseUrl.trim()) return '请填写剧情记忆副 API 地址';
    let url: URL;
    try { url = new URL(config.baseUrl.trim()); }
    catch { return '剧情记忆副 API 地址不是有效的 HTTP(S) URL'; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
        return '剧情记忆副 API 仅支持不包含账号密码的 HTTP(S) 地址';
    }
    if (!config.model.trim()) return '请填写剧情记忆副 API 模型名称';
    return null;
}

/** When configured, never silently bill the expensive global API on a failure. */
export function resolveStoryMemoryApi(
    entry: Pick<StoryTheaterEntry, 'memorySummaryApi'>,
    fallback: StoryMemoryApi,
): StoryMemoryApi {
    const own = normalizeStoryMemoryApi(entry.memorySummaryApi);
    if (!own) return fallback;
    const issue = storyMemoryApiValidationError(own);
    if (issue) throw new Error(issue + '；原文保持不变，不会自动改用主 API');
    return own;
}
