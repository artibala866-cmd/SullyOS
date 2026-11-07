import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { adaptTavernOpeningGreeting, tavernOpeningBodyKey, tavernOpeningReadableText, tavernOpeningAuthorNote, tavernOpeningSceneText, storyOpeningReadingText, stripUnsupportedTavernOpeningEmbeds, stripNonStoryOpeningBlocks, stripWrappedOpeningPayloads } from './tavernOpeningGreeting';
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
        expect(opening?.content).not.toContain('<scene role="assistant">');
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

    it('extracts genuinely unwrapped prose after styled and author-note wrappers', () => {
        const raw = '<request:只叫季淮北>\n<div><h3>包裹标题</h3><p>包裹剧情</p></div>\n'
            + '<!-- title:雨夜原名 -->\n雨夜里，{{char}}撑开伞。';
        expect(tavernOpeningSceneText(raw)).toBe('雨夜里，{{char}}撑开伞。');
        expect(tavernOpeningAuthorNote(raw)).toBe('只叫季淮北');
        const choice = listCharacterStoryOpenings({tavernGreetings:[
            {id:'tavern-alt-44',title:'备用开场',content:raw},
        ]} as CharacterProfile)[0];
        expect(choice.title).toBe('雨夜原名');
        expect(choice.content).toBe('雨夜里，{{char}}撑开伞。');
    });

    it('drops the contents of any styled or fenced HTML instead of unwrapping its story prose', () => {
        const raw = '<style>.x{color:red}</style>\n'
            + '<div><h3>隐藏标题</h3><p>隐藏叙事。</p></div>\n'
            + '<request:只叫季淮北>\n'
            + '~~~html\n<p>隐藏的代码块正文。</p>\n~~~\n'
            + '仅此处是包裹之外的正文。';
        expect(tavernOpeningReadableText(raw)).toBe('仅此处是包裹之外的正文。');
        expect(tavernOpeningReadableText('<div><p>全部被包装。</p></div>')).toBe('');
        expect(tavernOpeningAuthorNote(raw)).toBe('只叫季淮北');
    });

    it('removes nested custom XML, scene and comments without altering stored source', () => {
        const raw='<!-- title:雨夜 -->\n<div><p>包裹里的内容。</p></div>\n'
            + '<scene role="assistant">隐藏的对白。</scene>\n'
            + '<any_new_author_schema>隐藏的状态。</any_new_author_schema>\n'
            + '<!-- 剧情中的注释 -->\n{{char}}走过无人站台。';
        const card={id:'tavern-alt-21',title:'备用开场 21',content:raw};
        const char={id:'actor',name:'季淮北',tavernGreetings:[card]} as CharacterProfile;
        const choice=listCharacterStoryOpenings(char)[0];
        expect(choice.title).toBe('雨夜');
        expect(choice.content).toBe('{{char}}走过无人站台。');
        expect(card.content).toBe(raw);
        expect(resolveStoryOpeningGreeting({
            characterIds:['actor'],openingGreeting:{characterId:'actor',greetingId:card.id},
        },[char],'玩家')?.content).toBe('季淮北走过无人站台。');
    });

    it('cleans legacy first-floor wrappers and leaves saved database and user messages unchanged', () => {
        const opening='<request:一律称为季淮北>\n'
            + '<div><p>包装里的内容。</p></div>\n雨停了，{{char}}醒来。';
        const old={id:1,role:'assistant',type:'text',timestamp:1,charId:'story-theater:1',
            content:opening,metadata:{source:'story_theater',theaterOpeningGreeting:{
                characterId:'actor',greetingId:'tavern-alt-1',
            }}};
        const user={...old,id:2,role:'user',timestamp:2,content:opening,
            metadata:{source:'story_theater'}};
        const history=buildStoryHistory([user,old] as any);
        expect(history[0].content).toBe('雨停了，{{char}}醒来。');
        expect(history[1].content).toBe(opening);
        expect(old.content).toBe(opening);
    });

    it('uses the same prose-only rule for Link while protecting custom openings and author notes', () => {
        const html='<div><p>包裹的 Link 内容。</p></div>\nLink 外面的正文。';
        const char={id:'actor',name:'季淮北',linkGreetings:[
            {id:'link-source-1',title:'Link 开场',content:html},
        ],tavernGreetings:[]} as CharacterProfile;
        expect(listCharacterStoryOpenings(char)[0].content).toBe('Link 外面的正文。');
        expect(storyOpeningReadingText(html,'link-source-1','link')).toBe('Link 外面的正文。');
        expect(storyOpeningReadingText(html,'story-custom-1','custom')).toBe(html);
        const raw='<request:两位季淮北都只能叫季淮北>\n'
            + '<p>包装对白。</p>\n旧街尽头，{{char}}停下脚步。';
        const tavern={...char,tavernGreetings:[{id:'tavern-alt-8',title:'开场八',content:raw}],linkGreetings:[]};
        const resolved=resolveStoryOpeningGreeting({
            characterIds:['actor'],openingGreeting:{characterId:'actor',greetingId:'tavern-alt-8'},
        },[tavern],'玩家');
        expect(resolved?.content).toBe('旧街尽头，季淮北停下脚步。');
        expect(resolved?.authorNote).toBeUndefined(); // wrapped notes must not enter model context
    });

    it('removes Chinese music shortcode together with malformed Markdown MP3 link, without leaving English or URL fragments', () => {
        const raw = '【音乐|Novocaine|"Overdosing over U."|[https://s3plus.meituan.net/opapisdk/op_ticket_1_5673241091_1774826875736_MQkRpr3p_vip.mp3|】](https://s3plus.meituan.net/opapisdk/op_ticket_1_5673241091_1774826875736_MQkRpr3p_vip.mp3|】)';
        const story = [
            '夜色里，季淮北打开了门。',
            raw,
            '他说：“我回来了。”',
        ].join('\n');
        const cleaned = tavernOpeningReadableText(story);
        expect(cleaned).toBe('夜色里，季淮北打开了门。\n\n他说：“我回来了。”');
        expect(cleaned).not.toMatch(/Novocaine|Overdosing|mp3|meituan|[|]】|【音乐/i);
        expect(stripUnsupportedTavernOpeningEmbeds(raw).trim()).toBe('');
        expect(tavernOpeningReadableText(cleaned)).toBe(cleaned);
        expect(story).toContain(raw);
    });

    it('removes decorated status brackets whatever their contents, not merely Spotify labels', () => {
        const url='https://cdn.example.net/one.mp3';
        const widget='【背景音乐|初雪|['+url+'|】]('+url+'|】)';
        const raw='开场。'+widget+'剧情继续。\n'
            +'【音乐|这是故事中的描述】\n'
            +'他留下线索【旧地图|藏在床下】。\n'
            +'他说要听 Novocaine，这句话在包裹外。\n'
            +'这条 https://example.org/diary 是普通正文。';
        const cleaned=tavernOpeningReadableText(raw);
        expect(cleaned).toContain('开场。剧情继续。');
        expect(cleaned).toContain('他留下线索。');
        expect(cleaned).toContain('他说要听 Novocaine，这句话在包裹外。');
        expect(cleaned).not.toContain('【旧地图');
        const card={id:'tavern-alt-42',title:'钢琴夜',content:raw};
        const char={id:'actor',name:'季淮北',tavernGreetings:[card]} as CharacterProfile;
        expect(listCharacterStoryOpenings(char)[0].content).toBe(cleaned);
        expect(card.content).toBe(raw);
        expect(storyOpeningReadingText(raw,'story-custom-1','custom')).toBe(raw);
    });

    it('cleans the Chinese player shortcode from older stored opening messages only, leaving user dialogue untouched', () => {
        const music = '【音乐|Novocaine|链接|[https://static.example/a.mp3|】](https://static.example/a.mp3|】)';
        const old = {id:1,charId:'story-theater:test',role:'assistant',type:'text',timestamp:1,
            content:music+'\n{{char}}说要下雪了。',
            metadata:{source:'story_theater',theaterOpeningGreeting:{characterId:'actor',greetingId:'tavern-first'}}};
        const reply = { ...old, id:2,role:'user',timestamp:2,content:'我在对话里写下 '+music,
            metadata:{source:'story_theater'}};
        const history = buildStoryHistory([reply,old] as any);
        expect(history[0].content).toBe('{{char}}说要下雪了。');
        expect(history[1].content).toContain(music);
        expect(old.content).toContain('【音乐|Novocaine');
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
        expect(visible).not.toMatch(/spotify:|\.gif|\.mp3|\.ogg|\.mp4|example\.org|<iframe|<audio|<video|<source|<img|!\[/i);
        expect(tavernOpeningReadableText(visible)).toBe(visible);
    });

    it('removes all nested HTML layout content even when the text itself is readable', () => {
        expect(tavernOpeningReadableText('<div><form><button>播放音乐</button></form><p>被包裹的正文。</p></div>'))
            .toBe('');
        expect(tavernOpeningReadableText(
            '<details><summary>角色等待</summary><p>包裹里的站台。</p></details>\n只有外面的正文。',
        )).toBe('只有外面的正文。');
    });

    it('removes wrapped labels and Markdown links while retaining ordinary free-text URLs', () => {
        const raw=[
            '[线索: 旧站台的钥匙还在口袋里]',
            '[地图: 城北旧站台]',
            '[music: 角色正在哼一首歌]',
            '她留下了一个网址 https://example.org/diary/scene-1 ，作为线索。',
            '[旧车站](https://example.org/location/old-station)',
            '<scene role="assistant">包裹里的对白。</scene>',
        ].join('\n');
        expect(tavernOpeningReadableText(raw)).toBe(
            '她留下了一个网址 https://example.org/diary/scene-1 ，作为线索。',
        );
        expect(storyOpeningReadingText(raw,'story-custom-11','custom')).toBe(raw);
    });

    it('leaves source bytes and real title intact while removing wrapped parts in new and old stories', () => {
        const spotify='[spotify: 初雪 | https://another-cdn.example/cover.png | https://another-cdn.example/song.mp3]';
        const raw='<!-- title:回到十八岁 -->\n'+spotify
            +'\n<p>被 HTML 包装的情节。</p>\n{{char}}在走廊等{{user}}。';
        const card={id:'tavern-alt-99',title:'备用开场 99',content:raw};
        const char={id:'actor',name:'十八岁季淮北',tavernGreetings:[card]} as CharacterProfile;
        const item=listCharacterStoryOpenings(char)[0];
        expect(item.title).toBe('回到十八岁');
        expect(item.content).toBe('{{char}}在走廊等{{user}}。');
        expect(card.content).toBe(raw);
        expect(resolveStoryOpeningGreeting({
            characterIds:['actor'],openingGreeting:{characterId:'actor',greetingId:card.id},
        },[char],'玩家')?.content).toBe('十八岁季淮北在走廊等玩家。');
        const old={id:11,charId:'story-theater:test',role:'assistant',type:'text',timestamp:1,content:raw,
            metadata:{source:'story_theater',theaterOpeningGreeting:{characterId:'actor',greetingId:card.id}}};
        expect(buildStoryHistory([old as any])[0].content).toBe('{{char}}在走廊等{{user}}。');
        expect(old.content).toBe(raw);
        const preface='[spotify: 午夜 | https://cdn.example/cover.gif | https://cdn.example/music.mp3]\n'
            +'<!-- title:下雪那天 -->\n他从走廊跑来。';
        const choice=listCharacterStoryOpenings({id:'actor',name:'季淮北',
            tavernGreetings:[{id:'tavern-alt-2',title:'备用开场 2',content:preface}]} as CharacterProfile)[0];
        expect(choice.title).toBe('下雪那天');
        expect(choice.content).toBe('他从走廊跑来。');
    });

    it('removes Link envelopes at read time but leaves raw Link and custom cards untouched', () => {
        const music='[spotify: 初雪 | https://static.example/cover.gif | https://static.example/song.mp3]';
        const raw='<div class="native-link"><p>包裹内的情节。</p></div>\n'+music
            +'\n夜里，她在旧桥等他。';
        const greeting={id:'babylink-opening-source-15',title:'Link 初雪',content:raw};
        const char={id:'link-actor',name:'季淮北',linkGreetings:[greeting]} as CharacterProfile;
        const [selected]=listCharacterStoryOpenings(char);
        expect(selected.source).toBe('link');
        expect(selected.content).toBe('夜里，她在旧桥等他。');
        expect(greeting.content).toBe(raw);
        expect(storyOpeningReadingText(raw,greeting.id,'link')).toBe('夜里，她在旧桥等他。');
        expect(storyOpeningReadingText(raw,'story-custom-2','custom')).toBe(raw);
        expect(listCharacterStoryOpenings({linkGreetings:[{...greeting,content:music}]} as CharacterProfile)).toEqual([]);
    });

    it('recognizes the real Chinese pipe-delimited music schema with newlines, not names or domains', () => {
        const original = [
            '!-- note:  -->',
            '<!-- tag: sib -->',
            '季淮北站在旧车站，看着窗外的初雪。',
            '【音乐|Tictoc|"째깍."|',
            'https://s3plus.meituan.net/opapisdk/op_ticket_1_5677168484_1774827739752_eAozMMt0_vip.mp3|】',
            '',
            '【音乐|Novocaine|"Overdosing over U."|https://s3plus.meituan.net/opapisdk/op_ticket_1_5673241091_1774826875736_MQkRpr3p_vip.mp3|】',
            '{{char}}低声说：“要不要听歌？”',
        ].join('\n');
        const clean = tavernOpeningReadableText(original);
        expect(clean).toBe('季淮北站在旧车站，看着窗外的初雪。\n\n{{char}}低声说：“要不要听歌？”');
        expect(clean).not.toMatch(/Tictoc|Novocaine|meituan|mp3|<\!-- tag|!\-\- note|【音乐/);
        expect(tavernOpeningReadableText(clean)).toBe(clean);
        expect(original).toContain('s3plus.meituan.net');
    });

    it('filters identical component schema with alternate brackets, fullwidth separators, streams and unrelated hosts', () => {
        const examples = [
            '【音乐｜夏夜｜<em>播放</em>｜https://another-host.example/sound?id=890｜】',
            '〖背景音乐|两个人|https://cdn.example/stream/89|〗',
            '〔音频|录音|说明|https://cdn.example/recording.ogg|〕',
            '［music｜rain｜https://cdn.example/rain.m4a｜］',
            '[audio|风声|https://cdn.example/audio.mp3|]',
            '【media-card|窗边播放|黑胶|https://cdn.example/music.mp3|】',
            '【音乐|这段解释跨三行| \nhttps://cdn.example/c.mp3\n|】',
        ];
        const combined = '第一幕，钟声响起。\n' + examples.join('\n') + '\n他停下脚步。';
        expect(tavernOpeningReadableText(combined)).toBe('第一幕，钟声响起。\n\n他停下脚步。');
        for (const snippet of examples) expect(stripUnsupportedTavernOpeningEmbeds(snippet).trim()).toBe('');
    });

    it('drops all enclosed decorated content even without URLs and keeps literal quotes in free prose', () => {
        const original=[
            '他说：“初雪这首歌很好听，Novocaine 也不错。”',
            '【音乐|他们在月下合唱】',
            '【音乐|曲目|并不是网址|】',
            '【线索|音乐盒里藏了钥匙|】',
            '【地点|旧站台|https://example.org/diary/story-3|】',
            '[线索: 后门藏着一张地图]',
            '【旧车站的秘密：他看见了她】',
            '网址 https://example.org/map 是日记留下的线索。',
            '<scene name="song">被包裹的台词。</scene>',
        ].join('\n');
        expect(tavernOpeningReadableText(original)).toBe(
            '他说：“初雪这首歌很好听，Novocaine 也不错。”\n\n'
            +'网址 https://example.org/map 是日记留下的线索。',
        );
    });

    it('keeps actual title and outside macros, discarding HTML narrative inside a block', () => {
        const raw='<!-- title:冬天的老车站 -->\n'
            +'【音乐|冬之曲|提示|https://assets.example/song.mp3|】\n'
            +'<p>标签里的剧情。</p>\n{{char}}在雪里等{{user}}。';
        const card={id:'tavern-alt-snow',title:'备用开场 25',content:raw};
        const char={id:'actor',name:'季淮北',tavernGreetings:[card]} as CharacterProfile;
        const scene=listCharacterStoryOpenings(char)[0];
        expect(scene.title).toBe('冬天的老车站');
        expect(scene.content).toBe('{{char}}在雪里等{{user}}。');
        expect(card.content).toBe(raw);
        expect(resolveStoryOpeningGreeting({characterIds:['actor'],
            openingGreeting:{characterId:'actor',greetingId:card.id}},[char],'玩家')?.content)
            .toBe('季淮北在雪里等玩家。');
        const old={role:'assistant',content:raw,metadata:{
            source:'story_theater',theaterOpeningGreeting:{characterId:'actor',greetingId:card.id},
        }};
        expect(buildStoryHistory([old as any])[0].content).toBe('{{char}}在雪里等{{user}}。');
        expect(storyOpeningReadingText(raw,'story-custom-1','custom')).toBe(raw);
    });

    it('removes an entire wb_lore status payload and route marker, never exposing accounts, rules or init fields as prose', () => {
        const raw = [
            '<!-- title:片场的第一天 -->',
            '夜雨里，{{char}}推开片场的门。',
            '<wb_lore>',
            '[账号|user|{{user}}|粉丝:612|关注:48]',
            '[账号|char|左宥之|粉丝:1087万|关注:86]',
            '',
            '【微博撰写要求】',
            '- char：片场碎碎念/阴阳场务/装忙；绝不发「助理」「通告」实锤。',
            '- user：剧组边缘小号，发博像随手记，禁止营业官宣口吻。',
            '- 路人评：多数当普通路人。',
            '- 伪图用 [伪图|描述]。',
            '',
            '【其它初始化】',
            '- 关系：user = 新任助理；片场第一天；外界不知私线。',
            '- 知情范围：公开=影帝人设。',
            '</wb_lore>',
            '<!-- route: 1 -->',
            '他回头问：“你怎么还没走？”',
        ].join('\n');
        const expected = '夜雨里，{{char}}推开片场的门。\n\n他回头问：“你怎么还没走？”';
        expect(tavernOpeningSceneText(raw)).toBe(expected);
        expect(tavernOpeningReadableText(raw)).not.toMatch(/wb_lore|粉丝:|微博撰写要求|其它初始化|route:|伪图/);
        const card = {id:'tavern-alt-wb',title:'备用开场',content:raw};
        const character = {id:'actor',name:'左宥之',tavernGreetings:[card]} as CharacterProfile;
        const option = listCharacterStoryOpenings(character)[0];
        expect(option.title).toBe('片场的第一天');
        expect(option.content).toBe(expected);
        expect(card.content).toBe(raw);
        expect(resolveStoryOpeningGreeting({
            characterIds:['actor'],openingGreeting:{characterId:'actor',greetingId:card.id},
        },[character],'玩家')?.content).toContain('左宥之推开片场的门。');
        const old = {id:10,role:'assistant',content:raw,metadata:{
            source:'story_theater',theaterOpeningGreeting:{characterId:'actor',greetingId:card.id},
        }};
        expect(buildStoryHistory([old as any])[0].content).toBe(expected);
        expect(old.content).toBe(raw);
    });

    it('removes arbitrary tag names regardless of whether the contents look like status data', () => {
        const raw=[
            '<status_panel>[账号|user|甲|粉丝:120|关注:20]</status_panel>',
            '<wb_lore><div>世界书数据</div></wb_lore>',
            '<custom-portal>这里甚至没有结构化字段。</custom-portal>',
            '天色渐亮，故事继续。',
            '<!-- route: 3 -->',
            '<scene role="assistant">标签包裹的对白也不要。</scene>',
        ].join('\n');
        expect(tavernOpeningReadableText(raw)).toBe('天色渐亮，故事继续。');
    });

    it('keeps only prose outside paired markup and preserves incomplete non-paired text', () => {
        const raw=[
            '<scene role="assistant">包裹的对白。</scene>',
            '<dialogue speaker="char">你还好吗？</dialogue>',
            '<div><p>包裹的剧情。</p></div>',
            '<!-- 作者注释 -->',
            '<mystery_fragment>旧信。</mystery_fragment>',
            '《wb_lore》是她在书里看见的字样。',
        ].join('\n');
        expect(tavernOpeningReadableText(raw)).toBe('《wb_lore》是她在书里看见的字样。');
        expect(stripNonStoryOpeningBlocks('<wb_lore>只有开标签，不清楚后续内容'))
            .toContain('只有开标签');
    });

    it('removes any complete wrapped Link block while keeping original saved bytes', () => {
        const raw='<div class="native-link"><p>包裹的内容。</p></div>\n'
            +'<wb_lore><account>临时账号状态</account></wb_lore>\n'
            +'<!-- route: 1 -->\n霓虹下两人再次相遇。';
        const card={id:'babylink-opening-source-77',title:'重逢',content:raw};
        const char={id:'actor',name:'左宥之',linkGreetings:[card]} as CharacterProfile;
        const [choice]=listCharacterStoryOpenings(char);
        expect(choice.source).toBe('link');
        expect(choice.content).toBe('霓虹下两人再次相遇。');
        expect(card.content).toBe(raw);
        expect(storyOpeningReadingText(raw,card.id,'link')).toBe('霓虹下两人再次相遇。');
        expect(storyOpeningReadingText(raw,'story-custom-2','custom')).toBe(raw);
    });

    it('removes every unfamiliar XML, HTML, decorated or fenced envelope without recognizing author names', () => {
        const raw=[
            '真正的第一句。',
            '<unseen_author_object brand="xx"><new_name>整个未知状态。</new_name></unseen_author_object>',
            '<scene role="assistant">标签里的剧情。</scene>',
            '<div><p>HTML 里的剧情。</p></div>',
            '【不认识的专有模块|一整段】',
            '〖没有 URL 的外壳〗',
            '〔其他配置〕',
            '［装饰文字］',
            '[包装中的旁白]',
            '~~~json',
            '{"unknown":"包装代码"}',
            '~~~',
            '<!-- 不属于外部正文的注释 -->',
            '<unused-widget enabled="yes" />',
            '只留下最后的{{char}}对白。',
        ].join('\n');
        expect(tavernOpeningReadableText(raw))
            .toBe('真正的第一句。\n\n只留下最后的{{char}}对白。');
        expect(tavernOpeningReadableText(tavernOpeningReadableText(raw)))
            .toBe(tavernOpeningReadableText(raw));
    });

    it('keeps only literal outside narration and macros even when new unknown wrappers appear inline', () => {
        const raw='他看到【随意模块|内容】后转身。'
            +'{{char}}说：“我没有说谎。”'
            +'<new_schema>不该显示的情节。</new_schema>'
            +'我还想说点别的。';
        expect(tavernOpeningReadableText(raw))
            .toBe('他看到后转身。{{char}}说：“我没有说谎。”我还想说点别的。');
        expect(stripWrappedOpeningPayloads('一 < 2，而 4 > 3。')).toBe('一 < 2，而 4 > 3。');
        expect(stripWrappedOpeningPayloads('前文 <unfinished>未闭合的正文'))
            .toBe('前文 未闭合的正文');
    });

    it('never invents a greeting when the imported text contains only wrapped data', () => {
        const raw='<only-new-schema><another-level>所有内容均包装</another-level></only-new-schema>';
        const card={id:'tavern-alt-empty',title:'备用开场',content:raw};
        const actor={id:'actor',name:'角色',tavernGreetings:[card]} as CharacterProfile;
        expect(listCharacterStoryOpenings(actor)).toEqual([]);
        expect(card.content).toBe(raw);
        expect(stripWrappedOpeningPayloads(raw).trim()).toBe('');
        expect(storyOpeningReadingText(raw,'story-custom-1','custom')).toBe(raw);
    });

});
