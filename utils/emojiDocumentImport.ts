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
    /** URL-looking lines omitted from recognition; show these to help users find missing stickers. */
    suspiciousLines: string[];
    /** Bare image URLs given predictable file-derived names for easy later editing. */
    generatedNames: number;
    name: string;
}

type ReadableFile = Pick<File, 'name' | 'size' | 'arrayBuffer'> & { type?: string };

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
    const base = /<base\b[^>]*\bhref=["'](https?:\/\/[^"']+)["']/i.exec(html)?.[1];
    for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
        const src = /\b(?:src|data-src)=["']([^"']+)["']/i.exec(tag[0])?.[1];
        const alt = /\b(?:alt|title)=["']([^"']+)["']/i.exec(tag[0])?.[1];
        if (!src || !alt) continue;
        let link = decodeEntities(src);
        if (!/^https?:\/\//i.test(link) && !/^data:image\//i.test(link)) {
            // Saved web pages often contain relative /images/a.png. Those paths
            // point to the *wrong origin* when reinterpreted inside SullyOS.
            if (!base) continue;
            try { link = new URL(link, decodeEntities(base)).href; }
            catch { continue; }
        }
        if (/^https?:\/\//i.test(link) || /^data:image\//i.test(link)) {
            imgRows.push(decodeEntities(alt) + '--' + link);
        }
    }
    const withoutCode = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const withNewlines = withoutCode
        .replace(/<\/?(?:tr|p|div|li|br|h[1-6])\b[^>]*>/gi, '\n')
        .replace(/<\/?t[dh]\b[^>]*>/gi, '\t')
        .replace(/<[^>]+>/g, '');
    return imgRows.join('\n') + '\n' + decodeEntities(withNewlines);
}

function rtfToText(rtf: string): string {
    // Chinese Word/WPS RTF files often encode names as \'hh byte runs
    // using \ansicpg936; deleting these bytes silently loses their names.
    const codePage = /\\ansicpg(\d+)/i.exec(rtf)?.[1] || '1252';
    const encoding = codePage === '936' || codePage === '54936' ? 'gb18030'
        : codePage === '65001' ? 'utf-8'
        : 'windows-' + codePage;
    const decodeHex = (sequence: string): string => {
        const hex = [...sequence.matchAll(/\\'([a-f0-9]{2})/gi)].map(match => parseInt(match[1], 16));
        try { return new TextDecoder(encoding, { fatal: true }).decode(new Uint8Array(hex)); }
        catch { return new TextDecoder('windows-1252').decode(new Uint8Array(hex)); }
    };
    return rtf
        .replace(/\{\\\*\\[^{}]*\}/g, '')
        .replace(/(?:\\'[a-f0-9]{2})+/gi, decodeHex)
        .replace(/\\u(-?\d+)\??/g, (_all, digits: string) => String.fromCharCode((Number(digits) + 65536) % 65536))
        .replace(/\\(?:par|line)\b\s?/g, '\n')
        .replace(/\\tab\b\s?/g, '\t')
        .replace(/\\[a-z]+\d*\s?/gi, '')
        .replace(/\\([{}\\])/g, '$1')
        .replace(/[{}]/g, '');
}

interface JsonRows {
    text: string;
    omitted: string[];
}
function jsonToText(value: unknown): JsonRows {
    const rows: string[] = [];
    const omitted: string[] = [];
    const pushRow = (row: string) => {
        if (rows.length >= MAX_IMPORT_ENTRIES) throw new Error('JSON 表情数量超过 3000 条，请分批导入');
        rows.push(row);
    };
    const note = (message: string) => {
        if (omitted.length < 8) omitted.push(message.slice(0, 160));
    };
    const cleanName = (name: string) => name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    const visit = (node: unknown, depth: number, inEmojiMap = false) => {
        if (depth > 24 || node == null) return;
        if (typeof node === 'string') {
            if (/^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|apng)(?:[?#]\S*)?$/i.test(node.trim())
                || /--(?:https?:\/\/|data:image\/)/i.test(node)) pushRow(node);
            return;
        }
        if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1, inEmojiMap); return; }
        if (typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        const name = obj.name ?? obj.title ?? obj.label ?? obj.表情名称 ?? obj.表情包名称;
        const url = obj.url ?? obj.src ?? obj.imageUrl ?? obj.image ?? obj.link ?? obj.图片链接 ?? obj.图片地址;
        const isNamedEntry = name !== undefined || url !== undefined;
        if (isNamedEntry) {
            if (typeof name === 'string' && cleanName(name) && typeof url === 'string' && url.trim()) {
                pushRow(cleanName(name) + '--' + url.trim());
            } else if (typeof url === 'string' && /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|apng)(?:[?#]\S*)?$/i.test(url.trim())) {
                pushRow(url.trim()); // The document importer will derive the filename.
                note('JSON 中有缺少名称的图片链接，已尝试自动命名：' + url.slice(0, 80));
            } else {
                note('JSON 中存在名称或图片链接缺失的记录：' + String(name ?? '未命名').slice(0, 60));
            }
            return;
        }
        for (const [key, item] of Object.entries(obj)) {
            const nextIsEmojiMap = inEmojiMap || /^(?:emojis?|stickers?|expressions?|表情包?|贴图|图片列表|表情列表)$/i.test(key);
            if (typeof item === 'string' && (/^https?:\/\//i.test(item) || /^data:image\//i.test(item))) {
                // Generic metadata links such as homepage/repository must not
                // become fake stickers. In known emoji maps, names are keys.
                const likelyImage = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|apng)(?:[?#]\S*)?$/i.test(item.trim())
                    || /^data:image\//i.test(item);
                if (nextIsEmojiMap || likelyImage) pushRow(cleanName(key) + '--' + item.trim());
            } else {
                visit(item, depth + 1, nextIsEmojiMap);
            }
        }
    };
    visit(value, 0);
    return { text: rows.join('\n'), omitted };
}

/** Keep CSV quoted names containing line breaks in the same logical record. */
function normalizeDelimitedNewlines(text: string): string {
    let inQuotes = false;
    let normalized = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            if (inQuotes && text[i + 1] === '"') {
                normalized += '""'; i++;
            } else {
                inQuotes = !inQuotes;
                normalized += char;
            }
        } else if (inQuotes && (char === '\r' || char === '\n')) {
            normalized += ' ';
            if (char === '\r' && text[i + 1] === '\n') i++;
        } else normalized += char;
    }
    if (inQuotes) throw new Error('CSV/TSV 文件存在未闭合的引号，请检查表格后重新导出');
    return normalized;
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

/** PDF and word processing software may wrap the URL itself over visual lines. */
export function reuniteWrappedImageUrls(text: string): string {
    const lines = text.split(/\r\n|\r|\n/);
    const merged: string[] = [];
    for (const part of lines) {
        const current = part.trim();
        const previous = merged[merged.length - 1] || '';
        const endsWithLink = /https?:\/\/\S+$/i.test(previous);
        const alreadyComplete = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|apng)(?:[?#]\S*)?$/i.test(previous);
        const nextIsUrlTail = /^(?:[.?&#/]\S+|[^\s]+\.(?:png|jpe?g|gif|webp|avif|apng)(?:[?#]\S*)?)$/i.test(current)
            || (previous.endsWith('.') && /^(?:png|jpe?g|gif|webp|avif|apng)(?:[?#]\S*)?$/i.test(current));
        if (endsWithLink && !alreadyComplete && nextIsUrlTail) {
            merged[merged.length - 1] = previous + current;
        } else merged.push(part);
    }
    return merged.join('\n');
}

/** The fallback is deliberately restricted to links ending in an image extension:
 * do not import a guide's unrelated web URLs as fake images.
 */
function deriveNameFromBareImageUrl(value: string): EmojiImportEntry | null {
    const raw = value.trim();
    if (!/^https?:\/\/\S+$/i.test(raw)) return null;
    try {
        const parsed = new URL(raw);
        const basename = decodeURIComponent(parsed.pathname.split('/').pop() || '');
        if (!/\.(?:png|jpe?g|gif|webp|avif|apng)$/i.test(basename)) return null;
        const stem = basename.replace(/\.(?:png|jpe?g|gif|webp|avif|apng)$/i, '')
            .replace(/[\s<>:"/\\|?*]+/g, '_').slice(0, 60);
        return stem ? { name: stem, url: raw } : null;
    } catch { return null; }
}

const isNameOnlyLine = (value: string): boolean =>
    value.length > 0 && value.length <= 70 &&
    !/https?:\/\/|data:image\/|blobref:/i.test(value) &&
    !/^#{1,6}\s|^(?:表情包(?:清单|合集|目录|列表)?|目录|说明|链接|网址|名称|image|url|name)\s*[:：]?\s*$/i.test(value);

function bareImageUrl(line: string): string | null {
    const candidate = line.trim();
    return isValidPair('image', candidate) ? candidate : null;
}

/** Extract rows without treating headings and prose as failed imports. */
export function collectEmojiDocumentRows(text: string): { entries: EmojiImportEntry[]; ignoredLines: number; suspiciousLines: string[]; generatedNames: number } {
    const lines = text.split(/\r\n|\r|\n/);
    const entries: EmojiImportEntry[] = [];
    let ignoredLines = 0;
    const suspiciousLines: string[] = [];
    let generatedNames = 0;
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
        if (next && isNameOnlyLine(name)) {
            const pair = isValidPair(name, next);
            if (pair) { entries.push(pair); i++; continue; }
        }
        if (next && bareImageUrl(line) && isNameOnlyLine(next)) {
            const pair = isValidPair(next, line);
            if (pair) { entries.push(pair); i++; continue; }
        }
        const unnamed = deriveNameFromBareImageUrl(line);
        if (unnamed) {
            generatedNames++;
            entries.push(unnamed);
            continue;
        }
        ignoredLines++;
        if (suspiciousLines.length < 8 && /https?:\/\/|data:image\/|blobref:/i.test(line)) suspiciousLines.push(line.slice(0,160));
    }
    if (entries.length > MAX_IMPORT_ENTRIES) throw new Error('识别到的表情超过 3000 条，请分批导入');
    return { entries, ignoredLines, suspiciousLines, generatedNames };
}

export async function importEmojiDocument(file: ReadableFile): Promise<EmojiDocumentResult> {
    const name = file.name || '未命名文件';
    const suffix = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() || '';
    // Android document providers may return generic names (or no extension).
    // Prefer the explicit suffix; use MIME only when the file name gives no type.
    const mimeType = (file.type || '').toLowerCase().split(';')[0];
    const extension = suffix || ({
        'application/pdf': 'pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/msword': 'doc',
        'text/plain': 'txt',
        'text/csv': 'csv',
        'text/markdown': 'md',
        'application/json': 'json',
        'text/html': 'html',
        'application/rtf': 'rtf',
        'text/rtf': 'rtf',
    } as Record<string, string>)[mimeType] || '';
    // Some .doc downloads are actually RTF or HTML (browser/Word "save as").
    // Genuine OLE binary .doc remains unsupported without a dedicated binary parser.
    if (extension === 'doc') {
        if (file.size > EMOJI_DOCUMENT_MAX_BYTES) throw new Error('单个文件不能超过 16MB，请拆分后导入');
        const bytes = await file.arrayBuffer();
        const plain = decodePlainText(bytes);
        if (/^\s*\{\\rtf/i.test(plain) || /^\s*<(?:html|!doctype html|body)/i.test(plain)) {
            const content = /^\s*\{\\rtf/i.test(plain) ? rtfToText(plain) : htmlToText(plain);
            const { entries, ignoredLines, suspiciousLines, generatedNames } = collectEmojiDocumentRows(content);
            if (!entries.length) throw new Error('该 Word 文档中没有识别出表情名称与图片链接');
            return { name, entries, text: formatEmojiImportText(entries), ignoredLines, suspiciousLines, generatedNames };
        }
        throw new Error('这是旧版二进制 Word .doc，请用 Word 或 WPS 另存为 .docx 后导入');
    }
    if (!['txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'rtf', 'docx', 'pdf'].includes(extension)) {
        throw new Error('不支持此文件类型，请选择 TXT、Word DOCX、PDF、CSV、Markdown、JSON 或 HTML');
    }
    if (file.size > EMOJI_DOCUMENT_MAX_BYTES) throw new Error('单个文件不能超过 16MB，请拆分后导入');
    const bytes = await file.arrayBuffer();
    let content = '';
    let jsonOmitted: string[] = [];
    if (extension === 'pdf') {
        // Keep the heavy PDF worker out of the private-chat initial bundle.
        const { extractPdfEmojiLines } = await import('./pdfText');
        content = reuniteWrappedImageUrls(await extractPdfEmojiLines(bytes, 80));
        if (!content.trim()) throw new Error('PDF 没有可提取的文字，可能是扫描图片；请先转为可选中文本');
    } else if (extension === 'docx') {
        content = await readDocx(bytes);
    } else {
        const plain = decodePlainText(bytes);
        if (extension === 'json') {
            let parsed: unknown;
            try { parsed = JSON.parse(plain); }
            catch { throw new Error('JSON 文件格式错误，请检查文件内容'); }
            // Preserve informative capacity errors from the import walker.
            const extracted = jsonToText(parsed);
            content = extracted.text;
            jsonOmitted = extracted.omitted;
        } else if (extension === 'html' || extension === 'htm') {
            content = htmlToText(plain);
        } else if (extension === 'rtf') {
            content = rtfToText(plain);
        } else content = (extension === 'csv' || extension === 'tsv') ? normalizeDelimitedNewlines(plain) : plain;
    }
    if (content.length > MAX_DOCUMENT_TEXT_LENGTH) throw new Error('文档正文过大，请拆分后重试');
    const { entries, ignoredLines, suspiciousLines, generatedNames } = collectEmojiDocumentRows(content);
    if (!entries.length) throw new Error('未找到「表情名称＋图片链接」，请检查文档是否包含在线表情包地址');
    return {
        name, entries, text: formatEmojiImportText(entries), generatedNames,
        ignoredLines: ignoredLines + jsonOmitted.length,
        suspiciousLines: [...jsonOmitted, ...suspiciousLines].slice(0, 8),
    };
}
