import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { normalizeBabyLinkShare } from './babyLinkCard';
import { mergeCardImports } from './cardImportMerge';
import { availableCardImportSections, effectiveCardImportSections, selectCardImportSections } from './cardImportSections';
import { listCharacterStoryOpenings, mergeLinkGreetings } from './linkStoryOpenings';
import { resolveStoryOpeningGreeting } from './storyTheater';

const card = (openings?: unknown) => normalizeBabyLinkShare({
    magic: 'LINK_CHARACTER_SHARE_PNG_V1', version: 1,
    characters: [{
        id: 'source-42', name: 'Link测试角色', description: '原始完整人设',
        avatar: '', nickname: '', signature: '', localWorldBookIds: [],
        ...(openings === undefined ? {} : { openings }),
    }],
    worldBooks: [],
}).cards[0];

const existingRole = (): CharacterProfile => ({
    id: 'local-role', name: 'Link测试角色', avatar: '', description: '本地简介',
    systemPrompt: '本地人设', memories: [], mountedWorldbooks: [],
    tavernGreetings: [{id: 'story-custom-1', title: '相遇', content: '用户自己写的开场'}],
    linkGreetings: [{id: 'link-opening:old', title: '本地 Link', content: '已经存着的 Link 正文'}],
} as CharacterProfile);

const importOnlyLinkOpenings = (source: ReturnType<typeof card>, target = existingRole()) => {
    const sections = { persona: false, worldbooks: false, greetings: true };
    const selected = selectCardImportSections(source, sections);
    return mergeCardImports([target], [], [{
        ...selected, expectedTargetId: target.id, worldbooks: [],
        character: { ...target, ...selected.fields },
        origin: { source: 'babylink' as const, externalId: 'source-42', originalName: target.name },
    }]).characters[0];
};

describe('Link 开场白导入到剧情的实际闭环', () => {
    it('纯开场包可勾选导入，且不覆盖人设、世界书、酒馆开场或手写开场', () => {
        const prepared = card([{title:'相遇', opening:'Link 的另一段相遇'},
            {title:'黄昏', opening:'{{char}}在黄昏等{{user}}。'}]);
        expect(availableCardImportSections([prepared]).greetings).toBe(true);
        expect(effectiveCardImportSections([prepared], {persona:false,worldbooks:false,greetings:true}))
            .toEqual({persona:false,worldbooks:false,greetings:true});
        const original = existingRole();
        const updated = importOnlyLinkOpenings(prepared, original);
        expect(updated.systemPrompt).toBe('本地人设');
        expect(updated.description).toBe('本地简介');
        expect(updated.tavernGreetings).toEqual(original.tavernGreetings);
        expect(updated.linkGreetings).toHaveLength(3);
        expect(updated.linkGreetings?.map(g=>g.content)).toContain('Link 的另一段相遇');
        expect(listCharacterStoryOpenings(updated).map(g=>g.source)).toEqual(['link','link','link','custom']);
        const selected = updated.linkGreetings!.find(g=>g.title==='黄昏')!;
        expect(resolveStoryOpeningGreeting({
            characterIds:[updated.id], openingGreeting:{characterId:updated.id,greetingId:selected.id},
        },[updated],'用户甲')?.content).toBe('Link测试角色在黄昏等用户甲。');
        const repeat = importOnlyLinkOpenings(prepared, updated);
        expect(repeat).toBeUndefined();
    });

    it('新增、重排 Link 开场后不覆盖已保存剧情的旧 ID 和旧正文', () => {
        const before = card([{title:'第一幕',content:'从雨夜开始'}, {title:'第二幕',content:'街角重逢'}]);
        const changed = card([
            {title:'新插入',content:'新开场'},
            {title:'第二幕',content:'街角重逢'},
            {title:'第一幕',content:'从雨夜开始'},
        ]);
        const firstId = before.character.linkGreetings![0].id;
        expect(changed.character.linkGreetings?.find(g=>g.content==='从雨夜开始')?.id).toBe(firstId);
        const merged = mergeLinkGreetings(before.character.linkGreetings!, changed.character.linkGreetings!);
        expect(merged).toHaveLength(3);
        const actor={...existingRole(),linkGreetings:merged};
        expect(resolveStoryOpeningGreeting({
            characterIds:[actor.id],openingGreeting:{characterId:actor.id,greetingId:firstId},
        },[actor],'玩家')?.content).toBe('从雨夜开始');
        const revised = card([{title:'第一幕',content:'新版第一幕'}]);
        const next = mergeLinkGreetings(merged,revised.character.linkGreetings!);
        expect(next.map(x=>x.content)).toContain('从雨夜开始');
        expect(next.map(x=>x.content)).toContain('新版第一幕');
    });

    it('旧版数字位置 ID 的 Link 开场迁移时保留旧剧情引用', () => {
        const previous={id:'babylink-opening-0',title:'旧版',content:'不修改的 Link 旧正文'};
        const imported=card([{title:'重命名',content:'不修改的 Link 旧正文'}]);
        const actor={...existingRole(),tavernGreetings:[previous],linkGreetings:[]};
        const merged=importOnlyLinkOpenings(imported,actor);
        expect(merged.tavernGreetings).toEqual([]);
        expect(merged.linkGreetings).toEqual([{...previous,title:'重命名'}]);
        expect(resolveStoryOpeningGreeting({
            characterIds:[actor.id],openingGreeting:{characterId:actor.id,greetingId:previous.id},
        },[merged],'玩家')?.content).toBe(previous.content);
    });

    it('Link HTML 注释属于原文，不作为酒馆标题注释清除', () => {
        const body='<!-- title:属于正文的文字 -->\n<article>这是 Link HTML</article>\n{{char}}和{{user}}';
        const prepared=card([{id:'scene-1',title:'Link标题',opening:body}]);
        const actual=prepared.character.linkGreetings![0];
        expect(actual.title).toBe('Link标题');
        expect(actual.content).toBe(body);
        const actor={...existingRole(),linkGreetings:[actual]};
        const resolved=resolveStoryOpeningGreeting({
            characterIds:[actor.id],openingGreeting:{characterId:actor.id,greetingId:actual.id},
        },[actor],'玩家');
        expect(resolved?.content).toContain('<!-- title:属于正文的文字 -->');
        expect(resolved?.content).toContain('<article>这是 Link HTML</article>');
        expect(resolved?.content).toContain('Link测试角色和玩家');
    });

    it('可用的 content 不会因为同条开场里空 opening 字段而丢失', () => {
        const prepared=card([{title:'实际正文',opening:'',content:'真正的 Link 场景内容'}]);
        expect(prepared.character.linkGreetings?.map(x=>x.content)).toEqual(['真正的 Link 场景内容']);
    });

    it('老 Link 图片未带独立开场字段时，不把本地现有内容误认为空并删除', () => {
        const prepared=card(undefined);
        expect(prepared.linkOpeningPayloadOmitted).toBe(true);
        expect(availableCardImportSections([prepared]).greetings).toBe(false);
        const selected=selectCardImportSections(prepared,{persona:true,worldbooks:false,greetings:false});
        const target=existingRole();
        const merged=mergeCardImports([target],[],[{
            ...selected,expectedTargetId:target.id,
            origin:{source:'babylink' as const,externalId:'source-42',originalName:target.name},
            character:{...target,...selected.fields},
        }]).characters[0];
        expect(merged.linkGreetings).toEqual(target.linkGreetings);
        expect(merged.tavernGreetings).toEqual(target.tavernGreetings);
    });
});
