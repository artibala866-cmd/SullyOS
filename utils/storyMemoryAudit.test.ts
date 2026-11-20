import { test, expect } from 'vitest';
import type { StoryArchiveFact } from '../types';
import { collectStoryArchiveFacts, formatStoryArchiveProseContext, parseStoryArchiveChanges, reconcileStoryArchiveContinuity, storyArchiveContinuityKind } from './storyArchiveFacts';

const screenshotNarrative = '从茶几边缘到你膝头只有两步的距离，活人迈过去不用一秒，一只怕冻着妹妹的鬼魂走过去，却要在心里把深浅盘算上好几个来回。';

test('distance and a later mention of the living never become a persistent supernatural rule', () => {
 expect(storyArchiveContinuityKind({kind:'fact',text:screenshotNarrative})).toBeUndefined();
 const sources=new Map([[15,{text:screenshotNarrative,authorInput:false}]]);
 expect(parseStoryArchiveChanges('{"changes":[],"instructions":[]}',sources,[])).toEqual([]);
 const fact={key:'靠近/妹妹',kind:'fact' as const,text:screenshotNarrative,terms:[],sourceMessageId:15};
 const parsed=parseStoryArchiveChanges(JSON.stringify({changes:[fact]}),sources,[]);
 expect(parsed).toHaveLength(1);
 expect(parsed[0].continuity).toBeUndefined();
 const state=reconcileStoryArchiveContinuity([],[],20,[],[{id:15,role:'assistant',content:screenshotNarrative}]);
 expect(state.active).toEqual([]);
});

test('recovered repeated rule sentences create one memory while separate rules remain intact', () => {
 const rule='幸芳白是鬼魂，普通人看不见他，只有戴戒指的人可以看见他。';
 const other='只有妹妹能听见幸芳白的声音。';
 const sources=new Map([[15,{text:rule+'\n'+rule+'\n'+other,authorInput:false}]]);
 const facts=parseStoryArchiveChanges('{"changes":[]}',sources,[]);
 expect(facts.map(f=>f.text)).toEqual([rule,other]);
 expect(facts.every(f=>f.continuity==='rule')).toBe(true);
});

test('local recovery does not duplicate a model-summarized exact rule', () => {
 const text='幸芳白是鬼魂，普通人看不见他。';
 const sources=new Map([[15,{text:text+'\n'+text,authorInput:false}]]);
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[{key:'幸芳白/身份',kind:'fact',text,sourceMessageId:15}]}),sources,[]);
 expect(facts).toHaveLength(1);
 expect(facts[0]).toMatchObject({text,continuity:'rule'});
});

test('visibility assertions do not cross a clause boundary into unrelated action', () => {
 expect(storyArchiveContinuityKind({kind:'fact',text:'旁人收起雨伞，他听不见窗外的雨声。'})).toBeUndefined();
 expect(storyArchiveContinuityKind({kind:'fact',text:'普通人看不见幸芳白。'})).toBe('rule');
 expect(storyArchiveContinuityKind({kind:'fact',text:'幸芳白无法触碰活人。'})).toBe('rule');
 expect(storyArchiveContinuityKind({kind:'fact',text:'幸芳白只能被活人触碰。'})).toBe('rule');
 expect(storyArchiveContinuityKind({kind:'fact',text:'屋内只有妹妹是活人。'})).toBe('rule');
 expect(storyArchiveContinuityKind({kind:'fact',text:'幸芳白只能被活人伤害。'})).toBe('rule');
 expect(storyArchiveContinuityKind({kind:'fact',text:'只有妹妹能伤害鬼魂。'})).toBe('rule');
});

test('independent returned facts sharing one add key remain current together', () => {
 const sources = new Map([[10,{text:'柳巡只知道化名。青灯保管钥匙。',authorInput:false}]]);
 const changes = [{action:'add',key:'人物/状态',kind:'fact',text:'柳巡只知道化名。',sourceMessageId:10},
  {action:'add',key:'人物/状态',kind:'fact',text:'青灯保管钥匙。',sourceMessageId:10}];
 const saved = parseStoryArchiveChanges(JSON.stringify({changes}),sources,[]);
 expect(saved.map(f=>f.text)).toEqual(changes.map(f=>f.text));
});

test('same text with a newly sourced alias does not shift the past evidence floor', () => {
 const old:StoryArchiveFact={key:'钥匙/位置',kind:'fact',text:'铜钥匙在南库。',terms:['铜钥匙'],sourceMessageId:5};
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[{...old,action:'update',sourceMessageId:20,aliases:['绿牙']}]}),
   new Map([[20,{text:'铜钥匙也叫绿牙。',authorInput:false}]]),[old]);
 expect(facts).toHaveLength(1);
 const history:StoryArchiveFact[]=[];
 // Before later alias discovery the old position must still be available.
 const boxes=[{id:'old',strategy:'summary' as const,fromMessageId:5,toMessageId:5,createdAt:1,messageCount:1,facts:[old]},
 {id:'new',strategy:'summary' as const,fromMessageId:20,toMessageId:20,createdAt:2,messageCount:1,facts}];
 expect(collectStoryArchiveFacts(boxes,10,new Map())[0].sourceMessageId).toBe(5);
});

test('a confirmed event keeps its exception instead of inheriting another sentence rumor', () => {
 const source='柳巡已签收信件。青灯怀疑有人偷听，但还未确认。';
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[{action:'add',key:'信件/交付',kind:'fact',
  text:'柳巡已签收信件。',sourceMessageId:10,modality:'unverified'}]}),
  new Map([[10,{text:source,authorInput:false}]]),[]);
 expect(facts[0].modality).toBeUndefined();
});

test('author summaries can correct a wrongly assigned reply scope without turning quoted plot into instructions', () => {
 const source='OOC：这次只省略天气；以后不替玩家说话，除非玩家明确授权。';
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[{action:'add',key:'写作/要求',kind:'author',
 text:'以后不替玩家说话，除非玩家明确授权。这次只省略天气。',sourceMessageId:10,authorScope:'turn'}]}),
 new Map([[10,{text:source,authorInput:true}]]),[]);
 expect(facts.some(f=>f.authorScope!== 'turn' && f.text.includes('明确授权'))).toBe(true);
 expect(formatStoryArchiveProseContext(facts,'继续')).not.toContain('这次只省略天气');
});

test('instructions returned outside changes are saved with all conditions and exceptions', () => {
 const text='以后密封信件必须验章才能读，青灯亲手递交的除外。';
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[],instructions:[{
  action:'add',key:'写作/密封信件',text,sourceMessageId:10
 }]}),new Map([[10,{text:'场外：'+text,authorInput:true}]]),[]);
 expect(facts).toEqual([expect.objectContaining({kind:'author',text,sourceMessageId:10})]);
 expect(formatStoryArchiveProseContext(facts,'继续')).toContain(text);
});

test('malformed instructions never silently disappear while marking a batch done', () => {
 expect(()=>parseStoryArchiveChanges(JSON.stringify({changes:[],instructions:{text:'不可替玩家回答'}}),
 new Map([[10,{text:'以后不可替玩家回答。',authorInput:true}]]),[])).toThrow('instructions');
});

test('a combined paragraph retains earlier entity evidence and becomes visible at its last floor', () => {
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[{action:'add',key:'钥匙/交付',kind:'fact',
 text:'铜钥匙又称绿牙。青灯已收到钥匙。',sourceMessageId:10,sourceMessageIds:[10,20],quote:'铜钥匙又称绿牙。',
 aliases:['绿牙'],entities:[{name:'铜钥匙',type:'object',aliases:['绿牙']}]}]}),new Map([
 [10,{text:'铜钥匙又称绿牙。',authorInput:false}],[20,{text:'青灯已收到钥匙。',authorInput:false}]
 ]),[]);
 expect(facts[0]).toMatchObject({sourceMessageId:20,sourceMessageIds:[10,20],aliases:['绿牙'],entities:[{name:'铜钥匙'}]});
 const boxes=[{id:'batch',strategy:'summary' as const,fromMessageId:10,toMessageId:20,createdAt:1,messageCount:2,facts}];
 expect(collectStoryArchiveFacts(boxes,15,new Map())).toHaveLength(0);
 expect(collectStoryArchiveFacts(boxes,21,new Map())).toHaveLength(1);
});

test('a later update retains the previously verified alias for searching its new state', () => {
 const old:StoryArchiveFact={key:'钥匙/位置',kind:'fact',text:'铜钥匙在南库。',terms:['铜钥匙'],aliases:['绿牙'],sourceMessageId:5};
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[{action:'update',key:old.key,kind:'fact',
 text:'铜钥匙已交给青灯。',sourceMessageId:20}]}),new Map([[20,{text:'铜钥匙已交给青灯。',authorInput:false}]]),[old]);
 expect(facts[0].aliases).toEqual(['绿牙']);
});

test('keyword-only enrichment of an unchanged paragraph is retained', () => {
 const old:StoryArchiveFact={key:'钥匙/位置',kind:'fact',text:'铜钥匙在南库。',terms:['铜钥匙'],sourceMessageId:5};
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[{...old,action:'update',sourceMessageId:20,terms:['铜钥匙','南库']}]}),
 new Map([[20,{text:'再确认一次，铜钥匙在南库。',authorInput:false}]]),[old]);
 expect(facts[0].terms).toEqual(['铜钥匙','南库']);
});

test('a model cannot promote an explicitly one-turn direction into a lasting preference', () => {
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[],instructions:[{action:'add',key:'写作/天气',
 text:'以后略过天气。',sourceMessageId:10}]}),new Map([[10,{text:'OOC：本轮只略过天气。',authorInput:true}]]),[]);
 expect(facts.find(f=>f.text.includes('天气'))?.authorScope).toBe('turn');
 expect(formatStoryArchiveProseContext(facts,'继续')).not.toContain('天气');
});

test('a delivered paragraph stays closed when it also retains a future exception', () => {
 const text='第二天清晨，阿潭亲手将南渡回执交付柳巡。若蜡封破损，今后暂停交接。';
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[{action:'add',key:'回执/交付',kind:'fact',text,sourceMessageId:18}]}),
 new Map([[18,{text,authorInput:false}]]),[]);
 expect(facts[0].continuity).toBe('completed');
 expect(facts[0].text).toContain('若蜡封破损');
});

test('a past plan followed by an actual reroute does not block causal paragraph consolidation', () => {
 const route='阿潭原计划经正门送回执，因桥板断裂无法通行，遂改走北门暗道。';
 const result='阿潭亲手将回执交付柳巡，柳巡签收；若蜡封破损，今后暂停交接。';
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[
 {action:'add',key:'回执/路线',kind:'fact',text:route,terms:['回执'],sourceMessageId:8},
 {action:'add',key:'回执/交付',kind:'fact',text:result,terms:['回执'],relatedKeys:['回执/路线'],sourceMessageId:18}
 ]}),new Map([[8,{text:route,authorInput:false}],[18,{text:result,authorInput:false}]]),[]);
 expect(facts).toHaveLength(1);
 expect(facts[0]).toMatchObject({continuity:'completed',sourceMessageIds:[8,18]});
 expect(facts[0].text).toContain('桥板断裂');
 expect(facts[0].text).toContain('蜡封破损');
});

test('lasting directions do not depend on optional keyword fields or a model scope flag', () => {
 const clauses=[
  ['青灯的独白仅对读者可见，柳巡永远无法听见，除非青灯主动说出。',
   '另有一条写作要求：青灯的独白只给读者，柳巡永远听不见，除非青灯主动说出。'],
  ['柳巡仅在文书有灰色骑缝章时才可阅读正文；青灯递交的免验。',
   '场外：从此文书须验灰色骑缝章才能读，青灯递交的免验。本轮只用一句旁白。']
 ];
 for(const [text,source] of clauses){
  const facts=parseStoryArchiveChanges(JSON.stringify({changes:[],instructions:[{key:'写作/规则',text,
   sourceMessageId:21,authorScope:'turn'}]}),new Map([[21,{text:source,authorInput:true}]]),[]);
  const saved=facts.find(f=>f.kind==='author' && f.authorScope!=='turn')!;
  expect(saved).toBeDefined();
  const recalled=formatStoryArchiveProseContext(facts,'继续');
  expect(recalled).toContain(saved.text);
  expect(saved.text).toMatch(/除非青灯主动说出|青灯递交的免验/u);
 }
});

test('an incorrect completed flag cannot finish a partially repaired machine', () => {
 const text='阿潭原计划修北门闸机，已完成外壳拆除，但弹簧仍卡住，闸机未修复。';
 const source='阿潭原计划修北门闸机。今天只完成了拆掉外壳这一项；弹簧仍卡着，闸机没有修好。';
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[{key:'北门/闸机',kind:'fact',action:'add',text,
  sourceMessageId:30,continuity:'completed'}]}),new Map([[30,{text:source,authorInput:false}]]),[]);
 expect(facts.find(f=>f.key==='北门/闸机')).toMatchObject({modality:'planned'});
 expect(facts.find(f=>f.key==='北门/闸机')?.continuity).not.toBe('completed');
});

test('an assistant plot duplicated in instructions keeps its valid fact without becoming a writing rule', () => {
 const text='柳巡已取消去西渡取备用封条的约定。';
 const fact={key:'封条/约定',kind:'fact',text,sourceMessageId:42};
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[fact],instructions:[{...fact,kind:'author',authorScope:'turn'}]}),
 new Map([[42,{text,authorInput:false}]]),[]);
 expect(facts).toEqual([expect.objectContaining({kind:'fact',text,continuity:'canceled'})]);
});

test('a paraphrased lasting rule is separated from a trailing one-turn note despite a wrong scope flag', () => {
 const source='场外：从此文书须验灰色骑缝章才能读，青灯递交的免验。本轮只用一句旁白。';
 const text='柳巡仅在文书加盖灰色骑缝章时才可阅读正文；青灯亲自递交的文书可免验，本轮仅使用一句旁白说明。';
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[],instructions:[{key:'文书/规则',text,sourceMessageId:39,authorScope:'turn'}]}),
 new Map([[39,{text:source,authorInput:true}]]),[]);
 const recalled=formatStoryArchiveProseContext(facts,'继续');
 expect(recalled).toContain('青灯递交的免验');
 expect(recalled).not.toContain('一句旁白');
 expect(facts.some(f=>f.authorScope==='turn'&&f.text.includes('一句旁白'))).toBe(true);
});

test('a paraphrase cannot weaken a prerequisite or discard the user\'s exact exception', () => {
 const source='场外：从此遇到密封文书时，柳巡只有验过灰色骑缝章才能读正文，但青灯亲自递交的文书可以免验。本轮只用一句旁白。';
 const facts=parseStoryArchiveChanges(JSON.stringify({changes:[],instructions:[{key:'文书/查验',sourceMessageId:39,
 text:'柳巡仅在文书加盖灰色骑缝章时才可读正文，青灯递交的免验。',authorScope:'turn'}]}),
 new Map([[39,{text:source,authorInput:true}]]),[]);
 const recalled=formatStoryArchiveProseContext(facts,'继续');
 expect(recalled).toContain('只有验过灰色骑缝章才能读正文');
 expect(recalled).toContain('但青灯亲自递交的文书可以免验');
 expect(recalled).not.toContain('一句旁白');
 expect(recalled).not.toContain('加盖灰色骑缝章');
});
