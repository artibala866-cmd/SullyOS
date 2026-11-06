import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { adaptTavernOpeningGreeting, tavernOpeningBodyKey } from './tavernOpeningGreeting';
import { normalizeCharacterCard } from './sillyTavernCard';
import { mergeCardGreetings } from './cardImportMerge';
import { resolveStoryOpeningGreeting } from './storyTheater';

const stored = (content: string) => ({
    id: 'tavern-alt-6', title: '备选开场白 6', content,
});
const legacy = '<!-- title:开场白6  -->\r\n<!-- desc:\r\n  雨夜，旧车站。\r\n  对方等候你。\r\n-->\r\n\r\n{{char}}撑开伞。\n<!-- 一句正文内的叙事标记应保留 -->\n\n<scene role="assistant">是你吗？</scene>';
describe('SillyTavern opening metadata compatibility', () => {
    it('extracts title and multiline desc, preserves body HTML, line breaks and {{char}} macros', () => {
        const adapted = adaptTavernOpeningGreeting(stored(legacy));
        expect(adapted.id).toBe('tavern-alt-6');
        expect(adapted.title).toBe('开场白6');
        expect(adapted.description).toBe('雨夜，旧车站。\r\n  对方等候你。');
        expect(adapted.content).toBe('{{char}}撑开伞。\n<!-- 一句正文内的叙事标记应保留 -->\n\n<scene role="assistant">是你吗？</scene>');
        expect(adaptTavernOpeningGreeting(adapted)).toEqual(adapted);
    });
    it('does not strip arbitrary story comments or complete HTML documents', () => {
        const body = '```html\n<!doctype html>\n<!-- 页面脚本备注 -->\n<div>开场页面</div>\n```';
        expect(adaptTavernOpeningGreeting(stored(body)).content).toBe(body);
        const withInterior = '今天雨很大。\n<!-- title:这是剧情中的一部分 -->\n结局仍未定。';
        expect(adaptTavernOpeningGreeting(stored(withInterior)).content).toBe(withInterior);
    });
    it('does not remove malformed, incomplete or ordinary HTML comments', () => {
        const broken = '<!-- desc: 不完整的标记\n正文还在这里';
        expect(adaptTavernOpeningGreeting(stored(broken)).content).toBe(broken);
        const arbitrary = '<!-- 操作提示 -->\n<!-- title:可能是内文 -->\n这是正文';
        expect(adaptTavernOpeningGreeting(stored(arbitrary)).content).toBe(arbitrary);
    });
    it('adapts metadata on import for V3 alternatives, without changing an HTML default opening', () => {
        const html = '```html\r\n<!DOCTYPE html>\r\n<html><body><!-- 页面注释 --><p>内容</p></body></html>\r\n```';
        const card = normalizeCharacterCard({
            spec: 'chara_card_v3', spec_version: '3.0',
            data: {
                name: '示例', description: '设定', first_mes: html,
                alternate_greetings: [legacy],
            },
        });
        expect(card.character.tavernGreetings).toHaveLength(2);
        expect(card.character.tavernGreetings?.[0].content).toBe(html);
        expect(card.character.tavernGreetings?.[1]).toMatchObject({
            id: 'tavern-alt-1', title: '开场白6',
            description: '雨夜，旧车站。\r\n  对方等候你。',
        });
        expect(card.character.tavernGreetings?.[1].content).not.toContain('<!-- title:');
        expect(card.character.tavernGreetings?.[1].content).toContain('<scene role="assistant">');
    });
    it('updates a previously imported legacy greeting without duplicating or changing its ID', () => {
        const previous = stored(legacy);
        const incoming = { ...stored(legacy), id: 'new-random-id', title: '开场白6',
            content: adaptTavernOpeningGreeting(previous).content };
        const updated = mergeCardGreetings([previous], [incoming]);
        expect(updated).toHaveLength(1);
        expect(updated[0].id).toBe(previous.id);
        expect(updated[0].content).toBe(tavernOpeningBodyKey(incoming));
        expect(mergeCardGreetings(updated,[incoming])).toEqual(updated);
    });
    it('selecting an already-imported legacy greeting injects only scene text and resolves names', () => {
        const actor = {
            id: 'actor', name: '测试角色', tavernGreetings: [stored(legacy)],
        } as CharacterProfile;
        const opening = resolveStoryOpeningGreeting({
            characterIds: ['actor'],
            openingGreeting: { characterId: 'actor', greetingId: 'tavern-alt-6' },
        }, [actor], '小瞿');
        expect(opening?.greetingId).toBe('tavern-alt-6');
        expect(opening?.content).toContain('测试角色撑开伞');
        expect(opening?.content).toContain('<scene role="assistant">');
        expect(opening?.content).not.toMatch(/<!--\s*(title|desc)\s*:/i);
    });
    it('supports Chinese full-width colon, case-insensitive metadata and does not drop narrative', () => {
        const opening = stored('<!-- TITLE：第六幕 -->\n<!-- DESCRIPTION：室内独白 -->\n*门缓缓打开。*');
        const result = adaptTavernOpeningGreeting(opening);
        expect(result.title).toBe('第六幕');
        expect(result.description).toBe('室内独白');
        expect(result.content).toBe('*门缓缓打开。*');
    });
});
