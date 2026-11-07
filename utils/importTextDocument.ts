import { isPdfFile, extractPdfText } from './pdfText';
import { isLinkPersonaDocument, readLinkPersonaDocument } from './linkImportDocuments';

/** All three import surfaces use ONE parser; no hidden format-specific
 * transformations of the person's biography or worldbook prose. */
export const DOCUMENT_IMPORT_ACCEPT =
    '.txt,.text,.doc,.docx,.pdf,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const MAX_IMPORTED_DOCUMENT_CHARS = 2_000_000;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 200;

export interface ImportedTextDocument {
    text: string;
    format: 'TXT' | 'Word' | 'PDF';
    pageCount?: number;
}

export function isImportedTextDocument(file: Pick<File,'name'|'type'>): boolean {
    return isPdfFile(file) || isLinkPersonaDocument(file);
}

export async function readImportedTextDocument(file: File): Promise<ImportedTextDocument> {
    if (!isImportedTextDocument(file))
        throw new Error('请选择 TXT、DOC、DOCX 或 PDF 文件');
    if (!file.size || file.size > MAX_DOCUMENT_BYTES)
        throw new Error('文档为空或超过 25 MB');
    const pdf = isPdfFile(file);
    const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isPdfBytes = signature.length >= 5 &&
        signature[0] === 0x25 && signature[1] === 0x50 && signature[2] === 0x44 &&
        signature[3] === 0x46 && signature[4] === 0x2d;
    if (pdf && !isPdfBytes)
        throw new Error('文件名是 PDF，但正文并非有效 PDF 文件');
    if (!pdf && isPdfBytes)
        throw new Error('文件内容是 PDF，请改用 .pdf 文件后导入');

    if (pdf) {
        let result: Awaited<ReturnType<typeof extractPdfText>>;
        try {
            result = await extractPdfText(await file.arrayBuffer(), {
                maxPages: MAX_PDF_PAGES,
                maxChars: MAX_IMPORTED_DOCUMENT_CHARS,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            if (message.includes('正文超过')) throw error;
            throw new Error(/password|encrypted/i.test(message)
                ? 'PDF 已加密，请先解除密码保护后导入'
                : 'PDF 文件损坏、受保护或暂时无法读取');
        }
        if (result.pageCount > result.extractedPages)
            throw new Error('PDF 超过 200 页，请拆分后导入；不会只导入前几页');
        const text = result.text.replace(/\r\n?/g, '\n').trim();
        if (!text)
            throw new Error('PDF 没有可提取的文字，扫描图片版请先转换为可搜索 PDF');
        if (text.length > MAX_IMPORTED_DOCUMENT_CHARS)
            throw new Error('PDF 正文超过 200 万字符，请拆分后导入');
        return { text, format: 'PDF', pageCount: result.pageCount };
    }
    const text = await readLinkPersonaDocument(file);
    return { text, format: /\.(?:docx?|DOCX?)$/i.test(file.name) ||
        /msword|wordprocessingml/i.test(file.type) ? 'Word' : 'TXT' };
}

export type UserBioImportMode = 'append' | 'replace';
export function planUserBioDocumentImport(
    current: string, incoming: string, mode: UserBioImportMode,
): { bio: string; changed: boolean } {
    const existing = (current || '').trim();
    const text = (incoming || '').trim();
    if (!text) throw new Error('文件正文为空');
    if (mode !== 'append' && mode !== 'replace') throw new Error('导入方式无效');
    if (mode === 'append' && existing.includes(text)) return {bio:current,changed:false};
    const bio = mode === 'replace' || !existing ? text : existing + '\n\n' + text;
    if (bio.length > MAX_IMPORTED_DOCUMENT_CHARS)
        throw new Error('导入后内容超过 200 万字符，请减少内容后重试');
    return {bio,changed:bio!==current};
}
