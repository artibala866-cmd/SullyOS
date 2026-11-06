import { describe, expect, it } from 'vitest';
import { DB } from './db';
import { importEmojiDocument } from './emojiDocumentImport';
import { parseEmojiImportLine, planEmojiImport } from './emojiImport';

const asFile = (name: string, text: string) => ({
    name, size: new TextEncoder().encode(text).byteLength,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
});

describe('真实文件到数据库的全链路场景', () => {
    it('名称本身包含双横杠且图片网址也含双横杠时不能误切', () => {
        expect(parseEmojiImportLine('哭--笑--https://example.com/a--b.gif')).toEqual({
            name: '哭--笑', url: 'https://example.com/a--b.gif',
        });
    });
    it('CSV 换行和引号被 Word/Excel 包装后仍保留原名称', async () => {
        const csv = ['名称,图片链接','"开心','要抱抱","https://example.com/hug.gif"','"想""你","https://example.com/quote.png?x=1,2"'].join('\r\n');
        const result = await importEmojiDocument(asFile('导出.csv', csv));
        expect(result.entries).toEqual([
            { name: '开心 要抱抱', url: 'https://example.com/hug.gif' },
            { name: '想"你', url: 'https://example.com/quote.png?x=1,2' },
        ]);
    });
    it('CSV 缺少结束双引号时应拒绝，不能错配后面的图片', async () => {
        await expect(importEmojiDocument(asFile('损坏.csv', '"未闭合,https://example.com/a.png\n开心--https://example.com/b.png')))
            .rejects.toThrow('未闭合');
    });
    it('JSON 名称映射和具备自身名称的嵌套列表都保留人类名称', async () => {
        const doc = { name: '表情包名字', emojis: {
            开心: 'https://example.com/happy.gif',
            委屈: 'https://example.com/sad.png'
        }, metadata: { homepage: 'https://example.com' } };
        const result = await importEmojiDocument(asFile('表情.json', JSON.stringify(doc)));
        expect(result.entries).toEqual([
            { name: '开心', url: 'https://example.com/happy.gif' },
            { name: '委屈', url: 'https://example.com/sad.png' },
        ]);
        expect(result.entries.some(item => item.name === 'homepage')).toBe(false);
    });
    it('JSON 中合法记录旁的 null/空链接提示遗漏而非静默吞掉', async () => {
        const doc = [
            { name: '正常', url: 'https://example.com/ok.png' },
            { name: '缺链接', url: null },
            { name: '空链接', url: '' },
        ];
        const result = await importEmojiDocument(asFile('混合.json', JSON.stringify(doc)));
        expect(result.entries).toEqual([{ name: '正常', url: 'https://example.com/ok.png' }]);
        expect(result.suspiciousLines.join(' ')).toContain('缺链接');
        expect(result.suspiciousLines.join(' ')).toContain('空链接');
    });
    it('角色卡 JSON 的头像封面不能被误当表情，而表情映射的无扩展名直链仍保留', async () => {
        const data = {
            name: '示例角色', url: 'https://example.com/character.png', avatar: 'https://example.com/avatar.png',
            metadata: { icon: 'https://example.com/icon.png', homepage: 'https://example.com' },
            emojis: { '想你': 'https://example.com/image?id=123', '害羞': 'https://example.com/shy.gif' },
        };
        const rows = await importEmojiDocument(asFile('卡片.json', JSON.stringify(data)));
        expect(rows.entries).toEqual([
            { name: '想你', url: 'https://example.com/image?id=123' },
            { name: '害羞', url: 'https://example.com/shy.gif' },
        ]);
        expect(rows.entries.some(e => /avatar|icon/i.test(e.name))).toBe(false);
    });
    it('RTF 的 GBK 字节与 Unicode 反向兼容码不会丢名字或重复', async () => {
        const a = await importEmojiDocument(asFile('GBK.rtf', "{\\rtf1\\ansi\\ansicpg936 \\'b1\\'ed\\'c7\\'e9--https://example.com/a.gif\\par}"));
        const b = await importEmojiDocument(asFile('Unicode.rtf', "{\\rtf1\\ansi \\u20320?--https://example.com/u.png\\par}"));
        expect(a.entries).toEqual([{ name: '表情', url: 'https://example.com/a.gif' }]);
        expect(b.entries).toEqual([{ name: '你', url: 'https://example.com/u.png' }]);
    });
    it('已存在分类 A 的同名表情导入 B 后，两分类都能保存并重读', async () => {
        const n = '__qa_emoji_reopen_unique__';
        await DB.saveEmoji(n, 'https://example.com/funny.png', 'cat-a');
        const old = await DB.getEmojis();
        const plan = planEmojiImport([{ name: n, url: 'https://example.com/funny.png' }], old, 'cat-b');
        expect(plan.additions).toHaveLength(1);
        expect(plan.additions[0].name).not.toBe(n);
        await DB.saveEmojisBatch(plan.additions.map(e => ({ ...e, categoryId: 'cat-b' })));
        const reopened = await DB.getEmojis();
        expect(reopened.find(e => e.name === n)?.categoryId).toBe('cat-a');
        expect(reopened.find(e => e.name === plan.additions[0].name)?.categoryId).toBe('cat-b');
        expect(planEmojiImport([{ name: n, url: 'https://example.com/funny.png' }], reopened, 'cat-b').additions).toHaveLength(0);
    });
    it('同名冲突在事务中途触发时本批新表情回滚、旧表情仍可读', async () => {
        const existing = '__qa_existing_db__';
        const newcomer = '__qa_newcomer_db__';
        await DB.saveEmoji(existing, 'https://example.com/old.png', 'cat-a');
        await expect(DB.saveEmojisBatch([
            { name: newcomer, url: 'https://example.com/new.png', categoryId: 'cat-b' },
            { name: existing, url: 'https://example.com/overwrite.png', categoryId: 'cat-b' },
        ])).rejects.toBeTruthy();
        const reopened = await DB.getEmojis();
        expect(reopened.find(e => e.name === newcomer)).toBeUndefined();
        expect(reopened.find(e => e.name === existing)).toEqual({ name: existing, url: 'https://example.com/old.png', categoryId: 'cat-a' });
    });
});
