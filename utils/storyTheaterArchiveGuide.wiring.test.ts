import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('剧情归档建议长度全链路', () => {
    it('编辑页可更改并持久化建议值，不显示为硬截断', () => {
        const editor = read('../components/date/story/StoryTheaterEditor.tsx');
        expect(editor).toContain("aria-label='归档建议上限'");
        expect(editor).toContain("archiveSummaryGuideMaxChars, presetId");
        expect(editor).toContain('超出也完整保存、不截断');
        expect(editor).toContain('后续续写可能增加费用');
    });
    it('自动归档、手动归档、重新总结都读取本剧情设置', () => {
        const archive = read('./storyTheaterArchive.ts');
        const session = read('../components/date/story/StoryTheaterSession.tsx');
        expect(session).toContain('guideMaxChars: archiveEntry.archiveSummaryGuideMaxChars');
        expect(archive).toContain('guideMaxChars: entry.archiveSummaryGuideMaxChars');
        expect(archive).not.toContain('max_tokens: 4096');
        expect(archive).not.toContain('STORY_ARCHIVE_MAX_CHARS');
        expect(archive).toContain('splitStoryArchiveVectorText(summary, EMBEDDING_MAX_INPUT_CHARS)');
    });
});
