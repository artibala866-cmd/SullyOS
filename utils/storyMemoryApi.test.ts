import { describe, expect, it, vi } from 'vitest';
import type { APIConfig, ApiPreset } from '../types';
import { createStoryTheaterDraft, normalizeStoryTheater } from './storyTheater';
import { normalizeStoryMemoryApi, resolveStoryMemoryApi, storyMemoryApiFromPreset, storyMemoryApiValidationError } from './storyMemoryApi';

const globalApi: APIConfig = {
    baseUrl: 'https://expensive.invalid/v1', apiKey: 'pricey', model: 'expensive-model',
    stream: true, temperature: 0.8, visionApi: { enabled: true, baseUrl: 'https://vision.invalid/v1', apiKey: 'vision', model: 'vision' },
};
const cheap = { baseUrl: 'https://cheap.invalid/v1', apiKey: 'cheap-key', model: 'cheap-model' };

describe('per-story memory API isolation', () => {
    it('defaults to the previous memory provider for old stories', () => {
        const story = createStoryTheaterDraft();
        expect(story.memorySummaryApi).toBeUndefined();
        expect(resolveStoryMemoryApi(story, globalApi)).toBe(globalApi);
    });
    it('uses the complete secondary snapshot, never mutates the global or character API', () => {
        const story = { ...createStoryTheaterDraft(), memorySummaryApi: cheap };
        expect(resolveStoryMemoryApi(story, globalApi)).toEqual(cheap);
        expect(globalApi.model).toBe('expensive-model');
        expect(globalApi.visionApi?.model).toBe('vision');
        expect(story.memorySummaryApi).toEqual(cheap);
    });
    it('copies URL/Key/model from preset as an isolated snapshot; later preset edits do not affect it', () => {
        const preset: ApiPreset = { id: 'cheap', name: '便宜', config: { ...globalApi, ...cheap, stream: false, temperature: 0.2 } };
        const snapshot = storyMemoryApiFromPreset(preset);
        expect(snapshot).toEqual(cheap);
        expect(Object.keys(snapshot).sort()).toEqual(['apiKey', 'baseUrl', 'model']);
        preset.config.model = 'changed-later';
        expect(snapshot.model).toBe('cheap-model');
    });
    it('does not reset a configured cheap API on backup restore', () => {
        const restored = normalizeStoryTheater({ ...createStoryTheaterDraft(), memorySummaryApi: {
            baseUrl: ' https://cheap.invalid/v1/ ', apiKey: ' secret\u200b', model: ' cheap-model ',
        } });
        expect(restored.memorySummaryApi).toEqual({ ...cheap, apiKey: 'secret' });
        expect(normalizeStoryTheater(createStoryTheaterDraft()).memorySummaryApi).toBeUndefined();
    });
    it('never silently falls back to costly main API when secondary credentials are incomplete', () => {
        const story = { ...createStoryTheaterDraft(), memorySummaryApi: { baseUrl: 'https://cheap.invalid/v1', apiKey: '', model: '' } };
        expect(() => resolveStoryMemoryApi(story, globalApi)).toThrow('不会自动改用主 API');
        expect(storyMemoryApiValidationError(story.memorySummaryApi)).toContain('模型');
        expect(globalApi.apiKey).toBe('pricey');
    });
    it('rejects corrupt URLs, allows API proxies that require no Key', () => {
        for (const url of ['javascript:evil', 'file:///bad', 'ftp://wrong.invalid', 'not-an-url', 'https://me:pass@cheap.invalid/v1']) {
            expect(storyMemoryApiValidationError({ ...cheap, baseUrl: url })).not.toBeNull();
        }
        expect(storyMemoryApiValidationError({ ...cheap, apiKey: '' })).toBeNull();
        expect(normalizeStoryMemoryApi({ baseUrl: 23, model: [], apiKey: {} })).toEqual({ baseUrl: '', apiKey: '', model: '' });
    });
    it('switching off the secondary API returns only this story to its original fallback', () => {
        const on = { ...createStoryTheaterDraft(), memorySummaryApi: cheap };
        const off = { ...on, memorySummaryApi: undefined };
        expect(resolveStoryMemoryApi(on, globalApi).model).toBe('cheap-model');
        expect(resolveStoryMemoryApi(off, globalApi).model).toBe('expensive-model');
    });
    it('never makes network calls during preset selection or validation', () => {
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        try {
            const preset: ApiPreset = { id: 'a', name: 'test', config: { ...globalApi, ...cheap } };
            storyMemoryApiFromPreset(preset);
            resolveStoryMemoryApi({ memorySummaryApi: cheap }, globalApi);
            expect(fetcher).not.toHaveBeenCalled();
        } finally { vi.unstubAllGlobals(); }
    });
});
