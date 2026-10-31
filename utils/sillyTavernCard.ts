import type { CharacterProfile, Worldbook } from '../types';
import { stripSensitiveCardFields } from './characterCard';
import { isPng, pngHasShare, readShareText } from './pngShare';
import { parseStandardWorldbook } from './worldbook';

const MAX_JSON = 6 * 1024 * 1024;
const MAX_PNG = 32 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const MAX_ENTRY_TEXT = 200000;
const decoder = new TextDecoder('utf-8', { fatal: true });
const object = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const id = (kind: string): string =>
    kind + '-' + (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
const bool = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
const MAX_AVATAR_DATA_URL = 5 * 1024 * 1024;
const safeInlineAvatar = (value: unknown): string => {
    if (typeof value !== 'string' || value.length > MAX_AVATAR_DATA_URL) return '';
    return /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value) ? value : '';
};
const stableScenario = (scenario: string, warnings: string[]): string => {
    if (!scenario) return '';
    // Filter one-time openings by paragraph/sentence, not by dropping the whole worldview.
    const sentences = scenario.split(/(?<=[。！？!?])\s*|\n+/u).map(part => part.trim()).filter(Boolean);
    const opening = /(?:开场|初次见面|此刻|刚刚|你走进|你推开|你醒来|opening scene|first meeting|you enter|you wake up|the scene begins)/i;
    const stable = sentences.filter(part => !opening.test(part));
    if (stable.length !== sentences.length) warnings.push('一次性开局场景已过滤，稳定世界背景保留');
    return stable.join('\n');
};

/** Strictly normalized, inert data. Nothing here can execute Tavern scripts or API calls. */
export interface PreparedCharacterCard {
    source: 'sully' | 'tavern-v1' | 'tavern-v2' | 'tavern-v3';
    character: Partial<CharacterProfile> & Pick<CharacterProfile, 'name' | 'description' | 'systemPrompt'>;
    worldbooks: Worldbook[];
    avatarFile: File | null;
    warnings: string[];
}

const normalizeMacros = (value: string, warnings: string[]): string => {
    const converted = value
        .replace(/<(?:char|bot)>/gi, '{{char}}')
        .replace(/<(?:user)>/gi, '{{user}}');
    return converted.replace(/{{\s*([^{}]{1,100})\s*}}/g, (whole, macro: string) => {
        if (/^(char|user)$/i.test(macro.trim())) return whole;
        if (!warnings.includes('部分酒馆专属变量无法解析，已转为普通说明文本')) {
            warnings.push('部分酒馆专属变量无法解析，已转为普通说明文本');
        }
        return '[未兼容变量：' + macro.trim().slice(0, 60) + ']';
    });
};

const normalizeWorldbooks = (raw: unknown, charName: string, warnings: string[]): Worldbook[] => {
    if (raw == null) return [];
    if (!object(raw) || !Array.isArray(raw.entries)) {
        // Some Tavern exports use an object keyed by entry number.
        if (!object(raw) || !object(raw.entries)) throw new Error('角色世界书结构无效：缺少 entries');
    }
    const book = raw as Record<string, any>;
    const entries: unknown[] = Array.isArray(book.entries) ? book.entries : Object.values(book.entries);
    if (entries.length > MAX_ENTRIES) throw new Error('世界书超过 1000 条，已拒绝导入');
    if (book.recursive_scanning === true) warnings.push('世界书递归扫描规则无法在糯米机等价执行');
    if (typeof book.token_budget === 'number' && book.token_budget > 0) warnings.push('世界书全局 token_budget 无法按酒馆规则限制');
    const fallbackScanDepth = Number.isFinite(Number(book.scan_depth)) ? Number(book.scan_depth) : undefined;
    if (book.enabled === false) warnings.push('角色世界书整体关闭，条目已全部按停用状态导入');
    const standardEntries: Record<string, unknown>[] = [];
    for (let n = 0; n < entries.length; n++) {
        const item = entries[n];
        if (!object(item) || typeof item.content !== 'string') throw new Error('世界书第 ' + (n + 1) + ' 条内容结构损坏');
        if (item.content.length > MAX_ENTRY_TEXT) throw new Error('世界书第 ' + (n + 1) + ' 条正文超出安全限制');
        // CCv3 decorators affect entry activation, targeting and routing; SullyOS
        // does not interpret these lines. Never silently inject them as ordinary prose.
        if (/(?:^|\n)\s*@@[a-z_]+(?:\b|$)/i.test(item.content)) {
            throw new Error('世界书第 ' + (n + 1) + ' 条含酒馆专用 @@ 触发/注入装饰器，无法安全等价转换');
        }
        if (item.use_regex === true || item.extensions?.use_regex === true) {
            throw new Error('世界书第 ' + (n + 1) + ' 条使用正则关键词，糯米机不支持等价触发；未写入任何数据');
        }
        const ext = object(item.extensions) ? item.extensions : {};
        const rawPosition = item.position ?? ext.position;
        const position = rawPosition === 'before_char' ? 0 : rawPosition === 'after_char' ? 1 :
            rawPosition == null ? 1 : rawPosition;
        if (typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position > 6) {
            throw new Error('世界书第 ' + (n + 1) + ' 条使用不支持的注入位置');
        }
        const originalUid = item.uid ?? item.id ?? n;
        if (typeof originalUid === 'string' && !/^\d+$/.test(originalUid)) {
            warnings.push('部分世界书条目使用非数字 UID，已生成本地 ID');
        }
        const primary = item.key ?? item.keys ?? [];
        const secondary = item.keysecondary ?? item.secondary_keys ?? [];
        if (!Array.isArray(primary) || !Array.isArray(secondary) ||
            [...primary, ...secondary].some(k => typeof k !== 'string')) throw new Error('世界书关键词结构无效');
        const requestedRole = item.role ?? ext.role;
        const role = requestedRole === 'system' ? 0 : requestedRole === 'user' ? 1 :
            requestedRole === 'assistant' ? 2 : requestedRole;
        if (role != null && !([0, 1, 2].includes(role))) throw new Error('世界书第 ' + (n + 1) + ' 条使用不支持的角色注入位置');
        const controls: Record<string, unknown> = {
            probability: item.probability ?? ext.probability,
            depth: item.depth ?? ext.depth,
            scanDepth: item.scanDepth ?? ext.scanDepth,
            selectiveLogic: item.selectiveLogic ?? item.selective_logic ?? ext.selectiveLogic,
        };
        for (const [field, minimum, maximum] of [
            ['probability', 0, 100], ['depth', 0, 999], ['scanDepth', 0, 999],
            ['selectiveLogic', 0, 3],
        ] as const) {
            const value = controls[field];
            if (value != null && (typeof value !== 'number' ||
                !Number.isFinite(value) || value < minimum || value > maximum)) {
                throw new Error('世界书第 ' + (n + 1) + ' 条的 ' + field + ' 超出支持范围');
            }
        }
        const enabled = bool(item.enabled);
        const disabled = bool(item.disable);
        const entry = {
            uid: Number.isSafeInteger(Number(originalUid)) ? Number(originalUid) : n,
            comment: text(item.comment) || text(item.name) || '条目 ' + (n + 1),
            content: normalizeMacros(item.content, warnings),
            key: primary, keysecondary: secondary,
            constant: bool(item.constant) ?? false,
            selective: bool(item.selective) ?? secondary.length > 0,
            selectiveLogic: controls.selectiveLogic ?? 0,
            order: item.order ?? item.insertion_order ?? item.priority ?? 100,
            position,
            disable: book.enabled === false || disabled === true || enabled === false,
            probability: controls.probability ?? 100,
            useProbability: bool(item.useProbability) ?? bool(ext.useProbability) ?? false,
            depth: controls.depth ?? 4,
            role: role ?? null,
            scanDepth: controls.scanDepth ?? fallbackScanDepth ?? null,
            caseSensitive: item.caseSensitive ?? item.case_sensitive ?? ext.caseSensitive ?? null,
            matchWholeWords: item.matchWholeWords ?? item.match_whole_words ?? ext.matchWholeWords ?? null,
        };
        const supportedExtensions = new Set(['position','use_regex','role','depth','scanDepth',
            'probability','useProbability','caseSensitive','matchWholeWords','selectiveLogic']);
        const unsupportedExtensions = Object.keys(ext).filter(key => !supportedExtensions.has(key));
        if (unsupportedExtensions.length) {
            warnings.push('世界书第 ' + (n + 1) + ' 条扩展字段无法等价执行：' +
                unsupportedExtensions.join('、').slice(0, 180));
        }
        const unsupportedActivation = ['sticky','cooldown','delay','group','groupOverride',
            'excludeRecursion','preventRecursion','delayUntilRecursion','trigger','triggers',
            'matchWholeWords','useGroupScoring','vectorized','outletName'].filter(key =>
            item[key] !== undefined && key !== 'matchWholeWords');
        if (unsupportedActivation.length) warnings.push('世界书第 ' + (n + 1) + ' 条特殊规则不等价：' +
            unsupportedActivation.join('、'));
        standardEntries.push(entry);
    }
    if (!standardEntries.length) return [];
    // Use SullyOS's own canonical importer, then the normal mounted-worldbook format.
    return parseStandardWorldbook(JSON.stringify({ entries: standardEntries }), charName + ' 的世界书');
};

const normalizeNative = (raw: Record<string, any>): PreparedCharacterCard => {
    const safe = stripSensitiveCardFields(raw) as Partial<CharacterProfile>;
    const name = text(safe.name);
    if (!name || name.length > 160) throw new Error('糯米机角色卡缺少有效姓名');
    if (safe.mountedWorldbooks != null && !Array.isArray(safe.mountedWorldbooks)) throw new Error('原生角色世界书结构无效');
    const mounts = safe.mountedWorldbooks || [];
    if (mounts.length > MAX_ENTRIES) throw new Error('世界书条目过多');
    const books: Worldbook[] = mounts.map((wb, index) => {
        if (!object(wb) || typeof wb.content !== 'string' || wb.content.length > MAX_ENTRY_TEXT) {
            throw new Error('原生世界书第 ' + (index + 1) + ' 条结构无效');
        }
        return {
            ...wb, id: id('wb'), title: text(wb.title) || '未命名设定',
            category: text(wb.category) || name + ' 的世界书',
            createdAt: Date.now(), updatedAt: Date.now(),
        } as Worldbook;
    });
    const { mountedWorldbooks: _discardMounts, id: _discardId, ...fields } = safe;
    return {
        source: 'sully', character: {
            ...fields, name, description: text(safe.description), systemPrompt: text(safe.systemPrompt),
        }, worldbooks: books, avatarFile: null, warnings: [],
    };
};

/** Pure adapter: CC v1/v2/v3 -> stable character data -> SullyOS fields and worldbook rows. */
export const normalizeCharacterCard = (raw: unknown): PreparedCharacterCard => {
    if (!object(raw)) throw new Error('角色卡必须是 JSON 对象');
    if (raw.type === 'sully_character_card') return normalizeNative(raw);
    let source: PreparedCharacterCard['source'];
    let data: Record<string, any>;
    if (raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3') {
        source = raw.spec === 'chara_card_v3' ? 'tavern-v3' : 'tavern-v2';
        if (!object(raw.data) || typeof raw.spec_version !== 'string' ||
            !raw.spec_version.startsWith(source === 'tavern-v3' ? '3.' : '2.')) {
            throw new Error('酒馆卡版本与 data 结构不匹配');
        }
        data = raw.data;
    } else if (!('spec' in raw) && !('data' in raw) &&
        typeof raw.name === 'string' &&
        // Bare name+description is commonly ordinary app JSON, not a verified V1 card.
        ['description','personality','scenario','first_mes','mes_example']
            .filter(key => typeof raw[key] === 'string').length >= 2) {
        source = 'tavern-v1';
        data = raw;
    } else {
        throw new Error('无法识别角色卡：不是糯米机卡或标准酒馆 V1/V2/V3');
    }
    const name = text(data.name);
    if (!name || name.length > 160) throw new Error('酒馆角色卡缺少有效姓名');
    for (const key of ['description', 'personality', 'scenario']) {
        if (data[key] != null && typeof data[key] !== 'string') throw new Error('角色人设字段 ' + key + ' 无效');
        if (typeof data[key] === 'string' && data[key].length > MAX_JSON) throw new Error('角色人设正文过大');
    }
    const warnings: string[] = [];
    const nick = text(data.nickname);
    const description = normalizeMacros(text(data.description), warnings) +
        (nick && nick !== name ? '\n【角色昵称】' + normalizeMacros(nick, warnings) : '');
    const personality = normalizeMacros(text(data.personality), warnings);
    const worldview = normalizeMacros(stableScenario(text(data.scenario), warnings), warnings);
    // In SullyOS the "description" field is treated as a local nickname/user note
    // by ContextBuilder, not core persona. Preserve it visibly AND also put the
    // exact text into the role instruction, or identity/background is lost in chat.
    // Never import Tavern system_prompt or post-history control instructions.
    const systemPrompt = [
        description.trim() ? '【角色身份与背景】\n' + description.trim() : '',
        personality ? '【角色性格与行为设定】\n' + personality : '',
    ].filter(Boolean).join('\n\n');
    const book = data.character_book;
    const worldbooks = normalizeWorldbooks(book, name, warnings);
    if (!description.trim() && !personality && !worldview && worldbooks.length === 0) {
        throw new Error('角色卡只有姓名，没有可导入的人设或世界书');
    }
    if (source === 'tavern-v3' && data.assets?.some?.((a: any) => a?.uri && a.uri !== 'ccdefault:')) {
        warnings.push('V3 外置素材未导入，仅使用 PNG 本身作为头像');
    }
    return {
        source,
        character: { name, avatar: safeInlineAvatar(data.avatar), description, systemPrompt, worldview },
        worldbooks, avatarFile: null, warnings: [...new Set(warnings)],
    };
};

const readTextMetadata = (png: Uint8Array): { chara?: string; ccv3?: string } => {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const found: { chara?: string; ccv3?: string } = {};
    for (let offset = 8; offset + 12 <= png.length;) {
        const size = view.getUint32(offset);
        const end = offset + 12 + size;
        if (end > png.length) throw new Error('PNG 元数据长度损坏');
        const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
        if (type === 'tEXt') {
            const data = png.subarray(offset + 8, end - 4);
            const separator = data.indexOf(0);
            if (separator > 0 && separator < 80) {
                const keyword = String.fromCharCode(...data.subarray(0, separator));
                if (keyword === 'chara' || keyword === 'ccv3') {
                    if (found[keyword] !== undefined) throw new Error('PNG 含重复 ' + keyword + ' 角色元数据');
                    if (data.length > MAX_JSON * 1.4) throw new Error('PNG 角色元数据过大');
                    found[keyword] = decoder.decode(data.subarray(separator + 1));
                }
            }
        }
        if (type === 'IEND') break;
        offset = end;
    }
    return found;
};

const decodeMetadata = (encoded: string): unknown => {
    const clean = encoded.trim();
    if (!clean || clean.length > MAX_JSON * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) {
        throw new Error('酒馆 PNG 内的角色卡 Base64 无效');
    }
    let bytes: Uint8Array;
    try {
        const binary = atob(clean);
        if (binary.length > MAX_JSON) throw new Error('PNG 角色卡超出大小限制');
        bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        return JSON.parse(decoder.decode(bytes));
    } catch (error) {
        throw new Error('酒馆 PNG 角色卡内容损坏：' + (error instanceof Error ? error.message : '解码失败'));
    }
};

/** Identify the real bytes, not merely the extension. No writes happen here. */
export const readCharacterCardFile = async (file: File): Promise<PreparedCharacterCard> => {
    if (file.size === 0 || file.size > MAX_PNG) throw new Error('角色卡文件为空或超过 32 MB');
    const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (!isPng(signature)) {
        if (file.size > MAX_JSON) throw new Error('JSON 角色卡超过 6 MB');
        let raw: unknown;
        try { raw = JSON.parse(decoder.decode(await file.arrayBuffer())); }
        catch { throw new Error('角色卡 JSON 无效或编码损坏'); }
        return normalizeCharacterCard(raw);
    }
    // pngHasShare also checks the complete PNG signature, chunks, CRC and image data.
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (pngHasShare(bytes)) {
        const raw = JSON.parse(await readShareText(file, 'character'));
        const prepared = normalizeCharacterCard(raw);
        if (prepared.source !== 'sully') throw new Error('糯米机分享块的内容不是原生角色卡');
        return prepared;
    }
    const metadata = readTextMetadata(bytes);
    if (!metadata.ccv3 && !metadata.chara) {
        throw new Error('普通 PNG 不含酒馆角色卡数据，请使用未压缩的角色卡原图');
    }
    // V3 takes precedence; never silently fall back to a conflicting V2 backfill.
    const raw = decodeMetadata(metadata.ccv3 ?? metadata.chara!);
    const prepared = normalizeCharacterCard(raw);
    if (prepared.source === 'sully') throw new Error('酒馆 PNG 元数据并非酒馆角色卡');
    if (metadata.ccv3 && prepared.source !== 'tavern-v3') throw new Error('ccv3 数据版本不匹配');
    prepared.avatarFile = new File([file], file.name || 'character.png', { type: 'image/png' });
    return prepared;
};
