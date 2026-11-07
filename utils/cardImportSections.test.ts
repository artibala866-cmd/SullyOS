import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { normalizeCharacterCard } from './sillyTavernCard';
import { normalizeBabyLinkShare } from './babyLinkCard';
import {
    availableCardImportSections, effectiveCardImportSections,
    hasCardImportSelection, selectCardImportSections,
} from './cardImportSections';
import { mergeCardImports } from './cardImportMerge';

const tavernFixture = () => normalizeCharacterCard({
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
        name: '示例酒馆角色', description: '更新角色身份', personality: '更新角色性格',
        scenario: '稳定世界背景', first_mes: '默认开场',
        alternate_greetings: Array.from({ length: 25 }, (_, i) => '备选开场' + i),
        character_book: { entries: Array.from({ length: 13 }, (_, i) => ({
            id: i, comment: '世界条目' + i, content: '第' + i + '条内容',
            key: [], constant: true, position: i ? 'after_char' : 'before_char',
            extensions: { position: i ? 1 : 0 },
        })) },
    },
});
const linkFixture = () => normalizeBabyLinkShare({
    magic: 'LINK_CHARACTER_SHARE_PNG_V1', version: 1,
    characters: [{
        name: '示例Link角色', description: '完整版角色背景',
        nickname: '别名', signature: '', avatar: '', localWorldBookIds: [],
    }],
    worldBooks: [],
}).cards[0];
const createRole = (name: string): CharacterProfile => ({
    id: 'existing', name, avatar: 'user-avatar', description: '原有描述',
    cardImportOrigin: {source:'tavern',originalName:name},
    systemPrompt: '原有人设', worldview: '原有世界背景',
    memories: [{ id: 'saved-memory' }] as unknown as CharacterProfile['memories'],
    tavernGreetings: [{ id: 'my-greeting', title: '我的开场', content: '我的开场内容' }],
    mountedWorldbooks: [],
});
const item = (card: ReturnType<typeof tavernFixture>, role: CharacterProfile, sections: {
    persona: boolean; worldbooks: boolean; greetings: boolean;
}) => {
    const selected = selectCardImportSections(card, sections);
    return {
        ...selected, expectedTargetId: role.id,
        origin: { source: 'tavern' as const, originalName: card.character.name },
        character: { ...role, ...selected.fields },
    };
};

describe('character import section selection', () => {
    it('detects full CCv3 structure: 13 worldbook entries and 26 separate openings', () => {
        const card = tavernFixture();
        expect(card.worldbooks).toHaveLength(13);
        expect(card.character.tavernGreetings).toHaveLength(26);
        expect(card.worldbooks.map(book => book.cardImportKey)).toEqual(
            Array.from({ length: 13 }, (_, i) => 'tavern:' + i));
        expect(availableCardImportSections([card])).toEqual({
            persona: true, worldbooks: true, greetings: true,
        });
    });
    it('Link share with one role and zero books/openings permits persona only', () => {
        const card = linkFixture();
        expect(availableCardImportSections([card])).toEqual({
            persona: true, worldbooks: false, greetings: false,
        });
        const effective = effectiveCardImportSections([card], {
            persona: false, worldbooks: true, greetings: true,
        });
        expect(hasCardImportSelection(effective)).toBe(false);
    });
    it('persona-only input cannot import native phone settings or legacy private fields', () => {
        const native = {
            ...tavernFixture(),
            character: {
                ...tavernFixture().character,
                memories: [{ id: 'private' }],
                phoneState: { privateData: true },
                voiceProfile: { voiceId: 'unwanted' },
                activeMsg2Config: { enabled: true },
                chatBackground: 'private-image',
            } as any,
        };
        const result = selectCardImportSections(native, {
            persona: true, worldbooks: false, greetings: false,
        });
        expect(Object.keys(result.fields).sort()).toEqual([
            'avatar','description','name','systemPrompt','worldview',
        ]);
        expect(result.worldbooks).toEqual([]);
    });

    it('selecting lore only preserves existing persona and greetings and adds 13 books once', () => {
        const role = createRole('示例酒馆角色');
        const first = tavernFixture();
        const loreOnly = { persona: false, worldbooks: true, greetings: false };
        const initial = mergeCardImports([role], [], [item(first, role, loreOnly)]);
        expect(initial.result.booksAdded).toBe(13);
        expect(initial.characters[0].systemPrompt).toBe('原有人设');
        expect(initial.characters[0].description).toBe('原有描述');
        expect(initial.characters[0].tavernGreetings).toEqual(role.tavernGreetings);
        const repeat = mergeCardImports(
            initial.characters, initial.worldbooks,
            [item(tavernFixture(), initial.characters[0], loreOnly)]);
        expect(repeat.result.booksAdded).toBe(0);
        expect(repeat.worldbooks).toHaveLength(0);
        expect(initial.characters[0].mountedWorldbooks).toHaveLength(13);
    });
    it('selecting openings only leaves persona and previously mounted books unchanged', () => {
        const role = createRole('示例酒馆角色');
        const result = mergeCardImports([role], [], [item(tavernFixture(), role, {
            persona: false, worldbooks: false, greetings: true,
        })]);
        expect(result.result.booksAdded).toBe(0);
        expect(result.characters[0].tavernGreetings).toHaveLength(27);
        expect(result.characters[0].systemPrompt).toBe('原有人设');
        expect(result.characters[0].mountedWorldbooks).toEqual([]);
        const second = mergeCardImports([result.characters[0]], [], [
            item(tavernFixture(), result.characters[0], { persona: false, worldbooks: false, greetings: true }),
        ]);
        expect(second.result.unchangedIds).toEqual(['existing']);
    });
    it('selecting persona only cannot silently import greetings or books', () => {
        const role = createRole('示例酒馆角色');
        const result = mergeCardImports([role], [], [item(tavernFixture(), role, {
            persona: true, worldbooks: false, greetings: false,
        })]);
        expect(result.characters[0].systemPrompt).toContain('更新角色性格');
        expect(result.characters[0].tavernGreetings).toEqual(role.tavernGreetings);
        expect(result.result.booksAdded).toBe(0);
        expect(result.characters[0].mountedWorldbooks).toEqual([]);
    });
    it('two keyed world entries sharing a title but with different bodies stay separate', () => {
        const role = createRole('示例酒馆角色');
        const original = tavernFixture();
        const [first, second] = original.worldbooks;
        const books = [
            { ...first, title: '同名章节', content: '版本A', cardImportKey: 'tavern:A' },
            { ...second, title: '同名章节', content: '版本B', cardImportKey: 'tavern:B' },
        ];
        const result = mergeCardImports([role], [], [{
            ...item(original, role, { persona: false, worldbooks: true, greetings: false }),
            worldbooks: books,
        }]);
        expect(result.result.booksAdded).toBe(2);
        expect(result.characters[0].mountedWorldbooks?.map(book => book.content)).toEqual(['版本A', '版本B']);
    });
    it('only available modules from a multi-character share can be checked', () => {
        const booksOnly = tavernFixture();
        const onlyLore = { ...booksOnly,
            character: { ...booksOnly.character, description: '', systemPrompt: '',
                worldview: '', tavernGreetings: [] },
        };
        const noPersona = effectiveCardImportSections([onlyLore], {
            persona: true, worldbooks: true, greetings: true,
        });
        expect(noPersona).toEqual({ persona: false, worldbooks: true, greetings: false });
    });
});
