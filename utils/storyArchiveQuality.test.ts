import { describe, expect, it } from 'vitest';
import type { StoryArchiveFact } from '../types';
import { hasUnresolvedStoryNarration, storyArchiveFallbackTags, storyArchiveKeywordTags, storyArchiveSummaryIssue } from './storyArchiveQuality';
import { parseStoryArchiveChanges, reconcileStoryArchiveContinuity, storyArchiveContinuityKind } from './storyArchiveFacts';

const reunion = '如今他作为亡魂陪你回来，两人在旧居里的羁绊比新绿花城的新房更加深厚。';
const awkward = '他生前就不习惯跟人拉拉扯扯，哪怕现在成了鬼，被你热乎乎的爪子抓着来回揉搓，那阵条件反射的别扭劲还是半点没减。';
const fact = (text: string): StoryArchiveFact => ({key:'ghost_reunion',kind:'fact',text,terms:[],sourceMessageId:31});

describe('recording: English identifiers are not keyword fallback', () => {
    it('keeps a stable English key without copying it into missing terms', () => {
        const text='禁止使用“丫头”和“老板娘”称呼幸福，幸福是幸芳白的妹妹。';
        const parsed=parseStoryArchiveChanges(JSON.stringify({instructions:[{key:'strict_forbidden_words_and_terms',text,sourceMessageId:24}],changes:[]}),
            new Map([[24,{text:'OOC：'+text,authorInput:true}]]),[]);
        expect(parsed[0]).toMatchObject({key:'strict_forbidden_words_and_terms',kind:'author',text,terms:[]});
    });
    it('uses grounded entities when the model omits terms', () => {
        const text='幸福关闭窗帘，幸芳白的魂体恢复稳定。';
        const parsed=parseStoryArchiveChanges(JSON.stringify({changes:[{key:'morning_glitch_and_curtain_adjustment',text,sourceMessageId:23,
            entities:[{name:'幸福',type:'person'},{name:'幸芳白',type:'person'}]}]}),new Map([[23,{text,authorInput:false}]]),[]);
        expect(parsed[0].terms).toEqual(['幸福','幸芳白']);
    });
    it('filters legacy slug tags without changing the input or hiding real names and codes', () => {
        const tags=['剧情','morning_glitch_and_curtain_adjustment','幸福','John','A_B'];
        expect(storyArchiveKeywordTags(tags,'幸福和 John 核对编号 A_B。')).toEqual(['幸福','john','a_b']);
        expect(tags).toHaveLength(5);
        expect(storyArchiveFallbackTags('铜钥匙/持有人','阿岚保管铜钥匙。')).toEqual(['铜钥匙','持有人']);
        expect(storyArchiveFallbackTags('old_house_agreement_retrieval_and_chills','幸芳白取出协议。')).toEqual([]);
    });
    it('does not reintroduce an old slug during metadata enrichment', () => {
        const old={...fact('幸芳白保管铜钥匙。'),key:'钥匙/位置',terms:['幸芳白','old_house_agreement_retrieval_and_chills'],sourceMessageId:20};
        const parsed=parseStoryArchiveChanges(JSON.stringify({changes:[{...old,action:'update',terms:['铜钥匙'],sourceMessageId:31}]}),
            new Map([[31,{text:old.text,authorInput:false}]]),[old]);
        expect(parsed[0].terms).toEqual(['铜钥匙','幸芳白']);
    });
});

describe('recording: do not backfill literary ghost mentions as rules', () => {
    it.each([reunion,awkward,'幸芳白作为亡魂陪幸福回来，两人在旧居里的羁绊更深。',
        '幸芳白是鬼魂，他绕过茶几走到幸福身边，俯身看向她。'])('never inserts the whole prose fragment: %s', text => {
        const sources=new Map([[31,{text,authorInput:false}]]);
        expect(parseStoryArchiveChanges('{"changes":[]}',sources,[])).toEqual([]);
        const state=reconcileStoryArchiveContinuity([],[],40,[],[{id:31,role:'assistant',content:text}]);
        expect(state.active).toEqual([]);
    });
    it('keeps complete identity constraints and their exceptions', () => {
        const text='幸芳白是鬼魂，普通人看不见他，幸福除外，只有妹妹能听见他的声音。';
        const parsed=parseStoryArchiveChanges('{"changes":[]}',new Map([[31,{text,authorInput:false}]]),[]);
        expect(parsed).toEqual([expect.objectContaining({text,continuity:'rule'})]);
        const qualified='主角是已经死去的鬼魂，普通人看不见他，也听不见他的声音。';
        expect(parseStoryArchiveChanges('{"changes":[]}',new Map([[32,{text:qualified,authorInput:false}]]),[]))
            .toEqual([expect.objectContaining({text:qualified,continuity:'rule'})]);
    });
    it.each(['幸芳白已经死了三天。','John is a ghost, invisible to the living.',
        'John is a ghost, only Alice can see him.', 'John returned to life yesterday.'])('retains existing identity evidence including English and time qualifiers: %s', text => {
        expect(parseStoryArchiveChanges('{"changes":[]}',new Map([[31,{text,authorInput:false}]]),[]))
            .toEqual([expect.objectContaining({text,continuity:'rule'})]);
    });
    it('does not remove a model-summarized emotional change', () => {
        const text='幸芳白陪幸福返回旧居；两人在旧居的情感联系比在新房时更深。';
        const parsed=parseStoryArchiveChanges(JSON.stringify({changes:[{key:'旧居/感受',text,sourceMessageId:31}]}),
            new Map([[31,{text:reunion,authorInput:false}]]),[]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].text).toBe(text);
    });
    it('removes permanent-rule priority from old erroneous raw supplements without mutating them', () => {
        const old={...fact(reunion),key:'原文/31/0',continuity:'rule' as const};
        expect(storyArchiveContinuityKind(old)).toBeUndefined();
        expect(old.continuity).toBe('rule');
        expect(old.text).toBe(reunion);
        expect(storyArchiveContinuityKind({...old,text:'幸芳白是鬼魂，普通人看不见他。'})).toBe('rule');
        expect(storyArchiveContinuityKind({...old,key:'世界观/新限制',text:'密封档案必须验章才可阅览。'})).toBe('rule');
    });
});

describe('quality check before archiving', () => {
    it.each([reunion,awkward,'他已经死了。','从茶几边缘到你膝头只有两步的距离。'])('rejects copied unresolved narration: %s', text => {
        expect(storyArchiveSummaryIssue(fact(text),[text])).toContain('原文片段');
    });
    it('leaves exact prohibitions and quoted dialogue intact', () => {
        const text='禁止用“你真乖”称呼幸福，除非幸福主动要求。';
        expect(storyArchiveSummaryIssue({...fact(text),kind:'author'},[text])).toBeUndefined();
        const plot='幸芳白对幸福说：“我会留下陪你。”';
        expect(storyArchiveSummaryIssue(fact(plot),[plot])).toBeUndefined();
    });
    it('keeps concise named assertions, long detailed memories, and real names beginning with pronoun characters', () => {
        for(const text of ['幸芳白已经死了。','幸芳白保管编号 A_B 的协议。'.repeat(120),
            '我爱罗作为鬼魂只能被活人触碰。','幸福陪我爱罗回到旧居。']) {
            expect(storyArchiveSummaryIssue({...fact(text),entities:[{name:'我爱罗',type:'person'}]},[text])).toBeUndefined();
        }
        expect(hasUnresolvedStoryNarration('幸福打开迷你音箱。')).toBe(false);
    });
    it('does not accept an invented internal key as the summary body', () => {
        expect(storyArchiveSummaryIssue(fact('strict_forbidden_words_and_terms'),['禁止使用这些称呼。'])).toContain('内部标识');
        expect(storyArchiveSummaryIssue(fact('A_B'),['编号是 A_B。'])).toBeUndefined();
    });
});
