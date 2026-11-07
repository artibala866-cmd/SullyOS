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
    it('regeneration and conversion use the entry snapshot; standard character memory processing stays untouched', () => {
        expect(archiveEngine).toContain('generateStoryArchiveSummary(entry.title, messages, resolveStoryMemoryApi(entry, api))');
        expect(archives).toContain('const llm=resolveStoryMemoryApi(entry,memoryPalaceConfig.lightLLM?.baseUrl');
        expect(session).toContain('light = resolveStoryMemoryApi(entry, memoryPalaceConfig.lightLLM?.baseUrl');
        expect(session).toContain('processNewMessagesWithAutoArchive(recent, actor.id, actor.name, embedding, light');
    });
    it('UI is under the original 03 Memory section; selects global presets read-only, never updates global config', () => {
        expect(editor).toContain('03 / Memory');
        expect(editor).toContain('data-story-memory-api-settings');
        expect(editor).toContain('storyMemoryApiFromPreset(preset)');
        expect(editor).toContain("update('memorySummaryApi'");
        expect(editor).toContain("storyMemoryApiValidationError(normalizeStoryMemoryApi(draft.memorySummaryApi)!)");
        expect(editor).not.toContain('updateApiConfig(');
    });
    it('import/restoration keeps the dedicated configuration per story', () => {
        expect(story).toContain('memorySummaryApi: normalizeStoryMemoryApi(entry.memorySummaryApi)');
    });
});
