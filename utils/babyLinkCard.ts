import type { CharacterProfile, Worldbook } from '../types';
import type { PreparedCharacterCard } from './sillyTavernCard';

/**
 * BabyLink 1.1.10 APK: StImportUnlockModal-NAd1Rh6X.js uses RGB LSBs in
 * row-major order, a four-byte big-endian compressed length, then gzip JSON.
 * It does NOT use PNG tEXt/chara metadata. No BabyLink scripts are executed.
 */
const MAGIC = 'LINK_CHARACTER_SHARE_PNG_V1';
const MAX_COMPRESSED = 2_000_000;
const MAX_INFLATED = 8_000_000;
const MAX_PIXELS = 8_000_000;
const MAX_CHARACTERS = 32;
const MAX_BOOKS = 256;
const MAX_ENTRIES = 1000;
const MAX_ENTRY_TEXT = 200_000;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown, field: string, max = MAX_INFLATED): string => {
    if (value == null) return '';
    if (typeof value !== 'string') throw new Error('BabyLink ' + field + ' 格式无效');
    if (value.length > max) throw new Error('BabyLink ' + field + ' 超出安全长度限制');
    return value.trim();
};
const numberIn = (value: unknown, min: number, max: number, fallback: number, field: string): number => {
    if (value == null) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new Error('BabyLink 世界书字段 ' + field + ' 超出支持范围');
    }
    return value;
};
const arrayOfStrings = (value: unknown, field: string): string[] => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 100 ||
        value.some(item => typeof item !== 'string' || item.length > 512)) {
        throw new Error('BabyLink ' + field + ' 关键词格式无效');
    }
    return [...new Set(value.map(item => (item as string).trim()).filter(Boolean))];
};
const uniqueId = (prefix: string): string => prefix + '-' +
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));

export interface PreparedBabyLinkBundle {
    source: 'babylink';
    cards: PreparedCharacterCard[];
    warnings: string[];
}

/** Pure data conversion, independently testable without canvas or the database. */
export function normalizeBabyLinkShare(raw: unknown): PreparedBabyLinkBundle {
    if (!isObject(raw) || raw.magic !== MAGIC || raw.version !== 1) {
        throw new Error('不是受支持的 BabyLink V1 角色分享包');
    }
    if (!Array.isArray(raw.characters) || raw.characters.length === 0 ||
        raw.characters.length > MAX_CHARACTERS || !Array.isArray(raw.worldBooks) ||
        raw.worldBooks.length > MAX_BOOKS) {
        throw new Error('BabyLink 角色或世界书数量超出限制');
    }
    const warnings: string[] = [];
    const bookMap = new Map<string, Worldbook[]>();
    let totalEntries = 0;
    for (const [index, value] of raw.worldBooks.entries()) {
        if (!isObject(value) || !Array.isArray(value.entries)) {
            throw new Error('BabyLink 第 ' + (index + 1) + ' 本世界书结构不完整');
        }
        const bookId = optionalText(value.id, '世界书 ID', 256);
        if (!bookId || bookMap.has(bookId)) throw new Error('BabyLink 世界书 ID 缺失或重复');
        if (value.enabled != null && typeof value.enabled !== 'boolean') throw new Error('BabyLink 世界书启用状态无效');
        const bookTitle = optionalText(value.title, '世界书名称', 300) || '未命名世界书';
        totalEntries += value.entries.length;
        if (totalEntries > MAX_ENTRIES) throw new Error('BabyLink 世界书总条目数超过 1000');
        const ids = new Set<string>();
        const books: Worldbook[] = [];
        for (const [n, entry] of value.entries.entries()) {
            if (!isObject(entry)) throw new Error('BabyLink 世界书条目结构损坏');
            const entryId = optionalText(entry.id, '条目 ID', 256);
            if (entryId && ids.has(entryId)) throw new Error('BabyLink 世界书含重复条目 ID');
            if (entryId) ids.add(entryId);
            const title = optionalText(entry.title, '条目标题', 300);
            const content = optionalText(entry.content, '条目正文', MAX_ENTRY_TEXT);
            const keys = arrayOfStrings(entry.keys, 'keys');
            const secondaryKeys = arrayOfStrings(entry.secondaryKeys, 'secondaryKeys');
            if (!title && !content && !keys.length && !secondaryKeys.length) continue;
            if (entry.enabled != null && typeof entry.enabled !== 'boolean') throw new Error('BabyLink 条目启用状态无效');
            const activation = entry.activation ?? 'keyword';
            if (!['constant', 'keyword', 'priority'].includes(String(activation))) {
                throw new Error('BabyLink 世界书激活模式无法识别');
            }
            const position = entry.position ?? 'before-chat';
            if (position !== 'before-chat' && position !== 'after-chat') {
                throw new Error('BabyLink 世界书注入位置无法识别');
            }
            if (entry.caseSensitive != null && typeof entry.caseSensitive !== 'boolean') {
                throw new Error('BabyLink 世界书大小写匹配规则无效');
            }
            const order = numberIn(entry.order, 0, 9999, 100, 'order');
            const depth = numberIn(entry.depth, 0, 12, 4, 'depth');
            const probability = numberIn(entry.probability, 0, 100, 100, 'probability');
            const constant = activation !== 'keyword';
            if (activation === 'priority' && !warnings.includes('BabyLink priority 条目已保持常驻并优先排序，但专属优先级机制无法完全等价')) {
                warnings.push('BabyLink priority 条目已保持常驻并优先排序，但专属优先级机制无法完全等价');
            }
            if (position === 'after-chat' && !warnings.includes('BabyLink after-chat 已映射到角色设定后；聊天结束后的精确注入位置尚无法等价')) {
                warnings.push('BabyLink after-chat 已映射到角色设定后；聊天结束后的精确注入位置尚无法等价');
            }
            const now = Date.now();
            books.push({
                id: uniqueId('wb'),
                title: title || '条目 ' + (n + 1),
                content,
                category: 'BabyLink · ' + bookTitle,
                createdAt: now, updatedAt: now,
                key: keys, keysecondary: secondaryKeys,
                constant, selective: !constant && secondaryKeys.length > 0,
                selectiveLogic: 0,
                position: position === 'before-chat' ? 0 : 1,
                order: activation === 'priority' ? order - 10000 : order,
                depth,
                probability, useProbability: probability < 100,
                caseSensitive: entry.caseSensitive === true,
                disable: value.enabled === false || entry.enabled === false,
            });
        }
        bookMap.set(bookId, books);
    }
    const cards: PreparedCharacterCard[] = raw.characters.map((value, index) => {
        if (!isObject(value)) throw new Error('BabyLink 第 ' + (index + 1) + ' 个角色结构不完整');
        const name = optionalText(value.name, '角色姓名', 160) || optionalText(value.nickname, '角色昵称', 160);
        if (!name) throw new Error('BabyLink 第 ' + (index + 1) + ' 个角色缺少姓名');
        const nickname = optionalText(value.nickname, '角色昵称', 160) ||
            (isObject(value.initialProfile) ? optionalText(value.initialProfile.nickname, 'initialProfile.nickname', 160) : '');
        const signature = optionalText(value.signature, '角色签名', 4000) ||
            (isObject(value.initialProfile) ? optionalText(value.initialProfile.signature, 'initialProfile.signature', 4000) : '');
        const persona = optionalText(value.description, '完整人设');
        const sourceAvatar = optionalText(value.avatar, '角色头像', 3_000_000);
        // Do not import external platform asset IDs, scripts, credentials, openings or regex.
        const avatar = /^(?:data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+)$/i.test(sourceAvatar)
            ? sourceAvatar : '';
        if (sourceAvatar && !avatar && !warnings.includes('部分 BabyLink 私有头像路径无法跨应用读取，已忽略')) {
            warnings.push('部分 BabyLink 私有头像路径无法跨应用读取，已忽略');
        }
        const ids = arrayOfStrings(value.localWorldBookIds, 'localWorldBookIds');
        const books: Worldbook[] = [];
        const seen = new Set<string>();
        for (const bookId of ids) {
            const matched = bookMap.get(bookId);
            if (!matched) {
                if (!warnings.includes('部分世界书引用在分享包中不存在，未创建错误绑定')) {
                    warnings.push('部分世界书引用在分享包中不存在，未创建错误绑定');
                }
                continue;
            }
            for (const book of matched) if (!seen.has(book.id)) {
                books.push(book); seen.add(book.id);
            }
        }
        // The entire unabridged persona belongs in the actual AI context field.
        const prompt = [
            persona ? '【角色稳定人设】\n' + persona : '',
            nickname && nickname !== name ? '【角色昵称】\n' + nickname : '',
            signature ? '【角色签名】\n' + signature : '',
        ].filter(Boolean).join('\n\n');
        const summary = [nickname && nickname !== name ? '昵称：' + nickname : '',
            signature ? '签名：' + signature : '', persona ? persona.split('\n').find(Boolean)?.slice(0, 140) : '']
            .filter(Boolean).join(' · ').slice(0, 260);
        const character: PreparedCharacterCard['character'] = {
            name, avatar, description: summary, systemPrompt: prompt, worldview: '',
        };
        return { source: 'babylink-character', character, worldbooks: books, avatarFile: null, warnings: [] };
    });
    return { source: 'babylink', cards, warnings };
}

/** Extract exactly four length bytes and the declared payload, never a full image-size byte array. */
export function extractBabyLinkCompressed(pixels: Uint8ClampedArray): Uint8Array | null {
    const capacity = Math.floor(pixels.length / 4 * 3 / 8);
    if (capacity < 4) return null;
    const readByte = (byteIndex: number): number => {
        let result = 0;
        for (let bit = 0; bit < 8; bit++) {
            const channel = (byteIndex * 8 + bit);
            const pixel = Math.floor(channel / 3);
            const component = channel % 3;
            result = (result << 1) | (pixels[pixel * 4 + component] & 1);
        }
        return result;
    };
    const length = ((readByte(0) * 0x1000000) + (readByte(1) << 16) +
        (readByte(2) << 8) + readByte(3)) >>> 0;
    if (!length || length > MAX_COMPRESSED || length > capacity - 4) return null;
    const compressed = new Uint8Array(length);
    for (let n = 0; n < length; n++) compressed[n] = readByte(n + 4);
    // A plausible declared length implies a share file, including if its gzip header is corrupt.
    if (compressed[0] !== 0x1f || compressed[1] !== 0x8b || compressed[2] !== 0x08) {
        throw new Error('BabyLink 分享图片的压缩数据已损坏');
    }
    return compressed;
}

async function unzipLimited(compressed: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持 GZIP 解压，无法导入 BabyLink 图片');
    const stream = new Blob([Uint8Array.from(compressed)]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_INFLATED) {
                void reader.cancel().catch(() => {});
                throw new Error('BabyLink 解压后超过 8 MB，已拒绝导入');
            }
            parts.push(value);
        }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
}

/** null means 'not BabyLink'; recognized-but-invalid bundles throw and never fall back to Tavern. */
export async function decodeBabyLinkPng(file: File, png: Uint8Array): Promise<PreparedBabyLinkBundle | null> {
    if (png.byteLength < 33 || file.size > 32 * 1024 * 1024) throw new Error('BabyLink PNG 文件大小无效');
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width * height > MAX_PIXELS) throw new Error('BabyLink PNG 图片像素超出安全限制');
    const bitmap = await createImageBitmap(file);
    try {
        if (bitmap.width !== width || bitmap.height !== height) throw new Error('PNG 图像实际尺寸不匹配');
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('浏览器无法读取 BabyLink PNG 颜色通道');
        context.drawImage(bitmap, 0, 0);
        const compressed = extractBabyLinkCompressed(context.getImageData(0, 0, width, height).data);
        if (!compressed) return null;
        let raw: unknown;
        try {
            raw = JSON.parse(utf8.decode(await unzipLimited(compressed)));
        } catch (error) {
            throw new Error('BabyLink 分享数据损坏或解压失败：' + (error instanceof Error ? error.message : '未知错误'));
        }
        return normalizeBabyLinkShare(raw);
    } finally { bitmap.close(); }
}
