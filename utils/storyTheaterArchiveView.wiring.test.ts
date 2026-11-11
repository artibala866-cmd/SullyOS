import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    fileURLToPath(new URL('../components/date/story/StoryTheaterSession.tsx', import.meta.url)),
    'utf8',
).replace(/\r\n?/g, '\n');

const archivedBlock = source.slice(
    source.indexOf('const archived = mirrorArchived(message, entry);'),
    source.indexOf("if (message.role === 'user') return <section", source.indexOf('const archived = mirrorArchived(message, entry);')),
);

describe('剧情正常记忆归档原文入口', () => {
    it('连续归档段默认折叠，只有展开后才挂载原文和 HTML', () => {
        expect(archivedBlock).toContain('storyArchiveGroupKey(message, entry)');
        expect(archivedBlock).toContain("box ? '事件盒归档' : '角色记忆归档'");
        expect(archivedBlock).toContain('<details open={isExpanded}');
        expect(archivedBlock).toContain('archivedRows.map((row, index) =>');
        expect(archivedBlock).toContain('{isExpanded && <div');
        expect(archivedBlock).not.toContain('toggleAllArchives');
    });

    it('分页保留原始楼号，导出仍然读取全部数据库原文', () => {
        expect(source).toContain('messages.map((message, floorIndex) =>');
        expect(source).toContain('data-story-floor={floorIndexOffset + floorIndex + 1}');
        expect(source).toContain("data-story-load-more='true'");
        expect(source).toContain("title='导出全部剧情原文'");
        expect(source).toContain('const allMessages = (await DB.getMessagesByCharId(threadId, true))');
        expect(source).toContain('formatStoryTheaterExport(entry, mask.name, actors.map(actor => actor.name), allMessages)');
    });
});
