import type JSZip from 'jszip';
import {
    formatEmojiImportText, parseEmojiImportLine, type EmojiImportEntry,
} from './emojiImport';

/** Browser-side document import; no uploads or AI/API calls. */
export const EMOJI_DOCUMENT_FILE_ACCEPT = '.txt,.text,.md,.markdown,.csv,.tsv,.json,.html,.htm,.rtf,.doc,.docx,.pdf';
export const EMOJI_DOCUMENT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_TEXT_LENGTH = 2_000_000;
const MAX_IMPORT_ENTRIES = 3000;

export interface EmojiDocumentResult {
    entries: EmojiImportEntry[];
    text: string;
    ignoredLines: number;
    name: string;
}

type ReadableFile = Pick<File, 'name' | 'size' | 'arrayBuffer'>;

const decodeEntities = (s: string): string => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, value: string) => {
    const token = value.toLowerCase();
    if (token === 'amp') return '&';
    if (token === 'lt') return '<';
    if (token === 'gt') return '>';
    if (token === 'quot') return '"';
    if (token === 'apos') return "'";
    if (token === 'nbsp') return ' ';
    if (token.startsWith('#')) {
        const code = token.startsWith('#x') ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return _match;
});

function decodePlainText(bytes: ArrayBuffer): string {
    const a = new Uint8Array(bytes);
    if (a[0] === 0xff && a[1] === 0xfe) return new TextDecoder('utf-16le').decode(a.subarray(2));
    if (a[0] === 0xfe && a[1] === 0xff) return new TextDecoder('utf-16be').decode(a.subarray(2));
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(a).replace(/^\uFEFF/, '');
    } catch {
        // Some shared Chinese TXT files were saved as GB18030/GBK.
        try { return new TextDecoder('gb18030', { fatal: true }).decode(a).replace(/^\uFEFF/, ''); }
        catch { return new TextDecoder('utf-8').decode(a).replace(/^\uFEFF/, ''); }
    }
}

const xmlText = (fragment: string): string => {
    const parts: string[] = [];
    const tokens = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/gi;
    for (const token of fragment.matchAll(tokens)) {
        if (token[1] !== undefined) parts.push(decodeEntities(token[1]));
        else if (/^<w:tab/i.test(token[0])) parts.push('\t');
        else parts.push('\n');
    }
    return parts.join('');
};

function docxRelationships(xml: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const rel of xml.matchAll(/<Relationship\b([^>]*?)\/?>/gi)) {
        const id = /\bId="([^"]+)"/.exec(rel[1])?.[1];
        const target = /\bTarget="([^"]+)"/.exec(rel[1])?.[1];
        const mode = /\bTargetMode="([^"]+)"/.exec(rel[1])?.[1];
        if (id && target && mode === 'External' && /^https?:\/\//i.test(decodeEntities(target))) {
            map.set(id, decodeEntities(target));
        }
    }
    return map;
}

export function docxXmlToEmojiText(documentXml: string, relationshipsXml = ''): string {
    const links = docxRelationships(relationshipsXml);
    const paragraphs: string[] = [];
    const paras = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gi;
    for (const match of documentXml.matchAll(paras)) {
        let paragraph = match[0];
        // External hyperlink whose visible label is the sticker name.
        paragraph = paragraph.replace(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/gi, (full, attrs: string, body: string) => {
            const relId = /\br:id="([^"]+)"/.exec(attrs)?.[1];
            const target = relId && links.get(relId);
            if (!target) return full;
            const label = xmlText(body).trim();
            if (!label || label === target) return full;
            const other = xmlText(paragraph.replace(full, '')).trim();
            // Standalone linked label maps to a whole emoji pair, not a guessed URL.
            if (other) return full;
            const escaped = (label + '--' + target).replace(/&/g, '&amp;').replace(/</g, '&lt;');
            return '<w:t>' + escaped + '</w:t>';
        });
        const text = xmlText(paragraph).trim();
        if (text) paragraphs.push(text);
    }
    return paragraphs.join('\n');
}

async function readDocx(bytes: ArrayBuffer): Promise<string> {
    let zip: JSZip;
    try { zip = await (await import('jszip')).default.loadAsync(bytes); } catch {
        throw new Error('Word 文件无法解压，请确认是有效的 .docx 文件');
    }
    const doc = zip.file('word/document.xml');
    if (!doc) throw new Error('Word 文件缺少正文内容，请另存为 .docx 后再试');
    if ((doc as any)._data?.uncompressedSize > MAX_DOCUMENT_TEXT_LENGTH * 2) {
        throw new Error('Word 正文过大，请拆分文件后再导入');
    }
    const xml = await doc.async('string');
    if (xml.length > MAX_DOCUMENT_TEXT_LENGTH * 2) throw new Error('Word 正文过大，请拆分文件后再导入');
    const rels = zip.file('word/_rels/document.xml.rels');
    const links = rels ? await rels.async('string') : '';
    return docxXmlToEmojiText(xml, links);
}

function htmlToText(html: string): string {
    const imgRows: string[] = [];
    for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
        const src = /\b(?:src|data-src)=["']([^"']+)["']/i.exec(tag[0])?.[1];
        const alt = /\b(?:alt|title)=["']([^"']+)["']/i.exec(tag[0])?.[1];
        if (src && alt) imgRows.push(decodeEntities(alt) + '--' + decodeEntities(src));
    }
    const withoutCode = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const withNewlines = withoutCode
        .replace(/<\/?(?:tr|p|div|li|br|h[1-6])\b[^>]*>/gi, '\n')
        .replace(/<\/?t[dh]\b[^>]*>/gi, '\t')
        .replace(/<[^>]+>/g, '');
    return imgRows.join('\n') + '\n' + decodeEntities(withNewlines);
}

function rtfToText(rtf: string): string {
    // Best-effort for text-based RTF (including \uNNNN Unicode). Word's binary .doc is different.
    return rtf
        .replace(/\{\\\*\\[^{}]*\}/g, '')
        .replace(/\\u(-?\d+)\??/g, (_all, digits: string) => String.fromCharCode((Number(digits) + 65536) % 65536))
        .replace(/\\'(?:[a-f0-9]{2})/gi, '')
        .replace(/\\(?:par|line)\b\s?/g, '\n')
        .replace(/\\tab\b\s?/g, '\t')
        .replace(/\\[a-z]+\d*\s?/gi, '')
        .replace(/\\([{}\\])/g, '$1')
        .replace(/[{}]/g, '');
}

function jsonToText(value: unknown): string {
    const rows: string[] = [];
    const visit = (node: unknown, depth: number) => {
        if (rows.length >= MAX_IMPORT_ENTRIES || depth > 10 || node == null) return;
        if (typeof node === 'string') {
            if (/https?:\/\/|--data:image\//i.test(node)) rows.push(node);
            return;
        }
        if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return; }
        if (typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        const name = obj.name ?? obj.title ?? obj.label;
        const url = obj.url ?? obj.src ?? obj.imageUrl ?? obj.link;
        if (typeof name === 'string' && typeof url === 'string') {
            rows.push(name + '--' + url);
            return;
        }
        for (const val of Object.values(obj)) visit(val, depth + 1);
    };
    visit(value, 0);
    return rows.join('\n');
}

function splitDelimitedRow(line: string, delimiter: string): string[] {
    const fields: string[] = [];
    let current = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (quoted && line[i + 1] === '"') { current += '"'; i++; }
            else quoted = !quoted;
        } else if (char === delimiter && !quoted) {
            fields.push(current.trim()); current = '';
        } else current += char;
    }
    fields.push(current.trim());
    return fields;
}

const isValidPair = (name: string, url: string): EmojiImportEntry | null => {
    const label = name.trim();
    const target = url.trim();
    if (!label || !target || label.length > 200) return null;
    // Validate the URL independently. Parsing "label--name：URL" as a whole
    // previously treated a document heading as part of the sticker name.
    const probe = parseEmojiImportLine('__emoji_url_probe__--' + target);
    return probe?.name === '__emoji_url_probe__' && probe.url === target
        ? { name: label, url: target } : null;
};

function readCandidate(line: string): EmojiImportEntry | null {
    const trimmed = line.trim()
        .replace(/^(?:[-*•]\s+|\d+[.、)]\s+)/, '');
    const direct = parseEmojiImportLine(trimmed);
    if (direct) return direct;
    const markdownLink = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(trimmed);
    if (markdownLink) return isValidPair(markdownLink[1], markdownLink[2]);
    const markdownTable = /^\|?([^|]+)\|([^|]+)\|?$/.exec(trimmed);
    if (markdownTable) {
        return isValidPair(markdownTable[1].trim(), markdownTable[2].trim())
            || isValidPair(markdownTable[2].trim(), markdownTable[1].trim());
    }
    const spaced = /^(.+?)\s+(https?:\/\/\S+)$/.exec(trimmed);
    if (spaced) return isValidPair(spaced[1].trim(), spaced[2]);
    for (const delimiter of ['\t', ',', '，']) {
        if (!trimmed.includes(delimiter)) continue;
        const columns = splitDelimitedRow(trimmed, delimiter);
        if (columns.length < 2) continue;
        const cells = columns.map(s => s.trim()).filter(Boolean);
        for (let i = 0; i < cells.length - 1; i++) {
            const pair = isValidPair(cells[i], cells[i + 1]) || isValidPair(cells[i + 1], cells[i]);
            if (pair) return pair;
        }
    }
    return null;
}

function bareImageUrl(line: string): string | null {
    const candidate = line.trim();
    return isValidPair('image', candidate) ? candidate : null;
}

/** Extract rows from documents without treating headings and prose as failed imports. */
export function collectEmojiDocumentRows(text: string): { entries: EmojiImportEntry[]; ignoredLines: number } {
    const lines = text.split(/\r\n|\r|\n/);
    const entries: EmojiImportEntry[] = [];
    let ignoredLines = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parsed = readCandidate(line);
        if (parsed) {
            entries.push(parsed);
            continue;
        }
        const next = lines[i + 1]?.trim();
        const name = line.replace(/^(?:[-*•]\s+|\d+[.、)]\s+)/, '').trim();
        if (next && name.length >= 1 && name.length <= 100 && !/https?:\/\//i.test(name)) {
            const pair = isValidPair(name, next);
            if (pair) { entries.push(pair); i++; continue; }
        }
        if (next && bareImageUrl(line) && next.length <= 100 && !/https?:\/\//i.test(next)) {
            const pair = isValidPair(next, line);
            if (pair) { entries.push(pair); i++; continue; }
        }
        ignoredLines++;
    }
    if (entries.length > MAX_IMPORT_ENTRIES) throw new Error('识别到的表情超过 3000 条，请分批导入');
    return { entries, ignoredLines };
}

export async function importEmojiDocument(file: ReadableFile): Promise<EmojiDocumentResult> {
    const name = file.name || '未命名文件';
    const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() || '';
    if (extension === 'doc') throw new Error('旧版 Word .doc 暂无法可靠解析，请用 Word 另存为 .docx 后再导入');
    if (!['txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'rtf', 'docx', 'pdf'].includes(extension)) {
        throw new Error('不支持此文件类型，请选择 TXT、Word DOCX、PDF、CSV、Markdown、JSON 或 HTML');
    }
    if (file.size > EMOJI_DOCUMENT_MAX_BYTES) throw new Error('单个文件不能超过 16MB，请拆分后导入');
    const bytes = await file.arrayBuffer();
    let content = '';
    if (extension === 'pdf') {
        // Keep the heavy PDF worker out of the private-chat initial bundle.
        const { extractPdfEmojiLines } = await import('./pdfText');
        content = await extractPdfEmojiLines(bytes, 80);
        if (!content.trim()) throw new Error('PDF 没有可提取的文字，可能是扫描图片；请先转为可选中文本');
    } else if (extension === 'docx') {
        content = await readDocx(bytes);
    } else {
        const plain = decodePlainText(bytes);
        if (extension === 'json') {
            try { content = jsonToText(JSON.parse(plain)); }
            catch { throw new Error('JSON 文件格式错误，请检查文件内容'); }
        } else if (extension === 'html' || extension === 'htm') {
            content = htmlToText(plain);
        } else if (extension === 'rtf') {
            content = rtfToText(plain);
        } else content = plain;
    }
    if (content.length > MAX_DOCUMENT_TEXT_LENGTH) throw new Error('文档正文过大，请拆分后重试');
    const { entries, ignoredLines } = collectEmojiDocumentRows(content);
    if (!entries.length) throw new Error('未找到「表情名称＋图片链接」，请检查文档是否包含在线表情包地址');
    return { name, entries, text: formatEmojiImportText(entries), ignoredLines };
}
