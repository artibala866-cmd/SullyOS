import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { adaptTavernOpeningGreeting, tavernOpeningBodyKey, tavernOpeningReadableText, tavernOpeningAuthorNote, tavernOpeningSceneText, storyOpeningReadingText, stripUnsupportedTavernOpeningEmbeds } from './tavernOpeningGreeting';
import { normalizeCharacterCard } from './sillyTavernCard';
import { mergeCardGreetings } from './cardImportMerge';
import { buildStoryHistory, resolveStoryOpeningGreeting } from './storyTheater';
import { listCharacterStoryOpenings } from './linkStoryOpenings';

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
    it('keeps old saved first-message history untouched while removing only metadata from future AI context', () => {
        const oldOpeningMessage = {
            id: 1, timestamp: 1, role: 'assistant', charId: 'story-id',
            type: 'text', content: legacy,
            metadata: {
                source: 'story_theater',
                theaterOpeningGreeting: { characterId: 'actor', greetingId: 'tavern-alt-6' },
            },
        } as any;
        const ordinaryMessage = {
            ...oldOpeningMessage, id: 2, timestamp: 2, role: 'user',
            metadata: { source: 'story_theater' },
            content: '<!-- title:这是用户实际输入的文字 -->\\n我在这里',
        };
        const history = buildStoryHistory([ordinaryMessage, oldOpeningMessage]);
        expect(history[0].content).toContain('{{char}}撑开伞');
        expect(history[0].content).not.toContain('<!-- title:');
        expect(history[0].content).not.toContain('<!-- desc:');
        expect(history[1].content).toBe(ordinaryMessage.content);
        expect(oldOpeningMessage.content).toBe(legacy); // no historical DB mutation
    });

    it('supports Chinese full-width colon, case-insensitive metadata and does not drop narrative', () => {
        const opening = stored('<!-- TITLE：第六幕 -->\n<!-- DESCRIPTION：室内独白 -->\n*门缓缓打开。*');
        const result = adaptTavernOpeningGreeting(opening);
        expect(result.title).toBe('第六幕');
        expect(result.description).toBe('室内独白');
        expect(result.content).toBe('*门缓缓打开。*');
    });

    it('recognizes generic author requests and styled HTML without showing English style code in the story', () => {
        const raw = [
            '<request:两个季淮北的称呼应该都是季淮北,禁止出现本体/IF这样的称呼,或者直接让28岁的季淮北称呼是tavern>',
            '<div style="margin: 15px 0; font-family: \'PingFang SC\', \'Noto Sans SC\', sans-serif;">',
            '<h3 style="background-color: #f0f4f8; color: #4c6680; padding: 8px 16px; border-radius: 4px;">雨夜 · 铁锈街</h3>',
            '<p>烟头烫在水泥地上，嘶一声，火星死了。{{char}}看见{{user}}。</p>',
            '</div>',
        ].join('\n');
        const visible = tavernOpeningReadableText(raw);
        expect(visible).toContain('雨夜 · 铁锈街');
        expect(visible).toContain('烟头烫在水泥地上');
        expect(visible).toContain('{{char}}看见{{user}}');
        expect(visible).not.toMatch(/<request:|<div\b|<h3\b|style=|font-family|PingFang/i);
        expect(tavernOpeningAuthorNote(raw)).toContain('两个季淮北的称呼应该都是季淮北');
        const requestFirst = '<request:只叫他季淮北>\n<!-- title:雨夜原名 -->\n<p>开场正文。</p>';
        const choice = listCharacterStoryOpenings({
            tavernGreetings: [{id:'tavern-alt-44',title:'备选开场白 44',content:requestFirst}],
            linkGreetings: [],
        } as unknown as CharacterProfile)[0];
        expect(choice.title).toBe('雨夜原名');
        expect(choice.content).toBe('开场正文。');
        expect(tavernOpeningSceneText(requestFirst)).toBe('开场正文。');
    });

    it('keeps plot text inside nested HTML while hiding script, CSS and empty layout wrappers', () => {
        const raw = '<style>.panel{font:15px serif}</style>\n'
            + '<div><h3 style="background:#abc">栀子花开</h3>'
            + '<section><p>他轻声说：&quot;你回来了。&quot;</p><p>第二段。</p></section></div>'
            + '\n```css\n.status{color:red}\n```\n';
        const text = tavernOpeningReadableText(raw);
        expect(text).toContain('栀子花开');
        expect(text).toContain('他轻声说："你回来了。"');
        expect(text).toContain('第二段。');
        expect(text).not.toMatch(/style|status|font:|<div|<section|```/i);
        expect(tavernOpeningReadableText('<div><request:只叫他季淮北>\n<p>故事开场</p></div>'))
            .toBe('故事开场');
        expect(tavernOpeningReadableText('<div><p><request:不使用本体和IF称呼>车站正下着雨。</p></div>'))
            .toBe('车站正下着雨。');
        expect(tavernOpeningAuthorNote('<div><p><request:只称呼季淮北>后来他们相遇。</p></div>'))
            .toBe('只称呼季淮北');
        expect(tavernOpeningReadableText('<style>.foo { color:red }</style>')).toBe('');
    });

    it('does not remove meaningful story XML tags, macros, or change the imported source card', () => {
        const raw = '<!-- title:雨夜 -->\n<div class="legacy"><p>{{char}}撑开伞。</p></div>\n'
            + '<scene role="assistant">别走。</scene>\n<!-- 剧情内的作者标记 -->';
        const card = { id:'tavern-alt-21',title:'备选开场 21',content:raw };
        const char = {id:'actor',name:'季淮北',tavernGreetings:[card]} as CharacterProfile;
        const selected = listCharacterStoryOpenings(char)[0];
        expect(selected.title).toBe('雨夜');
        expect(selected.content).toContain('{{char}}撑开伞');
        expect(selected.content).toContain('<scene role="assistant">');
        expect(selected.content).toContain('<!-- 剧情内的作者标记 -->');
        expect(selected.content).not.toContain('<div class=');
        expect(card.content).toBe(raw);
        expect(resolveStoryOpeningGreeting({
            characterIds:['actor'],openingGreeting:{characterId:'actor',greetingId:card.id},
        },[char],'玩家')?.content).toContain('季淮北撑开伞');
    });

    it('cleans old first floors in display and AI context without rewriting database messages', () => {
        const opening='<request:一律称为季淮北>\n<div style="margin:12px"><p>雨停了，{{char}}醒来。</p></div>';
        const old = {id:1,role:'assistant',type:'text',timestamp:1,charId:'story-theater:1',content:opening,
            metadata:{source:'story_theater',theaterOpeningGreeting:{characterId:'actor',greetingId:'tavern-alt-1'}}};
        const user={...old,id:2,role:'user',timestamp:2,content:opening,
            metadata:{source:'story_theater'}};
        const history=buildStoryHistory([user,old] as any);
        expect(history[0].content).toBe('雨停了，{{char}}醒来。');
        expect(history[1].content).toBe(opening);
        expect(old.content).toBe(opening);
        expect(storyOpeningReadingText(opening,'tavern-alt-1')).toBe('雨停了，{{char}}醒来。');
    });

    it('never strips native Link or self-written HTML and keeps authored notes separate from the first floor', () => {
        const html='<div style="color:red"><p>Link 自带原始 HTML 正文。</p></div>';
        const char={id:'actor',name:'季淮北',linkGreetings:[{id:'link-source-1',title:'Link 原生开场',content:html}],tavernGreetings:[]} as unknown as CharacterProfile;
        expect(listCharacterStoryOpenings(char)[0].content).toBe(html);
        expect(storyOpeningReadingText(html,'link-source-1','link')).toBe(html);
        expect(storyOpeningReadingText(html,'story-custom-1','custom')).toBe(html);
        const scene='<request:两位季淮北都只能叫季淮北>\n<p>旧街尽头，{{char}}停下脚步。</p>';
        const tavern={...char,tavernGreetings:[{id:'tavern-alt-8',title:'开场八',content:scene}],linkGreetings:[]};
        const resolved=resolveStoryOpeningGreeting({
            characterIds:['actor'], openingGreeting:{characterId:'actor',greetingId:'tavern-alt-8'},
        },[tavern],'玩家');
        expect(resolved?.content).toBe('旧街尽头，季淮北停下脚步。');
        expect(resolved?.authorNote).toBe('两位季淮北都只能叫季淮北');
        expect(resolved?.source).toBe('tavern');
    });
    it('external media widgets are stripped regardless of author or hosting domain, leaving real plot prose', () => {
        const opening = [
            '暮色降临，他推开了旧车站的门。',
            '[spotify: time machine | ˚˖ 𓂂ꔫ Music ⊹꙳◦ | https://i.postimg.cc/NM4bQjxb/2.gif | https://files.catbox.moe/fkzat7.mp3]',
            '[spotify: 初雪 | ˚˖ 𓂂ꔫ Music ⊹꙳◦ | https://i.postimg.cc/NM4bQjxb/2.gif | https://files.catbox.moe/sndokv.mp3]',
            '[map: 夜间车站 | https://example.org/maps/embed?location=station]',
            '<iframe title="作者的外部地图" src="https://example.org/maps/embed?place=home"></iframe>',
            '<audio controls src="https://example.org/theme.mp3"><source src="https://example.org/backup.ogg"></audio>',
            '<video src="https://example.org/clip.mp4" autoplay></video>',
            '<img src="https://example.org/cover.gif" alt="装饰封面">',
            '![装饰小卡片](https://example.org/a.png)',
            'https://example.org/music.mp3',
            'https://example.org/maps/place/old-station',
            '他把车票递给{{user}}，说：“初雪到了。”',
        ].join('\n');
        const visible = tavernOpeningReadableText(opening);
        expect(visible).toContain('暮色降临，他推开了旧车站的门。');
        expect(visible).toContain('他把车票递给{{user}}，说：“初雪到了。”');
        expect(visible).not.toMatch(/spotify:|\\.gif|\\.mp3|\\.ogg|\\.mp4|example\\.org|<iframe|<audio|<video|<source|<img|!\\[/i);
        expect(tavernOpeningReadableText(visible)).toBe(visible);
    });

    it('handles multiline third-party embeds, generic widget labels and audio or map decorations', () => {
        const raw = [
            '[soundtrack: 主题曲 |',
            '  https://any-cdn.example/pic.gif |',
            '  https://any-cdn.example/sound.m4a]',
            '[地图显示: 城北水库 | https://any-cdn.example/maps/route/123]',
            '[time-machine-widget: state | https://any-cdn.example/card.webp | https://any-cdn.example/player.mp3]',
            '[spotify: 独立播放器]',
            '这里才是{{char}}真正说的话。',
        ].join('\n');
        const visible = tavernOpeningReadableText(raw);
        expect(visible).toBe('这里才是{{char}}真正说的话。');
        expect(tavernOpeningReadableText(
            '[googlemaps: 地图 | https://example.org/maps/place/old-town]\n'
            + '[custom-external: link | https://example.org/embed/scene]\n正文',
        )).toBe('正文');
        expect(tavernOpeningReadableText(
            '<div><form><button>打开播放器</button><input value="播放" /></form>'
            + '<details><summary>角色正在等待</summary><p>旧站台。</p></details></div>',
        )).toContain('旧站台。');
        expect(tavernOpeningReadableText(
            '<div><form><button>播放音乐</button></form><p>这里是剧情。</p></div>',
        )).toBe('这里是剧情。');
    });

    it('keeps narrative addresses, written location hints, dialogue, user links and story XML instead of globally deleting URLs', () => {
        const raw = [
            '[线索: 旧站台的钥匙还在口袋里]',
            '[地图: 城北旧站台]',
            '[music: 角色正在哼一首歌]',
            '她给他留下了一个网址 https://example.org/diary/scene-1 ，作为线索。',
            '[旧车站](https://example.org/location/old-station)',
            '<scene role="assistant">请看这张地图上的旧城。</scene>',
        ].join('\n');
        const visible = tavernOpeningReadableText(raw);
        expect(visible).toContain('[线索: 旧站台的钥匙还在口袋里]');
        expect(visible).toContain('[地图: 城北旧站台]');
        expect(visible).toContain('[music: 角色正在哼一首歌]');
        expect(visible).toContain('她给他留下了一个网址 https://example.org/diary/scene-1 ，作为线索。');
        expect(visible).toContain('旧车站');
        expect(visible).not.toContain('https://example.org/location/old-station');
        expect(visible).toContain('<scene role="assistant">');
    });

    it('does not mutate stored Tavern cards or Link/custom openings and cleans existing marked first floors', () => {
        const spotify = '[spotify: 初雪 | https://another-cdn.example/cover.png | https://another-cdn.example/song.mp3]';
        const raw = '<!-- title:回到十八岁 -->\n' + spotify + '\n<p>{{char}}在走廊等{{user}}。</p>';
        const sourceCard = { id:'tavern-alt-99',title:'备选开场 99',content:raw };
        const actor = {id:'actor',name:'十八岁季淮北',tavernGreetings:[sourceCard]} as CharacterProfile;
        const item = listCharacterStoryOpenings(actor)[0];
        expect(item.title).toBe('回到十八岁');
        expect(item.content).toBe('{{char}}在走廊等{{user}}。');
        expect(sourceCard.content).toBe(raw);
        expect(resolveStoryOpeningGreeting({characterIds:['actor'],
            openingGreeting:{characterId:'actor',greetingId:'tavern-alt-99'}},[actor],'玩家')?.content)
            .toBe('十八岁季淮北在走廊等玩家。');
        const oldOpening = {id:11,charId:'story-theater:test',role:'assistant',content:raw,type:'text',timestamp:1,
            metadata:{source:'story_theater',theaterOpeningGreeting:{characterId:'actor',greetingId:'tavern-alt-99'}}};
        expect(buildStoryHistory([oldOpening as any])[0].content).toBe('{{char}}在走廊等{{user}}。');
        expect(oldOpening.content).toBe(raw);
        expect(storyOpeningReadingText(raw,'link-opening:existing','link')).toBe(raw);
        expect(storyOpeningReadingText(raw,'story-custom-1','custom')).toBe(raw);
        expect(stripUnsupportedTavernOpeningEmbeds(raw)).toContain('<!-- title:回到十八岁 -->');
        const preface = '[spotify: 午夜 | https://cdn.example/cover.gif | https://cdn.example/music.mp3]\n'
            + '<!-- title:下雪那天 -->\n<p>他从走廊跑来。</p>';
        const refreshed = listCharacterStoryOpenings({id:'actor', name:'季淮北',
            tavernGreetings:[{id:'tavern-alt-2',title:'备选开场 2',content:preface}],
        } as CharacterProfile)[0];
        expect(refreshed.title).toBe('下雪那天');
        expect(refreshed.content).toBe('他从走廊跑来。');
        const malformed = '[线索: 书架第三层\n'
            + '[spotify: 初雪 | https://cdn.example/card.gif | https://cdn.example/song.mp3]\n正文';
        expect(tavernOpeningReadableText(malformed)).toContain('[线索: 书架第三层');
        expect(tavernOpeningReadableText(malformed)).not.toContain('spotify:');
    });

});
