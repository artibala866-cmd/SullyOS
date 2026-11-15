import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('剧情归档建议长度全链路', () => {
    it('编辑页保留可编辑的保存上限，但不展示额外解释', () => {
        const editor = read('../components/date/story/StoryTheaterEditor.tsx');
        expect(editor).toContain("aria-label='归档保存上限'");
        expect(editor).toContain("archiveSummaryGuideMaxChars, presetId");
        expect(editor).not.toContain('超出也完整保存、不截断');
        expect(editor).not.toContain('后续续写可能增加费用');
    });
    it('自动归档、手动归档、重新总结都读取本剧情设置', () => {
        const archive = read('./storyTheaterArchive.ts');
        const session = read('../components/date/story/StoryTheaterSession.tsx');
        expect(session).toMatch(/generateStoryArchiveDelta\(\s*archiveEntry,/);
        expect(archive).toContain('generateStoryArchiveDelta(entry, messages, archiveApi, firstFloor');
        expect(archive).toContain('generateStoryArchiveDelta({ ...entry, archives: initial.others }');
        expect(archive).toContain('normalizeStoryArchiveGuideMaxChars(entry.archiveSummaryGuideMaxChars)');
        expect(archive).not.toContain('max_tokens: 4096');
        expect(archive).toContain('storyArchiveCharacterCount(summary) > saveMaxChars');
    });
});
