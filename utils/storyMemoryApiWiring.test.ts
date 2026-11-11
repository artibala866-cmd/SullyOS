import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const session = read('../components/date/story/StoryTheaterSession.tsx');
const archives = read('../components/date/story/StoryArchivePanel.tsx');
const archiveEngine = read('./storyTheaterArchive.ts');
const editor = read('../components/date/story/StoryTheaterEditor.tsx');
const story = read('./storyTheater.ts');
const fetchMiddleware = read('../context/OSContext.tsx');
const extraction = read('./memoryPalace/extraction.ts');
const pipeline = read('./memoryPalace/pipeline.ts');

describe('per-story API uses only memory call sites', () => {
    it('auto event box calls the isolated summary endpoint, not global prose endpoint', () => {
        expect(session).toContain('generateStoryArchiveSummary(archiveEntry.title, batch, resolveStoryMemoryApi(archiveEntry, apiConfig), {');
        const archive = session.split('const archiveIfNeeded =')[1].split('const send =')[0];
        expect(archive).not.toContain('callCompletion(');
        expect(archive).not.toContain('/chat/completions');
    });
    it('requires an explicit per-story opt-in for automatic API memory', () => {
        expect(story).toContain('automaticMemoryApiEnabled: entry.automaticMemoryApiEnabled === true');
        expect(session).toContain('automaticMemoryApiEnabled ? await archiveIfNeeded() : null');
        expect(session).toContain('if (interruption || !automaticMemoryApiEnabled) return;');
        expect(session).toContain('entry.automaticMemoryApiEnabled === true && actor.memoryPalaceEnabled');
        expect(session).toContain('entry.automaticMemoryApiEnabled === true && maskCharacter.memoryPalaceEnabled');
        expect(session).toContain('automaticMemoryApiEnabled ? memoryPalaceConfig.embedding : undefined');
    });
    it('never sends a second failed preflight summary in the same expensive prose turn', () => {
        expect(session).toContain('const archiveErrorSeq = useRef(0)');
        expect(session).toContain('const failedArchiveBeforeProse = archiveErrorSeq.current !== previousArchiveErrors');
        expect(session).toContain('else if (!archiveBeforeProse && !failedArchiveBeforeProse) await archiveIfNeeded(promptEntry)');
    });
    it('vector extraction uses only story override for LLM and retains existing embedding configuration', () => {
        expect(session).toContain('archiveStoryVectorRangeInGeneration(archiveEntry.id, batch, apiConfig');
        expect(session).toContain('embedding: memoryPalaceConfig.embedding');
        expect(archiveEngine).toContain('resolveStoryMemoryApi(entry, vector?.fallbackApi ?? api)');
        expect(archiveEngine).toContain('await vectorizeAndStore([node], { ...embedding, requestPurpose:');
    });
    it('event box regeneration is story-specific, but conversion and real companionship use shared-character memory settings', () => {
        expect(archiveEngine).toContain('generateStoryArchiveSummary(entry.title, messages, resolveStoryMemoryApi(entry, api), {');
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
        expect(session).toContain('selectStoryArchiveContext(promptEntry.archives, turnBoundary)');
    });
    it('main API stream preference must not transparently rewrite the story-only secondary endpoint', () => {
        expect(fetchMiddleware).toContain("(config as any)?.__sullySkipStreamUpgrade !== true");
        expect(archiveEngine).toContain("__sullySkipStreamUpgrade: true");
        expect(extraction).toContain('llmConfig.skipGlobalStreamUpgrade ? { __sullySkipStreamUpgrade: true }');
        expect(pipeline).toContain('skipGlobalStreamUpgrade?: boolean');
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
