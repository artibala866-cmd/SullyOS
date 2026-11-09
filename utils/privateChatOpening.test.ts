import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { findPendingUserTurn } from './chatContinuation';
import { selectCardImportSections } from './cardImportSections';
import { DB } from './db';
import { buildPrivateChatOpeningMessages, listPrivateChatOpenings, parsePrivateChatOpening, privateChatDisplayTimestamp } from './privateChatOpening';
import { normalizeCharacterCard } from './sillyTavernCard';
import { findPendingRealPersonUserTurn } from './realPersonReplyTurn';

const names = { character: '林澈', user: '阿宁' };
const now = new Date(2026, 10, 9, 9, 15);
const phoneText = `[和林澈的聊天]

[对方消息|3rp12v.jpg|在忙吗|17:20]
[己方消息|default.png|忙完啦|18:36]
[对方消息|3rp12v.jpg|  |18:37]
[对方消息|3rp12v.jpg|游戏存档没了|18:39]
[对方消息|3rp12v.jpg|<bqb>阴暗爬行j09btr.jpg</bqb>|18:39]`;
const card = (greetings: string[]) => normalizeCharacterCard({
    spec: 'chara_card_v3', spec_version: '3.0',
    data: { name: names.character, first_mes: '开场白1：（手机）游戏存档', alternate_greetings: greetings },
});
const rows = (content: string, charId = 'opening-character') => buildPrivateChatOpeningMessages(
    { id: 'example', title: '开场', lines: parsePrivateChatOpening(content, names) },
    charId, names, [], now,
);

describe('private chat openings', () => {
    it('recognizes plugin records without executing a plugin and resolves names and sticker fallback', () => {
        const openings = listPrivateChatOpenings(card([phoneText, '[群聊消息|头像|林澈|你好|12:30]', '他望向窗外。']).character);
        expect(openings.map(opening => opening.title)).toEqual(['（手机）游戏存档']);
        const messages = buildPrivateChatOpeningMessages(openings[0], 'role', names, [], now);
        expect(messages.map(({ role, content }) => [role, content])).toEqual([
            ['assistant', '在忙吗'], ['user', '忙完啦'], ['assistant', '游戏存档没了'], ['assistant', '［表情包：阴暗爬行］'],
        ]);
        expect(messages[0].timestamp).toBe(now.getTime());
        expect(privateChatDisplayTimestamp(messages[0])).toBe(new Date(2026, 10, 9, 17, 20).getTime());
        const [sticker] = buildPrivateChatOpeningMessages(openings[0], 'role', names,
            [{ name: '阴暗爬行', url: 'blobref:local-sticker' }], now).slice(-1);
        expect(sticker).toMatchObject({ type: 'emoji', content: 'blobref:local-sticker' });
    });

    it('parses XML, labeled transcripts, date headers, and wrapped or inline times', () => {
        const messages = rows(`<!-- title: 车站 -->
<msg>{{char}}|{{user}}|到了吗？|2025年12月31日 23:59</msg>
<message sender="阿宁" time="00:02">快到了<br>还有一站。</message>
[2026-01-01 00:03] 林澈：好
00:04 林澈：不着急
**00:05 · 阿宁**
我看到你了
【00:06｜对方｜我也看见你了】
2026年2月2日
[对方消息|啊呀|下午 1:15]
`);
        expect(messages.map(message => message.content)).toEqual(['到了吗？', '快到了\n还有一站。', '好', '不着急', '我看到你了', '我也看见你了', '啊呀']);
        expect(messages.map(privateChatDisplayTimestamp)).toEqual([
            new Date(2025, 11, 31, 23, 59), new Date(2026, 0, 1, 0, 2), new Date(2026, 0, 1, 0, 3),
            new Date(2026, 0, 1, 0, 4), new Date(2026, 0, 1, 0, 5), new Date(2026, 0, 1, 0, 6), new Date(2026, 1, 2, 13, 15),
        ].map(date => date.getTime()));
        expect(rows('<script>[对方消息|头像|脚本|08:00]</script>\n林澈：闲聊')).toEqual([]);
        expect(rows('===BLMX_LOG_BEGIN===\n===BLMX_LOG_END===')).toEqual([]);
        expect(rows('[对方消息|头像|你好，{{user}}|08:00]')[0].content).toBe('你好，阿宁');
    });

    it('recognizes newly imported, updated and stored card greetings through the same data path', async () => {
        const first = card([phoneText]);
        const selected = { persona: true, worldbooks: false, greetings: true };
        const fields = selectCardImportSections(first, selected).fields;
        const character = { ...fields, id: 'opening-import-role' } as CharacterProfile;
        await DB.saveCharacter(character);
        expect(listPrivateChatOpenings((await DB.getCharacter(character.id))!)).toHaveLength(1);
        const next = selectCardImportSections(card([phoneText, '[对方消息|头像|第二段|09:30]']), selected).fields;
        await DB.saveCharacter({ ...character, ...next });
        expect(listPrivateChatOpenings((await DB.getCharacter(character.id))!)).toHaveLength(2);
        expect(selectCardImportSections(first, { ...selected, greetings: false }).fields.tavernGreetings).toBeUndefined();
    });

    it('commits a whole opening once and protects existing chat, even on concurrent clicks', async () => {
        const charId = 'opening-atomic';
        await DB.saveCharacter({ id: charId, name: names.character } as CharacterProfile);
        await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '旁路消息', metadata: { source: 'call' } });
        const opening = rows(phoneText, charId);
        const results = await Promise.all([DB.savePrivateChatOpening(charId, opening), DB.savePrivateChatOpening(charId, opening)]);
        expect(results.sort()).toEqual(['saved', 'started']);
        const saved = await DB.getMessagesByCharId(charId);
        expect(saved.slice(1).map(({ id, ...message }) => message)).toEqual(opening);
        await expect(DB.savePrivateChatOpening('missing-role', rows(phoneText, 'missing-role'))).resolves.toBe('missing');

        const existing = 'opening-existing';
        await DB.saveCharacter({ id: existing, name: names.character } as CharacterProfile);
        await DB.saveMessage({ charId: existing, role: 'user', type: 'text', content: '已有记录' });
        await expect(DB.savePrivateChatOpening(existing, rows(phoneText, existing))).resolves.toBe('started');
        expect((await DB.getMessagesByCharId(existing)).map(m => m.content)).toEqual(['已有记录']);
    });

    it('never treats a scripted user line as a newly sent user message', () => {
        const opening = rows('[对方消息|头像|在吗|09:30]\n[己方消息|头像|在|09:31]');
        expect(findPendingUserTurn(opening)).toBeNull();
        expect(findPendingRealPersonUserTurn(opening)).toBeNull();
        expect(findPendingUserTurn([...opening, { role: 'user', content: '这是我发的' }])).toMatchObject({ content: '这是我发的' });
    });
});
