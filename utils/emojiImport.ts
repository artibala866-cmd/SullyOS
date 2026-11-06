/**
 * 私聊「表情注入」的纯文本格式兼容层。
 * 保留旧版「名称--链接」，并接受中文/英文冒号以及「链接 名称」。
 * 所有形式都转换成糯米机原有的 name/url 记录；不上传图片，也不改表情库结构。
 */
export interface EmojiImportEntry {
    name: string;
    url: string;
}

export interface EmojiImportParseResult {
    entries: EmojiImportEntry[];
    invalidLineNumbers: number[];
}

export function parseEmojiImportLine(raw: string): EmojiImportEntry | null {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) return null;

    // URL 在前时先识别，避免把 http:// 的冒号误当成名字分隔符。
    const urlFirst = /^(https?:\/\/\S+)\s+(.+)$/i.exec(line);
    if (urlFirst) {
        const name = urlFirst[2].trim();
        return name ? { name, url: urlFirst[1] } : null;
    }

    // 名称：http://... 或 名称:http://...
    const colon = /^(.+?)\s*[：:]\s*(https?:\/\/\S+)$/i.exec(line);
    if (colon) {
        const name = colon[1].trim();
        return name ? { name, url: colon[2] } : null;
    }

    // 完全向后兼容原有分隔符：URL（包括 data URL）内部可包含 --。
    const separator = line.indexOf('--');
    if (separator < 0) return null;
    const name = line.slice(0, separator).trim();
    const url = line.slice(separator + 2).trim();
    return name && url ? { name, url } : null;
}

export function parseEmojiImportText(text: string): EmojiImportParseResult {
    const entries: EmojiImportEntry[] = [];
    const invalidLineNumbers: number[] = [];
    text.split(/\r\n|\n|\r/).forEach((line, index) => {
        if (!line.trim()) return;
        const parsed = parseEmojiImportLine(line);
        if (parsed) entries.push(parsed);
        else invalidLineNumbers.push(index + 1);
    });
    return { entries, invalidLineNumbers };
}

export function formatEmojiImportText(entries: readonly EmojiImportEntry[]): string {
    return entries.map(({ name, url }) => name + '--' + url).join('\n');
}
