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

const isPdfFile = (file: Pick<File,'name'|'type'>): boolean =>
    file.type?.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file.name);
export function isImportedTextDocument(file: Pick<File,'name'|'type'>): boolean {
    // Android document providers sometimes assign "text/plain" to JSON card
    // exports. A recognized structured extension must take precedence over
    // generic MIME, otherwise the entire JSON becomes one constant lore entry.
    if (/\.(?:json|png|jpe?g|webp|gif|zip)$/i.test(file.name)) return false;
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
        // PDF.js and its worker are large; load them only when a PDF is chosen.
        const { extractPdfText } = await import('./pdfText');
        let result: Awaited<ReturnType<typeof extractPdfText>>;
        try {
            result = await extractPdfText(await file.arrayBuffer(), {
                maxPages: MAX_PDF_PAGES,
                requireAllPages: true,
                maxChars: MAX_IMPORTED_DOCUMENT_CHARS,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            if (message.includes('正文超过') || message.includes('超过 200 页')) throw error;
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

/** A filename is the only identity exported by a plain document.
 * Namespaced per kind; changed versions of the same file update safely,
 * while an unrelated Link/Tavern source can never be matched by its title. */
export const documentWorldbookImportKey = (filename: string): string =>
    'document-worldbook:' + filename.trim().normalize('NFC').toLocaleLowerCase('en-US');

export type UserBioImportMode = 'append' | 'replace';
export function planUserBioDocumentImport(
    current: string, incoming: string, mode: UserBioImportMode,
): { bio: string; changed: boolean } {
    const original = current || '';
    const existing = original.trim();
    const text = (incoming || '').trim();
    if (!text) throw new Error('文件正文为空');
    if (mode !== 'append' && mode !== 'replace') throw new Error('导入方式无效');
    if (mode === 'append' && existing) {
        // A partial substring is not an already-imported document. Only a
        // whole `\n\n`-separated section can count as an existing import.
        let at = existing.indexOf(text);
        while (at >= 0) {
            const before = at === 0 || existing.slice(at - 2, at) === '\n\n';
            const end = at + text.length;
            const after = end === existing.length || existing.slice(end, end + 2) === '\n\n';
            if (before && after) return {bio:current,changed:false};
            at = existing.indexOf(text, at + 1);
        }
    }
    // Keep handwritten indentation and trailing spacing intact. Trimming
    // the original biography before appending silently discarded user text.
    const separator = /\n\s*\n$/.test(original) ? ''
        : original.endsWith('\n') ? '\n' : '\n\n';
    const bio = mode === 'replace' || !existing ? text : original + separator + text;
    if (bio.length > MAX_IMPORTED_DOCUMENT_CHARS)
        throw new Error('导入后内容超过 200 万字符，请减少内容后重试');
    return {bio,changed:bio!==current};
}
