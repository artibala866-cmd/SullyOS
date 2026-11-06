import { describe, expect, it } from 'vitest';
import type { CardImportOrigin, CharacterProfile, Worldbook } from '../types';
import { DB } from './db';
import { mergeCardImports, findCardImportTarget, type CardImportItem } from './cardImportMerge';
import { toMountedWorldbook } from './worldbook';

const source: CardImportOrigin = { source: 'tavern', originalName: '雨生' };
const char = (id: string, extra: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id, name: '雨生', avatar: '', description: '旧描述', systemPrompt: '旧人设',
    memories: [], mountedWorldbooks: [], ...extra,
});
const lore = (id: string, content = '旧世界观', extra: Partial<Worldbook> = {}): Worldbook => ({
    id, title: '城镇', content, category: '雨生 的世界书', cardImportKey: 'tavern:21',
    sourceUid: 21, createdAt: 1, updatedAt: 1, ...extra,
});
const card = (id: string, origin: CardImportOrigin, fields: Partial<CharacterProfile>,
    worldbooks: Worldbook[] = [], expectedTargetId: string | null = null): CardImportItem => ({
    expectedTargetId,
    origin,
    fields: { name: '雨生', ...fields },
    worldbooks,
    character: char(id, { ...fields, cardImportOrigin: origin, mountedWorldbooks: worldbooks.map(toMountedWorldbook) }),
});

describe('incremental character-card imports', () => {
    it('keeps an existing character ID, chat state and manual preferences while updating card fields', () => {
        const oldBook = lore('book-old');
        const original = char('original', {
            mountedWorldbooks: [toMountedWorldbook(oldBook)],
            cardImportOrigin: source,
            memories: [{ id: 'memory-1', content: '共同经历' }] as unknown as CharacterProfile['memories'],
            groupId: 'local-group', dialogueApi: { enabled: false } as unknown as CharacterProfile['dialogueApi'],
            tavernGreetings: [{ id: 'tavern-first', title: '默认开场白', content: '早安' }],
        });
        const incoming = card('never-use-this-id', source, {
            description: '新描述', systemPrompt: '新的人设',
            tavernGreetings: [
                { id: 'tavern-first', title: '默认开场白', content: '午安' },
                { id: 'tavern-alt-1', title: '备选开场白 1', content: '欢迎' },
            ],
        }, [lore('generated-random-id', '更新后的世界观')], 'original');
        const plan = mergeCardImports([original], [oldBook], [incoming]);
        expect(plan.result).toMatchObject({
            createdIds: [], updatedIds: ['original'], booksAdded: 0, booksUpdated: 1,
        });
        const merged = plan.characters.find(c => c.id === 'original')!;
        expect(merged.id).toBe('original');
        expect(merged.systemPrompt).toBe('新的人设');
        expect(merged.memories).toEqual(original.memories);
        expect(merged.groupId).toBe('local-group');
        expect(merged.dialogueApi).toEqual(original.dialogueApi);
        expect(merged.tavernGreetings?.map(g => g.content)).toEqual(['午安', '欢迎']);
        expect(merged.mountedWorldbooks?.map(b => b.id)).toEqual(['book-old']);
        expect(plan.worldbooks[0]).toMatchObject({
            id: 'book-old', content: '更新后的世界观', createdAt: 1,
        });
    });

    it('does not repeat old greetings or create duplicate lore on a second identical import', () => {
        const incoming = card('new', source, {
            systemPrompt: '已更新',
            tavernGreetings: [{ id: 'tavern-first', title: '默认开场白', content: '你好' }],
        }, [lore('new-book')]);
        const first = mergeCardImports([], [], [incoming]);
        const current = first.characters[0], book = first.worldbooks[0];
        const repeat = card('another-random-id', source, {
            systemPrompt: '已更新',
            tavernGreetings: [{ id: 'tavern-first', title: '默认开场白', content: '你好' }],
        }, [lore('random-again')], current.id);
        const second = mergeCardImports([current], [book], [repeat]);
        expect(second.result).toMatchObject({
            createdIds: [], updatedIds: [], unchangedIds: ['new'], booksAdded: 0, booksUpdated: 0,
        });
        expect(second.characters).toHaveLength(0);
        expect(second.worldbooks).toHaveLength(0);
    });

    it('handles legacy imported cards by name and original Tavern UID', () => {
        const existingBook = lore('legacy-lore', '旧正文', { cardImportKey: undefined });
        const legacy = char('legacy-role', { mountedWorldbooks: [toMountedWorldbook(existingBook)] });
        const item = card('unused', source, { systemPrompt: '新正文' },
            [lore('new-random-id', '新正文')], 'legacy-role');
        const plan = mergeCardImports([legacy], [existingBook], [item]);
        expect(findCardImportTarget([legacy], source, '雨 生')?.id).toBe('legacy-role');
        expect(plan.result).toMatchObject({ createdIds: [], booksAdded: 0, booksUpdated: 1 });
    });

    it('keeps newly added modules and skips empty incoming fields, without erasing existing modules', () => {
        const original = char('role', { worldview: '原来的世界背景', cardImportOrigin: source });
        const plan = mergeCardImports([original], [], [
            card('unused', source, { systemPrompt: '', description: '', tavernGreetings: [
                { id: 'new', title: '补充', content: '第一次添加' },
            ] }, [], 'role'),
        ]);
        const updated = plan.characters[0];
        expect(updated.worldview).toBe('原来的世界背景');
        expect(updated.systemPrompt).toBe('旧人设');
        expect(updated.tavernGreetings).toHaveLength(1);
    });

    it('syncs a changed shared Link lorebook to all roles without changing their other fields', () => {
        const shared = lore('shared', '原设定', { cardImportKey: 'babylink:book:entry' });
        const originA: CardImportOrigin = { source: 'babylink', externalId: 'a', originalName: '雨生' };
        const originB: CardImportOrigin = { source: 'babylink', externalId: 'b', originalName: '另外一人' };
        const a = char('role-a', { cardImportOrigin: originA, mountedWorldbooks: [toMountedWorldbook(shared)] });
        const b = char('role-b', {
            name: '另外一人', systemPrompt: '另一个人的私人人设', cardImportOrigin: originB,
            mountedWorldbooks: [toMountedWorldbook(shared)],
        });
        const plan = mergeCardImports([a, b], [shared], [
            card('unused', originA, { systemPrompt: '新的主角色人设' },
                [lore('changed-id', '共享条目更新', { cardImportKey: 'babylink:book:entry' })], 'role-a'),
        ]);
        expect(plan.result.booksAdded).toBe(0);
        expect(plan.worldbooks[0].id).toBe('shared');
        expect(plan.characters.find(char => char.id === 'role-b')?.systemPrompt).toBe('另一个人的私人人设');
        expect(plan.characters.find(char => char.id === 'role-b')?.mountedWorldbooks?.[0].content).toBe('共享条目更新');
    });

    it('rejects ambiguous or conflicting same-named roles rather than overwriting one', () => {
        expect(() => findCardImportTarget([char('a'), char('b')], source, '雨生'))
            .toThrow('多个同名');
        const anotherId: CardImportOrigin = { source: 'babylink', externalId: 'different', originalName: '雨生' };
        const old = char('role', {
            cardImportOrigin: { ...anotherId, externalId: 'old' },
        });
        expect(() => findCardImportTarget([old], anotherId, '雨生')).toThrow('不同的卡片身份');
    });

    it('a deleted role leaves no identity tombstone: orphaned library rows cannot block fresh import', () => {
        const staleBook = lore('orphan', '删除前的世界观');
        const newCard = card('fresh', source, { systemPrompt: '重新开始' }, [lore('fresh-lore')]);
        const plan = mergeCardImports([], [staleBook], [newCard]);
        expect(plan.result).toMatchObject({ createdIds: ['fresh'], booksAdded: 1 });
        expect(plan.characters[0].id).toBe('fresh');
        expect(plan.worldbooks.find(book => book.id === 'fresh-lore')).toBeTruthy();
    });

    it('refuses to apply a stale plan if a role was deleted while media processed', () => {
        const original = char('gone', { cardImportOrigin: source });
        const oldPlan = card('new-id', source, { systemPrompt: '新内容' }, [], original.id);
        expect(() => mergeCardImports([], [], [oldPlan])).toThrow('角色列表发生变化');
    });

    it('persists incremental updates and fresh imports atomically in IndexedDB', async () => {
        const suffix = crypto.randomUUID();
        const name = '导入测试' + suffix;
        const origin: CardImportOrigin = { source: 'tavern', originalName: name };
        const book = lore('lore-' + suffix);
        const first = card('role-' + suffix, origin, { name, systemPrompt: '版本一' }, [book]);
        const firstResult = await DB.importCharacterCardsSmartAtomic([first]);
        expect(firstResult.createdIds).toEqual(['role-' + suffix]);
        const second = card('new-' + suffix, origin, { name, systemPrompt: '版本二' }, [
            lore('random-' + suffix, '新增正文'),
        ], 'role-' + suffix);
        const secondResult = await DB.importCharacterCardsSmartAtomic([second]);
        expect(secondResult).toMatchObject({ createdIds: [], booksAdded: 0, booksUpdated: 1 });
        expect((await DB.getCharacter('role-' + suffix))?.systemPrompt).toBe('版本二');
        expect((await DB.getCharacter('new-' + suffix))).toBeUndefined();
        expect((await DB.getCharacter('role-' + suffix))?.mountedWorldbooks?.[0].id).toBe(book.id);
        await DB.deleteCharacter('role-' + suffix);
        const third = card('fresh-' + suffix, origin, { name, systemPrompt: '重新开始' },
            [lore('fresh-lore-' + suffix)], null);
        const result = await DB.importCharacterCardsSmartAtomic([third]);
        expect(result.createdIds).toEqual(['fresh-' + suffix]);
        expect(await DB.getCharacter('fresh-' + suffix)).toBeTruthy();
        await DB.deleteCharacter('fresh-' + suffix);
    });
});
