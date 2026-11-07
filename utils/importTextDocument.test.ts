import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { readCharacterCardFile } from './sillyTavernCard';
import { DOCUMENT_IMPORT_ACCEPT, documentWorldbookImportKey, isImportedTextDocument, planUserBioDocumentImport, readImportedTextDocument } from './importTextDocument';

const mocks = vi.hoisted(() => ({ pdf: vi.fn() }));
vi.mock('./pdfText', async () => {
    const real = await vi.importActual<typeof import('./pdfText')>('./pdfText');
    return { ...real, extractPdfText: mocks.pdf };
});
afterEach(() => mocks.pdf.mockReset());
const file = (contents: string, name: string, type = '') =>
    new File([contents], name, { type });
const validPdf = (name = '角色背景.pdf') => file('%PDF-1.4\nfake-bytes', name, 'application/pdf');

describe('shared TXT / Word / PDF document import', () => {
    it('detects supported formats without treating arbitrary JSON/image files as documents', () => {
        for (const name of ['x.TXT','x.text','x.doc','x.DOCX','x.PDF'])
            expect(isImportedTextDocument({ name, type: '' })).toBe(true);
        expect(isImportedTextDocument({ name: 'x.json', type: 'application/json' })).toBe(false);
        expect(isImportedTextDocument({ name: 'x.png', type: 'image/png' })).toBe(false);
        expect(DOCUMENT_IMPORT_ACCEPT).toContain('.pdf');
    });
    it('structured extensions win over Android mislabelled text/plain MIME',()=>{
        for(const filename of ['书籍.json','人物.png','人物.webp','压缩包.zip']){
            expect(isImportedTextDocument({name:filename,type:'text/plain'})).toBe(false);
        }
        expect(isImportedTextDocument({name:'书籍.JSON',type:'text/plain'})).toBe(false);
        expect(isImportedTextDocument({name:'日记.txt',type:'application/octet-stream'})).toBe(true);
        expect(documentWorldbookImportKey('世界观.PDF')).toBe(documentWorldbookImportKey('世界观.pdf'));
        expect(documentWorldbookImportKey('世界观.docx')).not.toBe(documentWorldbookImportKey('世界观.pdf'));
    });

    it('preserves UTF-8/GBK/UTF-16 TXT and multi-paragraph Word content', async () => {
        const utf8 = await readImportedTextDocument(file('角色设定第一段\n第二段','人设.txt'));
        expect(utf8).toMatchObject({ format:'TXT', text:'角色设定第一段\n第二段' });
        const gbk = new File([new Uint8Array([0xc4,0xe3,0xba,0xc3])],'gbk.txt');
        expect((await readImportedTextDocument(gbk)).text).toBe('你好');
        const utf16 = new File([new Uint8Array([0xff,0xfe,0x60,0x4f,0x7d,0x59])],'utf16.txt');
        expect((await readImportedTextDocument(utf16)).text).toBe('你好');
        const zip = new JSZip();
        zip.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>角色介绍</w:t></w:r></w:p><w:p><w:r><w:t>我的经历</w:t></w:r></w:p></w:body></w:document>');
        const doc = new File([Uint8Array.from(await zip.generateAsync({type:'uint8array'})).buffer], '我的角色.docx');
        const word = await readImportedTextDocument(doc);
        expect(word).toMatchObject({format:'Word',text:'角色介绍\n我的经历'});
    });
    it('rejects binary legacy DOC, disguised PDF and false DOCX without storing garbage', async () => {
        const cfb = new File([new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1,0,1,2])],'old.doc');
        await expect(readImportedTextDocument(cfb)).rejects.toThrow('二进制 DOC');
        await expect(readImportedTextDocument(file('not actually a pdf','fake.pdf'))).rejects.toThrow('并非有效 PDF');
        await expect(readImportedTextDocument(file('%PDF-1.4\npayload','fake.txt'))).rejects.toThrow('文件内容是 PDF');
        await expect(readImportedTextDocument(file('random word','fake.docx'))).rejects.toThrow('DOCX');
        expect(mocks.pdf).not.toHaveBeenCalled();
    });
    it('PDF retains all pages, Chinese and paragraph breaks without injecting file metadata', async () => {
        mocks.pdf.mockResolvedValue({
            text:'身份：教师\n\n旅行经历：看海',pageCount:3,extractedPages:3,
        });
        const result=await readImportedTextDocument(validPdf());
        expect(result).toEqual({ text:'身份：教师\n\n旅行经历：看海',format:'PDF',pageCount:3 });
        expect(mocks.pdf).toHaveBeenCalledWith(expect.any(ArrayBuffer),
            expect.objectContaining({maxPages:200,maxChars:2_000_000,requireAllPages:true}));
        const character=await readCharacterCardFile(validPdf('旅行者.pdf'));
        if (character.source==='babylink') throw Error('PDF wrongly identified as Link');
        expect(character.character.name).toBe('旅行者');
        expect(character.character.systemPrompt).toContain('旅行经历：看海');
        expect(character.character.description).toBe('');
        expect(character.worldbooks).toEqual([]);
    });
    it('PDF refuses scanned images, partial pages, protected PDFs and large extracted text', async () => {
        mocks.pdf.mockResolvedValueOnce({text:'',pageCount:1,extractedPages:1});
        await expect(readImportedTextDocument(validPdf())).rejects.toThrow('扫描图片版');
        mocks.pdf.mockResolvedValueOnce({text:'仅前两页',pageCount:205,extractedPages:200});
        await expect(readImportedTextDocument(validPdf())).rejects.toThrow('超过 200 页');
        mocks.pdf.mockRejectedValueOnce(new Error('PasswordException: encrypted'));
        await expect(readImportedTextDocument(validPdf())).rejects.toThrow('密码');
        mocks.pdf.mockResolvedValueOnce({text:'A'.repeat(2_000_001),pageCount:2,extractedPages:2});
        await expect(readImportedTextDocument(validPdf())).rejects.toThrow('超过 200 万字符');
        mocks.pdf.mockRejectedValueOnce(new Error('PDF 正文超过 200 万字符，请拆分后导入'));
        await expect(readImportedTextDocument(validPdf())).rejects.toThrow('超过 200 万字符');
    });
    it('rejects empty / oversized / unsupported formats without partially importing', async () => {
        await expect(readImportedTextDocument(file('','empty.txt'))).rejects.toThrow('文档为空');
        await expect(readImportedTextDocument(file('{}','not-a-card.json'))).rejects.toThrow('请选择');
        await expect(readImportedTextDocument(new File([new Uint8Array(26*1024*1024)],'large.pdf')))
            .rejects.toThrow('超过 25 MB');
    });
});

describe('user archive document import merge', () => {
    it('appends by default and does not erase previous manually entered biography', () => {
        expect(planUserBioDocumentImport('我喜欢画画','目前住在海边','append')).toEqual({
            bio:'我喜欢画画\n\n目前住在海边',changed:true,
        });
        expect(planUserBioDocumentImport('','新档案','append')).toEqual({bio:'新档案',changed:true});
    });
    it('does not skip a new document merely because its words occur inside an existing sentence',()=>{
        const existing='我的旧设定里喜欢绘画，也喜欢旅游。';
        expect(planUserBioDocumentImport(existing,'喜欢绘画','append')).toEqual({
            bio:existing+'\n\n喜欢绘画',changed:true,
        });
        expect(planUserBioDocumentImport('自传：第一章'+'\n\n'+'爱好：画画','第一章','append').changed).toBe(true);
    });

    it('repeated identical import is idempotent, even in the middle of a longer profile', () => {
        const old='起初\n\n过去的经历\n\n结尾';
        expect(planUserBioDocumentImport(old,'过去的经历','append')).toEqual({bio:old,changed:false});
    });
    it('replace requires an explicit chosen mode, never triggered by parsing alone', () => {
        expect(planUserBioDocumentImport('原档案','新档案','replace')).toEqual({bio:'新档案',changed:true});
        expect(() => planUserBioDocumentImport('旧版',' ', 'replace')).toThrow('正文为空');
        expect(() => planUserBioDocumentImport('旧版','新版','invalid' as never)).toThrow('导入方式无效');
    });
    it('rejects a combined bio too long instead of cutting off important sections', () => {
        expect(() => planUserBioDocumentImport('A'.repeat(2_000_000),'新增段落','append')).toThrow('超过 200 万字符');
    });
});
