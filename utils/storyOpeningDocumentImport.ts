import type { TavernOpeningGreeting } from '../types';
import { readLinkPersonaDocument } from './linkImportDocuments';

/** One source file is one complete opening. Never split on headings or paragraphs. */
export interface StoryOpeningImportDocument {
    filename: string;
    content: string;
}
export interface StoryOpeningImportPlan {
    greetings: TavernOpeningGreeting[];
    added: TavernOpeningGreeting[];
    skipped: number;
}
export const MAX_STORY_OPENING_FILES = 200;
export const MAX_STORY_OPENING_LENGTH = 200_000;
export const STORY_OPENING_ACCEPT = '.txt,.text,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const openingCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export const compareStoryOpeningNames = (a: string, b: string): number =>
    openingCollator.compare(a, b) || a.localeCompare(b, 'zh-CN');

const isCustom = (item: { id: string; title: string }): boolean => typeof item?.id === 'string' && typeof item.title === 'string' && item.id.startsWith('story-custom-');

/** Leave imported Tavern/Link author order alone; order only local custom openings. */
export function sortCustomStoryOpenings<T extends { id: string; title: string }>(items: readonly T[]): T[] {
    const other = items.filter(item => !isCustom(item));
    const custom = items.filter(isCustom).sort((a,b) => compareStoryOpeningNames(a.title, b.title));
    return [...other, ...custom];
}

const getTitle = (filename: string): string =>
    filename.normalize('NFC').replace(/\.(?:txt|text|docx)$/i, '').trim().slice(0, 60);

/** Validate every file before *any* saved character data is modified. */
export async function readStoryOpeningDocuments(files: readonly File[]): Promise<StoryOpeningImportDocument[]> {
    if (!files.length) return [];
    if (files.length > MAX_STORY_OPENING_FILES) {
        throw new Error(`每次最多导入 ${MAX_STORY_OPENING_FILES} 个开场白文件，请分批选择`);
    }
    const ordered = [...files].sort((a, b) => compareStoryOpeningNames(a.name, b.name));
    const documents: StoryOpeningImportDocument[] = [];
    for (const file of ordered) {
        if (!/\.(?:txt|text|docx)$/i.test(file.name)) {
            throw new Error(`「${file.name}」格式不支持，请选择 TXT 或 DOCX`);
        }
        if (!getTitle(file.name)) throw new Error('有文件缺少可用名称，请重新命名后导入');
        let content: string;
        try {
            content = await readLinkPersonaDocument(file, true);
        } catch (error) {
            const message = error instanceof Error ? error.message : '读取失败';
            throw new Error(`「${file.name}」无法导入：${message}`);
        }
        if (!content.trim()) throw new Error(`「${file.name}」没有可用正文`);
        if (content.length > MAX_STORY_OPENING_LENGTH) {
            throw new Error(`「${file.name}」超过 20 万字符，请拆分后再导入`);
        }
        documents.push({ filename: file.name, content });
    }
    return documents;
}

/** Pure batch planner: duplicates are skipped; same-title different-body files
 * receive numbered names, NEVER overwrite a saved story's source greeting. */
export function planStoryOpeningDocumentImport(
    existing: readonly TavernOpeningGreeting[],
    documents: readonly StoryOpeningImportDocument[],
    otherSources: readonly { id?: string; title?: string; content: string }[] = [],
    makeId: () => string = () => `story-custom-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
): StoryOpeningImportPlan {
    const current = [...existing];
    const added: TavernOpeningGreeting[] = [];
    let skipped = 0;
    // Existing card imports can retain CRLF whereas TXT/DOCX readers normalize
    // to LF. Treat those as the same opening, rather than quietly adding duplicates.
    const bodyKey = (value: string) => value.replace(/\r\n?/g, '\n').trim();
    const sources = [...existing, ...otherSources];
    const seenBodies = new Set(sources
        .filter(row => typeof row?.content === 'string')
        .map(row => bodyKey(row.content)));
    const seenNames = new Set(sources.filter(row => typeof row?.title === 'string')
        .map(row => row.title!.trim().normalize('NFC').toLocaleLowerCase('zh-CN')));
    const usedIds = new Set(sources.map(row => row?.id));
    for (const document of [...documents].sort((a,b) => compareStoryOpeningNames(a.filename,b.filename))) {
        const content = document.content.replace(/\r\n?/g, '\n').trim();
        if (!content || content.length > MAX_STORY_OPENING_LENGTH) {
            throw new Error(`「${document.filename}」正文为空或超过 20 万字符`);
        }
        if (seenBodies.has(bodyKey(content))) { skipped++; continue; }
        const base = getTitle(document.filename);
        if (!base) throw new Error('文件名称为空，无法建立开场白');
        let title = base;
        for (let suffix = 2; seenNames.has(title.toLocaleLowerCase('zh-CN')); suffix++) {
            const extra = ` (${suffix})`;
            title = base.slice(0, 60 - extra.length) + extra;
        }
        let id = makeId();
        // Imported duplicates must never collide with an existing greeting ID.
        for (let tries = 0; usedIds.has(id) && tries < 10; tries++) id = makeId();
        if (usedIds.has(id) || !id.startsWith('story-custom-')) throw new Error('无法生成安全的开场白标识，请重试');
        usedIds.add(id);
        seenNames.add(title.toLocaleLowerCase('zh-CN'));
        seenBodies.add(bodyKey(content));
        const greeting = { id, title, content };
        current.push(greeting);
        added.push(greeting);
    }
    return { greetings: sortCustomStoryOpenings(current), added, skipped };
}
