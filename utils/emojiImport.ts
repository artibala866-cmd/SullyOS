/**
 * 私聊「表情注入」使用的纯文本解析器与冲突规划器。
 * 保留旧版「名称--链接」，兼容「名称：链接」「名称:链接」「链接 名称」。
 * 表情在全局表里以 name 为主键，不可直接覆盖同名记录。
 */
export interface EmojiImportEntry {
    name: string;
    url: string;
}
export interface EmojiImportParseResult {
    entries: EmojiImportEntry[];
    invalidLineNumbers: number[];
}
export interface EmojiImportPlan {
    additions: EmojiImportEntry[];
    skipped: number;
    renamed: number;
}

/** 校验可由现有图片渲染链路消费的引用；不进行跨域网络探测。 */
function isImageReference(url: string): boolean {
    // 旧版表情也支持本站绝对资源路径和已存在的 BlobRef 图片令牌。
    if (/^\/(?!\/)[^\s]+$/.test(url)) return true;
    if (/^blobref:[a-z0-9_-]+$/i.test(url)) return true;
    if (/^data:image\/[a-z0-9.+-]+(?:;[^,\s]*)?,\S+$/i.test(url)) return true;
    if (!/^https?:\/\//i.test(url) || /\s/.test(url)) return false;
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
    } catch {
        return false;
    }
}

export function parseEmojiImportLine(raw: string): EmojiImportEntry | null {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) return null;

    // 先匹配链接在前，避免把 http:// 中的冒号当成名字分隔符。
    const urlFirst = /^(https?:\/\/\S+)\s+(.+)$/i.exec(line);
    if (urlFirst) {
        const name = urlFirst[2].trim();
        return name && isImageReference(urlFirst[1]) ? { name, url: urlFirst[1] } : null;
    }

    // 中文冒号、英文冒号：允许名称中自带其他冒号。
    const colon = /^(.+?)\s*[：:]\s*(https?:\/\/\S+)$/i.exec(line);
    if (colon) {
        const name = colon[1].trim();
        return name && isImageReference(colon[2]) ? { name, url: colon[2] } : null;
    }

    const separator = line.indexOf('--');
    if (separator < 0) return null;
    const name = line.slice(0, separator).trim();
    const url = line.slice(separator + 2).trim();
    // 裸 URL 含有 -- 时不应被误解析成「名称--链接」。
    return name && !/^https?:\/\//i.test(name) && isImageReference(url) ? { name, url } : null;
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

/**
 * 不覆盖任何已有同名表情：相同名称+图片直接跳过，同名不同图使用
 * 全局唯一的「名称（2）」等新名称；再次导入相同内容不会无限复制。
 */
export function planEmojiImport(
    entries: readonly EmojiImportEntry[],
    existing: readonly EmojiImportEntry[],
): EmojiImportPlan {
    const occupied = new Map(existing.map(e => [e.name, e.url]));
    const additions: EmojiImportEntry[] = [];
    let skipped = 0;
    let renamed = 0;
    for (const entry of entries) {
        let name = entry.name;
        if (occupied.has(name) && occupied.get(name) !== entry.url) {
            let suffix = 2;
            do {
                name = entry.name + '（' + suffix++ + '）';
            } while (occupied.has(name) && occupied.get(name) !== entry.url);
        }
        if (occupied.has(name)) {
            skipped++;
            continue;
        }
        if (name !== entry.name) renamed++;
        additions.push({ name, url: entry.url });
        occupied.set(name, entry.url);
    }
    return { additions, skipped, renamed };
}
