import { DB } from './db';
import { describe, expect, it } from 'vitest';
import { formatEmojiImportText, parseEmojiImportLine, parseEmojiImportText, planEmojiImport } from './emojiImport';

describe('私聊表情智能导入安全回归', () => {
    it('兼容所有四种格式并标准化为糯米机原格式', () => {
        const parsed = parseEmojiImportText([
            '可爱：https://files.catbox.moe/a.gif',
            '生气:http://files.catbox.moe/b.png',
            'https://files.catbox.moe/c.jpeg 小狗委屈',
            '开心--https://files.catbox.moe/d.jpg',
        ].join('\r\n'));
        expect(parsed.invalidLineNumbers).toEqual([]);
        expect(parsed.entries).toHaveLength(4);
        expect(formatEmojiImportText(parsed.entries)).toBe([
            '可爱--https://files.catbox.moe/a.gif',
            '生气--http://files.catbox.moe/b.png',
            '小狗委屈--https://files.catbox.moe/c.jpeg',
            '开心--https://files.catbox.moe/d.jpg',
        ].join('\n'));
    });

    it('同时支持有空格的中文名字、链接查询参数、链接里的冒号/双横杠和旧 data URL', () => {
        expect(parseEmojiImportText([
            '心 情： https://example.com/a--b.gif?x=1:2&lang=zh',
            'https://example.com/p.png?q=a%20b　小狗 开心',
            '本地图--data:image/png;base64,iVBORw0KGgo=',
        ].join('\n')).entries).toEqual([
            { name: '心 情', url: 'https://example.com/a--b.gif?x=1:2&lang=zh' },
            { name: '小狗 开心', url: 'https://example.com/p.png?q=a%20b' },
            { name: '本地图', url: 'data:image/png;base64,iVBORw0KGgo=' },
        ]);
    });

    it('错误格式绝不静默接受：无名、空链接、非法协议与裸 URL 中的双横杠', () => {
        const invalid = [
            '孤单名字',
            'https://example.com/none.png',
            '无效--not-a-link',
            '无效--javascript:alert(1)',
            'https://example.com/a--b.gif',
            '空的：http://',
            ':https://example.com/a.jpg',
        ];
        for (const input of invalid) expect(parseEmojiImportLine(input)).toBeNull();
        const parsed = parseEmojiImportText(['\uFEFF开心：https://example.com/o.gif', '', ...invalid].join('\r\n'));
        expect(parsed.entries).toEqual([{ name: '开心', url: 'https://example.com/o.gif' }]);
        expect(parsed.invalidLineNumbers).toEqual([3, 4, 5, 6, 7, 8, 9]);
    });

    it('同名不同图片自动后缀，但不破坏原分类且重导不会重复', () => {
        const existing = [
            { name: '开心', url: 'https://example.com/old.png' },
            { name: '开心（2）', url: 'https://example.com/second.png' },
        ];
        const incoming = [
            { name: '开心', url: 'https://example.com/new.gif' },
            { name: '开心', url: 'https://example.com/old.png' },
            { name: '开心', url: 'https://example.com/another.png' },
        ];
        const planned = planEmojiImport(incoming, existing);
        expect(planned).toEqual({
            additions: [
                { name: '开心（3）', url: 'https://example.com/new.gif' },
                { name: '开心（4）', url: 'https://example.com/another.png' },
            ],
            skipped: 1,
            renamed: 2,
        });
        const repeated = planEmojiImport(incoming, [...existing, ...planned.additions]);
        expect(repeated.additions).toEqual([]);
        expect(repeated.skipped).toBe(3);
    });

    it('兼容旧版站内图片路径与 BlobRef，避免格式升级破坏原有图片', () => {
        expect(parseEmojiImportText([
            '自带贴纸--/assets/stickers/hello.png',
            '本机旧图--blobref:b_example123',
        ].join('\n')).entries).toEqual([
            { name: '自带贴纸', url: '/assets/stickers/hello.png' },
            { name: '本机旧图', url: 'blobref:b_example123' },
        ]);
    });

    it('同一张表情导入不同分类会另存，不会因为其他分类已有同名就消失', () => {
        const first = { name: '开心', url: 'https://example.com/happy.gif', categoryId: 'cat-a' };
        const targetCopy = planEmojiImport(
            [{ name: '开心', url: first.url }],
            [first],
            'cat-b'
        );
        expect(targetCopy).toEqual({
            additions: [{ name: '开心（2）', url: first.url }],
            renamed: 1,
            skipped: 0,
        });
        const second = { ...targetCopy.additions[0], categoryId: 'cat-b' };
        const again = planEmojiImport([{ name: '开心', url: first.url }], [first, second], 'cat-b');
        expect(again).toEqual({ additions: [], renamed: 0, skipped: 1 });
        expect(planEmojiImport([{ name: '开心', url: first.url }], [first], 'cat-a').skipped).toBe(1);
    });

    it('新批次内重复的名字和 URL 自动去重，同 URL 不同名字仍可独立存在', () => {
        const a = 'https://example.com/a.gif';
        expect(planEmojiImport([
            { name: '哭', url: a },
            { name: '哭', url: a },
            { name: '另一个名字', url: a },
            { name: '哭', url: 'https://example.com/b.png' },
        ], [])).toEqual({
            additions: [
                { name: '哭', url: a },
                { name: '另一个名字', url: a },
                { name: '哭（2）', url: 'https://example.com/b.png' },
            ],
            skipped: 1,
            renamed: 1,
        });
    });
});


describe('表情批量写入原子性与跨分类保护', () => {
    it('表情批量事务遇到冲突时整批回滚，老名称的图片与分类均不受影响', async () => {
        const oldName = 'emoji-import-atomic-existing';
        const firstName = 'emoji-import-atomic-first';
        await DB.saveEmoji(oldName, 'https://example.com/original.gif', 'cat-original');
        await expect(DB.saveEmojisBatch([
            { name: firstName, url: 'https://example.com/new.gif', categoryId: 'cat-target' },
            { name: oldName, url: 'https://example.com/overwrite.gif', categoryId: 'cat-target' },
        ])).rejects.toBeTruthy();
        const afterFailed = await DB.getEmojis();
        expect(afterFailed.find(e => e.name === oldName)).toEqual({
            name: oldName, url: 'https://example.com/original.gif', categoryId: 'cat-original',
        });
        expect(afterFailed.find(e => e.name === firstName)).toBeUndefined();

        await DB.saveEmojisBatch([
            { name: firstName, url: 'https://example.com/new.gif', categoryId: 'cat-target' },
            { name: 'emoji-import-atomic-second', url: 'https://example.com/2.gif', categoryId: 'cat-target' },
        ]);
        const saved = await DB.getEmojis();
        expect(saved.filter(e => e.name.startsWith('emoji-import-atomic-'))).toHaveLength(3);
        expect(saved.find(e => e.name === firstName)?.categoryId).toBe('cat-target');
    });
});
