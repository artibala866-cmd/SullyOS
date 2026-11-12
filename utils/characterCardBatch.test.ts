import { describe, expect, it } from 'vitest';
import { readLocalCharacterCards, MAX_LOCAL_CARD_FILES } from './characterCardBatch';

const jsonFile = (name: string, value: unknown) =>
    new File([JSON.stringify(value)], name, { type: 'application/json' });
const tavern = (name: string, description: string, uid: string) => ({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
        name, description, personality: '性格：' + description,
        first_mes: '开场：' + name,
        extensions: { uuid: uid },
        character_book: {
            entries: [{ uid: 12, comment: '独立世界书', content: '设定：' + name,
                key: [name], constant: true, position: 1 }],
        },
    },
});

describe('local character card multi-selection', () => {
    it('reads both JSON files without overwriting card identity, persona, greetings or worldbooks', async () => {
        const result = await readLocalCharacterCards([
            jsonFile('a.json', tavern('艾', '爱画画', 'source-a')),
            jsonFile('b.json', tavern('贝', '爱唱歌', 'source-b')),
        ]);
        expect(result.source).toBe('local-batch');
        if (result.source !== 'local-batch') return;
        expect(result.fileNames).toEqual(['a.json', 'b.json']);
        expect(result.cards.map(card => card.character.name)).toEqual(['艾', '贝']);
        expect(result.cards.map(card => card.sourceIdentity)).toEqual(['source-a', 'source-b']);
        expect(result.cards[0].character.systemPrompt).toContain('爱画画');
        expect(result.cards[0].character.systemPrompt).not.toContain('爱唱歌');
        expect(result.cards[1].character.systemPrompt).toContain('爱唱歌');
        expect(result.cards[1].character.systemPrompt).not.toContain('爱画画');
        expect(result.cards.map(card => card.character.tavernGreetings?.[0]?.content))
            .toEqual(['开场：艾', '开场：贝']);
        expect(result.cards.map(card => card.worldbooks[0].content))
            .toEqual(['设定：艾', '设定：贝']);
        expect(result.cards[0].worldbooks[0].id).not.toBe(result.cards[1].worldbooks[0].id);
    });

    it('combines a Link bundle and a Tavern file without collapsing the Link characters into one', async () => {
        const link = {
            magic: 'LINK_CHARACTER_SHARE_PNG_V1', version: 1,
            characters: [
                { id: 'l-1', name: '小鹿', description: '小鹿专属人设', localWorldBookIds: ['book-a'],
                    openings: [{ title: '雨夜', opening: '小鹿的开场' }] },
                { id: 'l-2', name: '小鸟', description: '小鸟专属人设', localWorldBookIds: ['book-a'],
                    openings: [{ title: '晴天', opening: '小鸟的开场' }] },
            ],
            worldBooks: [{ id: 'book-a', title: '共享世界', scope: 'local', enabled: true,
                entries: [{ id: '1', title: '地点', content: '共享的街道',
                    activation: 'constant', keys: [], secondaryKeys: [], position: 'before-chat' }] }],
        };
        const result = await readLocalCharacterCards([
            jsonFile('link.json', link),
            jsonFile('c.json', tavern('风', '旅行家', 'tavern-c')),
        ]);
        if (result.source !== 'local-batch') throw new Error('Expected batch');
        expect(result.cards.map(card => card.character.name)).toEqual(['小鹿', '小鸟', '风']);
        expect(result.fileNames).toEqual(['link.json', 'link.json', 'c.json']);
        expect(result.cards[0].character.linkGreetings?.[0].content).toBe('小鹿的开场');
        expect(result.cards[1].character.linkGreetings?.[0].content).toBe('小鸟的开场');
        expect(result.cards[2].character.linkGreetings).toBeUndefined();
        expect(result.cards[0].worldbooks[0].id).toBe(result.cards[1].worldbooks[0].id);
        expect(result.cards[2].worldbooks[0].id).not.toBe(result.cards[0].worldbooks[0].id);
    });

    it('rejects a damaged second file with its filename, without yielding partial cards', async () => {
        await expect(readLocalCharacterCards([
            jsonFile('valid.json', tavern('甲', '正确', 'id-a')),
            new File(['not JSON'], 'broken.json', { type: 'application/json' }),
        ])).rejects.toThrow('broken.json');
    });

    it('keeps the original single-card import format and prevents oversized file selections', async () => {
        const single = await readLocalCharacterCards([jsonFile('one.json', tavern('独立角色', '完整', 'solo'))]);
        expect(single.source).toBe('tavern-v2');
        const tooMany = Array.from({ length: MAX_LOCAL_CARD_FILES + 1 }, (_, index) =>
            jsonFile(`${index}.json`, tavern('角色' + index, '正常', 'id-' + index)));
        await expect(readLocalCharacterCards(tooMany)).rejects.toThrow('最多选择');
    });
});
