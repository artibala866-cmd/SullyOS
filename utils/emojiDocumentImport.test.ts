import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectEmojiDocumentRows, docxXmlToEmojiText, importEmojiDocument, reuniteWrappedImageUrls } from './emojiDocumentImport';
import { extractPdfEmojiLines } from './pdfText';

vi.mock('./pdfText', () => ({ extractPdfEmojiLines: vi.fn() }));

const asFile = (name: string, textOrBytes: string | ArrayBuffer) => {
    const bytes = typeof textOrBytes === 'string' ? new TextEncoder().encode(textOrBytes).buffer : textOrBytes;
    return { name, size: bytes.byteLength, arrayBuffer: async () => bytes } as File;
};

beforeEach(() => vi.clearAllMocks());

describe('表情文件导入（完全本地解析）', () => {
    it('TXT 同时识别 4 种旧新格式，还能容纳标题、序号和空行', async () => {
        const result = await importEmojiDocument(asFile('表情.txt', [
            '表情包目录',
            '1. 开心：https://files.catbox.moe/a.gif',
            '',
            '生气:http://files.catbox.moe/b.jpg',
            'https://files.catbox.moe/c.png 小狗',
            '害羞--https://files.catbox.moe/d.jpeg',
        ].join('\r\n')));
        expect(result.entries).toHaveLength(4);
        expect(result.text).toContain('小狗--https://files.catbox.moe/c.png');
        expect(result.ignoredLines).toBe(1);
    });

    it('支持中文 GB18030 和 UTF16 BOM 的 TXT', async () => {
        const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from(new TextEncoder().encode('A'))]);
        // Explicit UTF-16LE contents: "A--https://a.com/b.png".
        const word = 'A--https://a.com/b.png';
        const contents = new Uint8Array([0xff, 0xfe, ...Array.from(word).flatMap(c => [c.charCodeAt(0), 0])]);
        expect((await importEmojiDocument(asFile('a.txt', contents.buffer))).entries).toEqual([
            { name: 'A', url: 'https://a.com/b.png' },
        ]);
        expect(utf16[0]).toBe(0xff);
    });

    it('Word DOCX: 常规段落、双列表格、超链接可正确提取且无需外部 API', async () => {
        const xml = [
            '<w:document xmlns:w="w" xmlns:r="r"><w:body>',
            '<w:p><w:r><w:t>开心：</w:t></w:r><w:r><w:t>https://example.com/a.gif?x=1&amp;y=2</w:t></w:r></w:p>',
            '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>委屈</w:t></w:r></w:p></w:tc>',
            '<w:tc><w:p><w:r><w:t>https://example.com/b.png</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
            '<w:p><w:hyperlink r:id="rId8"><w:r><w:t>想你</w:t></w:r></w:hyperlink></w:p>',
            '</w:body></w:document>',
        ].join('');
        const rels = '<Relationships><Relationship Id="rId8" TargetMode="External" Target="https://example.com/c.gif"/></Relationships>';
        expect(docxXmlToEmojiText(xml, rels)).toContain('想你--https://example.com/c.gif');
        const zip = new JSZip();
        zip.file('word/document.xml', xml);
        zip.file('word/_rels/document.xml.rels', rels);
        const result = await importEmojiDocument(asFile('表情表.docx', await zip.generateAsync({ type: 'arraybuffer' })));
        expect(result.entries).toEqual([
            { name: '开心', url: 'https://example.com/a.gif?x=1&y=2' },
            { name: '委屈', url: 'https://example.com/b.png' },
            { name: '想你', url: 'https://example.com/c.gif' },
        ]);
    });

    it('CSV / TSV: 可处理表头、引号、带逗号查询参数及 URL 在前', async () => {
        const csv = [
            '名称,链接',
            '"想,你","https://example.com/a.gif?q=1,2"',
            'https://example.com/b.png,困',
        ].join('\n');
        expect((await importEmojiDocument(asFile('a.csv', csv))).entries).toEqual([
            { name: '想,你', url: 'https://example.com/a.gif?q=1,2' },
            { name: '困', url: 'https://example.com/b.png' },
        ]);
        expect((await importEmojiDocument(asFile('a.tsv', '委屈\thttps://example.com/c.png'))).entries)
            .toEqual([{ name: '委屈', url: 'https://example.com/c.png' }]);
    });

    it('Markdown / JSON / HTML / RTF 都转为同一表情格式', async () => {
        expect((await importEmojiDocument(asFile('a.md', [
            '# 表情',
            '- [开心](https://example.com/a.gif)',
            '| 失落 | https://example.com/b.png |',
        ].join('\n')))).entries).toHaveLength(2);
        expect((await importEmojiDocument(asFile('a.json', JSON.stringify([
            { name: '委屈', url: 'https://example.com/c.jpg' },
            { name: '撒娇', url: 'https://example.com/d.gif' },
        ])))).entries).toHaveLength(2);
        expect((await importEmojiDocument(asFile('a.html', [
            '<script>bad code</script>',
            '<img alt="爱你" src="https://example.com/e.gif">',
            '<table><tr><td>生气</td><td>https://example.com/f.png</td></tr></table>',
        ].join('\n')))).entries).toHaveLength(2);
        expect((await importEmojiDocument(asFile('a.rtf', '{\\rtf1\\ansi 开心--https://example.com/a.png\\par 生气：https://example.com/b.png}'))).entries).toHaveLength(2);
    });

    it('PDF 文件调用内置 PDF.js 文字提取，无法识别扫描件时明确拒绝', async () => {
        vi.mocked(extractPdfEmojiLines).mockResolvedValueOnce('标题\n开心--https://example.com/a.png\n悲伤：https://example.com/b.gif');
        const result = await importEmojiDocument(asFile('a.pdf', new Uint8Array([37, 80, 68, 70]).buffer));
        expect(result.entries).toHaveLength(2);
        expect(extractPdfEmojiLines).toHaveBeenCalledWith(expect.any(ArrayBuffer), 80);
        vi.mocked(extractPdfEmojiLines).mockResolvedValueOnce(' ');
        await expect(importEmojiDocument(asFile('scan.pdf', new ArrayBuffer(4)))).rejects.toThrow('扫描图片');
    });

    it('无效/加密文件、超大文件、传统 .doc 不伪装识别成功', async () => {
        await expect(importEmojiDocument(asFile('a.doc', 'old-binary'))).rejects.toThrow('另存为 .docx');
        await expect(importEmojiDocument(asFile('a.exe', 'hello'))).rejects.toThrow('不支持此文件类型');
        await expect(importEmojiDocument(asFile('broken.docx', 'not zip'))).rejects.toThrow('Word 文件无法解压');
        await expect(importEmojiDocument(asFile('not-stickers.txt', '这里没有图片链接'))).rejects.toThrow('未找到');
        const fake = { name: 'large.txt', size: 16 * 1024 * 1024 + 1, arrayBuffer: vi.fn() } as unknown as File;
        await expect(importEmojiDocument(fake)).rejects.toThrow('16MB');
        expect(fake.arrayBuffer).not.toHaveBeenCalled();
    });

    it('多行拆开的名称和链接，以及 PDF 视觉行中的链接在前、名字在后', () => {
        expect(collectEmojiDocumentRows([
            '表情包',
            '开心',
            'https://example.com/a.gif',
            'https://example.com/b.gif',
            '委屈',
        ].join('\n'))).toEqual({
            entries: [
                { name: '开心', url: 'https://example.com/a.gif' },
                { name: '委屈', url: 'https://example.com/b.gif' },
            ],
            ignoredLines: 1,
            suspiciousLines: [],
            generatedNames: 0,
        });
    });
    it('PDF 链接被排版断成两行时能重新拼接；残余无法匹配的网址会列入提醒', () => {
        const source = [
            '开心：https://files.catbox.moe/',
            '6j9ltv.jpeg',
            '委屈--https://example.com/a.',
            'png?token=2',
            '没有名字的网址：https://',
            '没有名字的网址 https://example.com/orphan.webp',
        ].join('\n');
        const merged = reuniteWrappedImageUrls(source);
        const rows = collectEmojiDocumentRows(merged);
        expect(rows.entries).toContainEqual({ name: '开心', url: 'https://files.catbox.moe/6j9ltv.jpeg' });
        expect(rows.entries).toContainEqual({ name: '委屈', url: 'https://example.com/a.png?token=2' });
    });

    it('手机文件管理器只有 MIME 没有文件扩展名时仍可导入 PDF 或 Word', async () => {
        vi.mocked(extractPdfEmojiLines).mockResolvedValueOnce('开心--https://example.com/a.jpg');
        const file = { ...asFile('content', new ArrayBuffer(2)), type: 'application/pdf' } as File;
        expect((await importEmojiDocument(file)).entries).toHaveLength(1);
    });

    it('没有匹配上的网址不会被假装为成功，且可以查阅示例', () => {
        const result = collectEmojiDocumentRows('说明\nhttps://example.com/orphan.png\n可爱--https://example.com/ok.png\n备用网址：https://');
        expect(result.entries).toContainEqual({ name: '可爱', url: 'https://example.com/ok.png' });
        expect(result.suspiciousLines.length).toBeGreaterThan(0);
    });

    it('仅网址文件也可以导入，图片名称取自真实文件名，普通网页链接不会误导入', async () => {
        const result = await importEmojiDocument(asFile('裸链接.txt', [
            '表情包合集',
            'https://files.catbox.moe/6j9ltv.jpeg',
            'https://example.com/images/smile-cat.gif?download=1',
            'https://example.com/introduction',
        ].join('\n')));
        expect(result.entries).toEqual([
            { name: '6j9ltv', url: 'https://files.catbox.moe/6j9ltv.jpeg' },
            { name: 'smile-cat', url: 'https://example.com/images/smile-cat.gif?download=1' },
        ]);
        expect(result.generatedNames).toBe(2);
        expect(result.suspiciousLines).toContain('https://example.com/introduction');
    });

    it('文档标题不能被当成下一行图片的网址名称', () => {
        const rows = collectEmojiDocumentRows([
            '表情包目录',
            'https://example.com/a.gif',
            '开心',
            'https://example.com/b.png',
        ].join('\n'));
        expect(rows.entries).toEqual([
            { name: 'a', url: 'https://example.com/a.gif' },
            { name: '开心', url: 'https://example.com/b.png' },
        ]);
    });

    it('旧 .doc 若实际为 HTML/RTF 可以导入；真正二进制文件才提示另存 DOCX', async () => {
        const file = asFile('word.doc', '<html><body>开心：https://example.com/a.png</body></html>');
        expect((await importEmojiDocument(file)).entries).toContainEqual({ name: '开心', url: 'https://example.com/a.png' });
        await expect(importEmojiDocument(asFile('word.doc', 'word-binary-data'))).rejects.toThrow('另存为 .docx');
    });

});
