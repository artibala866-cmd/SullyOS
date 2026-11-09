// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { DB } from './db';
import { buildPrivateChatOpeningMessages, listPrivateChatOpenings, parsePrivateChatOpening } from './privateChatOpening';

const names = { character: '江朔', user: '阿七' };
const bubbles = (text: string) => parsePrivateChatOpening(text, names).map(({ role, text }) => [role, text]);

describe('private chat opening format recognition', () => {
    it('extracts private records from structured data with varied field names and direction indicators', () => {
        const raw = `\`\`\`json
{"conversation":{"date":"2025-03-12","messages":[
  {"sender":"江朔","body":"到了吗？","timestamp":"2025-03-12T08:05:00+08:00"},
  {"isSelf":true,"text":"到了","time":"08:06"},
  {"direction":"incoming","message":"我在门口"}
]}}
\`\`\``;
        const lines = parsePrivateChatOpening(raw, names);
        expect(lines.map(({ role, text }) => [role, text])).toEqual([
            ['assistant', '到了吗？'], ['user', '到了'], ['assistant', '我在门口'],
        ]);
        expect(lines[0]).toMatchObject({ day: { year: 2025, month: 3, day: 12 }, clock: { hour: 8, minute: 5 } });
        expect(lines[2].day).toEqual(lines[0].day);
        expect(bubbles('{"type":"group","messages":[{"sender":"江朔","text":"群消息"}]}')).toEqual([]);
        expect(bubbles('[{"sender":"江朔","text":"一"},{"sender":"路人甲","text":"二"}]')).toEqual([]);
    });

    it('reads pre-rendered message bubbles without carrying over HTML or code', () => {
        const html = `<section class="phone">
            <div class="bubble-incoming"><time datetime="2025-03-12T08:07:00+08:00">8:07</time>
              <span class="bubble-text">吃早饭了吗？<br>我多带了一份</span></div>
            <p data-direction="outgoing" data-time="08:08"><span class="sender">阿七</span>还没</p>
            <div data-sender="{{ char }}"><span data-content>给你留着</span></div>
            <script>window.openingSideEffect = true</script>
        </section>`;
        const lines = parsePrivateChatOpening(html, names);
        expect(lines.map(({ role, text }) => [role, text])).toEqual([
            ['assistant', '吃早饭了吗？\n我多带了一份'], ['user', '还没'], ['assistant', '给你留着'],
        ]);
        expect(lines[0].clock).toMatchObject({ hour: 8, minute: 7 });
        expect(document.querySelector('.phone')).toBeNull();
        expect(window).not.toHaveProperty('openingSideEffect');
    });

    it('distinguishes phone transcripts from ordinary dialogue and group headings', () => {
        expect(bubbles('微信聊天记录\n**江朔：** 好了吗？\n阿七：马上\n我方消息：出门了')).toEqual([
            ['assistant', '好了吗？'], ['user', '马上'], ['user', '出门了'],
        ]);
        expect(bubbles('江朔：到楼下了 [18:41]\n【微信消息｜我方｜收到｜18:42】')).toEqual([
            ['assistant', '到楼下了'], ['user', '收到'],
        ]);
        expect(bubbles('江朔：走吧。\n阿七：嗯。')).toEqual([]);
        expect(bubbles('群聊记录\n江朔：到楼下了 [18:41]')).toEqual([]);
    });

    it('recovers line-oriented phone panels with missing closing brackets and variant separators', () => {
        expect(bubbles(`<手机界面>
<私聊:江朔>
[{{user}}丨你到哪了？
[江朔|avatar.jpg|在楼下
[江朔|avatar.jpg|记得带伞
</私聊:江朔>
</手机界面>`)).toEqual([
            ['user', '你到哪了？'], ['assistant', '在楼下'], ['assistant', '记得带伞'],
        ]);
        expect(bubbles('[对方消息|avatar.jpg|第一行\n第二行|08:30]')).toEqual([['assistant', '第一行\n第二行']]);
        expect(bubbles('[江朔|avatar.jpg|故事里未闭合的旁注')).toEqual([]);
    });

    it('reads content outside the sender label and uses the scene clock ahead of notification times', () => {
        const lines = parsePrivateChatOpening(`[消息|冰咖啡（江朔）]：我到了
[消息|另一个昵称(江朔)]：等你
<status>
|场景|2024.7.18-16:23
<手机动态>
|备忘录：21:00|未接电话：15:20
</status>`, names);
        expect(lines).toMatchObject([
            { role: 'assistant', text: '我到了', day: { year: 2024, month: 7, day: 18 }, clock: { hour: 16, minute: 23 } },
            { role: 'assistant', text: '等你', clock: { hour: 16, minute: 23 } },
        ]);
        expect(bubbles('[消息|其他联系人(林清)]：到了')).toEqual([]);
    });

    it('excludes anonymous group messages while accepting private contact nicknames', () => {
        const a = '[对方消息|avatar-a.png|第一条|12:00]';
        const b = '[对方消息|avatar-b.png|第二条|12:01]';
        expect(bubbles('[和周末聚餐的聊天]\n' + a + '\n' + b)).toEqual([]);
        expect(bubbles('[和阿朔的聊天]\n' + a + '\n' + a)).toHaveLength(2);
        expect(bubbles('[和江朔的聊天]\n' + a + '\n' + b)).toHaveLength(2);
    });

    it('scopes each list to the current character and rejects a deleted or edited source at insertion', async () => {
        const make = (id: string, name: string) => ({
            id, name, tavernGreetings: [{ id: 'tavern-alt-1', title: '（手机）放学后', content: name + '：到啦' }],
        }) as CharacterProfile;
        const one = make('opening-source-a', names.character);
        const two = make('opening-source-b', '叶葵');
        await DB.saveCharacter(one);
        await DB.saveCharacter(two);
        const [opening] = listPrivateChatOpenings(one, names.user);
        expect(listPrivateChatOpenings(two, names.user)[0].lines[0].text).toBe('到啦');
        const rows = buildPrivateChatOpeningMessages(opening, one.id, names, []);
        await DB.saveCharacter({ ...one, tavernGreetings: [] });
        expect(listPrivateChatOpenings((await DB.getCharacter(one.id))!, names.user)).toEqual([]);
        await expect(DB.savePrivateChatOpening(one.id, rows, opening.source)).resolves.toBe('changed');
        await expect(DB.savePrivateChatOpening(two.id, rows.map(row => ({ ...row, charId: two.id })), opening.source)).resolves.toBe('changed');
        expect(await DB.getMessagesByCharId(one.id)).toEqual([]);
        expect(await DB.getMessagesByCharId(two.id)).toEqual([]);
    });
});
