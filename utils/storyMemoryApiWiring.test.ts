import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const session = read('../components/date/story/StoryTheaterSession.tsx');
const archives = read('../components/date/story/StoryArchivePanel.tsx');
const archiveEngine = read('./storyTheaterArchive.ts');
const editor = read('../components/date/story/StoryTheaterEditor.tsx');
const story = read('./storyTheater.ts');

describe('per-story API uses only memory call sites', () => {
    it('auto event box calls the isolated summary endpoint, not global prose endpoint', () => {
        expect(session).toContain('generateStoryArchiveSummary(archiveEntry.title, batch, resolveStoryMemoryApi(archiveEntry, apiConfig))');
        expect(session).toContain('const response = await fetch(');
        expect(session).toContain("const generationSettings = prepareStoryGenerationSettings(settings, entry.omitSamplingParams === true, apiConfig.model)");
    });
    it('vector extraction uses only story override for LLM and retains existing embedding configuration', () => {
        expect(session).toContain('const light = resolveStoryMemoryApi(archiveEntry, memoryPalaceConfig.lightLLM?.baseUrl');
        expect(session).toContain('processMessageRange(threadId, archiveEntry.title, embedding, light, first.id, last.id');
        expect(session).toContain('const embedding = memoryPalaceConfig.embedding');
    });
    it('event box regeneration is story-specific, but conversion and real companionship use shared-character memory settings', () => {
        expect(archiveEngine).toContain('generateStoryArchiveSummary(entry.title, messages, resolveStoryMemoryApi(entry, api))');
        expect(archives).toContain('const llm=memoryPalaceConfig.lightLLM?.baseUrl?memoryPalaceConfig.lightLLM:apiConfig;');
        expect(archives).not.toContain('resolveStoryMemoryApi(');
        const actorMemory = session.split('const applyActorMemoryPipeline =')[1].split('const archiveIfNeeded =')[0];
        expect(actorMemory).not.toContain('resolveStoryMemoryApi(');
        expect(actorMemory).toContain('const light = memoryPalaceConfig.lightLLM?.baseUrl');
        expect(actorMemory).toContain('processNewMessagesWithAutoArchive(recent, actor.id, actor.name, embedding, light');
        expect(actorMemory).toContain('runCognitiveDigestion(actor.id,');
    });
    it('the expensive prose request keeps its original URL, Key, Model and sampling settings', () => {
        const prose = session.split('const callCompletion =')[1].split('const saveCentralAndMirrors =')[0];
        expect(prose).toContain("assertStoryApiConfigured(apiConfig)");
        expect(prose).toContain("prepareStoryGenerationSettings(settings, entry.omitSamplingParams === true, apiConfig.model)");
        expect(prose).toContain("fetch(`${apiConfig.baseUrl.replace(/\\/+$/, '')}/chat/completions`");
        expect(prose).toContain("Authorization': `Bearer ${apiConfig.apiKey}`");
        expect(prose).toContain('model: apiConfig.model');
        expect(prose).not.toContain('memorySummaryApi');
        expect(prose).not.toContain('resolveStoryMemoryApi');
        expect(session).toContain('promptEntry.archives.filter(archive => archive.summary)');
    });
    it('UI is under the original 03 Memory section; selects global presets read-only, never updates global config', () => {
        expect(editor).toContain('03 / Memory');
        expect(editor).toContain('data-story-memory-api-settings');
        expect(editor).toContain('storyMemoryApiFromPreset(preset)');
        expect(editor).toContain("update('memorySummaryApi'");
        expect(editor).toContain("storyMemoryApiValidationError(normalizeStoryMemoryApi(draft.memorySummaryApi)!)");
        expect(editor).not.toContain('updateApiConfig(');
        expect(editor).toContain('normalizeApiPresets(apiPresets)');
        expect(editor).toContain('storyMemoryApiSharesGateway(draft.memorySummaryApi, mainApi)');
    });
    it('import/restoration keeps the dedicated configuration per story', () => {
        expect(story).toContain('memorySummaryApi: normalizeStoryMemoryApi(entry.memorySummaryApi)');
    });
});
