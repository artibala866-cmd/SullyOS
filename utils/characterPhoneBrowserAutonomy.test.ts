// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {CharacterProfile,UserProfile} from '../types';
import {runCharacterPhoneBrowserAutonomy} from './characterPhoneBrowserAutonomy';
import {readCharacterPhoneBrowserHistory} from './characterPhoneBrowser';
import {readCharacterLifeEvents,recordCharacterLifeEvent} from './characterLifeEvents';
import {getCharacterLifeScheduleContext} from './characterLifeScheduleContext';
vi.mock('./characterPhoneContext',()=>({
  buildCharacterPhoneContext:vi.fn(async()=>({systemPrompt:'TA是喜欢旧胶片电影的研究生，晚上常读书。',privateMessages:[]})),
}));
vi.mock('./characterLifeScheduleContext',()=>({
  getCharacterLifeScheduleContext:vi.fn(async()=>({
    characterId:'char',observedAt:Date.now(),plannedActivity:'休息',plannedDescription:'空闲',
    confirmedEvents:[],
  })),
}));
let counter=0;
const char={id:'char',name:'阿禾',systemPrompt:'研究生'} as CharacterProfile;
const input={
  char,user:{name:'真实用户'} as UserProfile,groups:[],
  api:{baseUrl:'https://example.invalid/v1',apiKey:'test',model:'m'},
};
beforeEach(()=>{
  localStorage.clear();counter=0;
  vi.stubGlobal('crypto',{randomUUID:()=>String(++counter)});
});
afterEach(()=>vi.unstubAllGlobals());

describe('Char autonomous Baidu search history',()=>{
  it('writes only Char-owned motivated search records and life events',async()=>{
    recordCharacterLifeEvent({id:'e1',characterId:'char',source:'phone',
      kind:'npc-chat',summary:'朋友在微信推荐一本新书',occurredAt:Date.now()-5000});
    const fetchMock=vi.fn().mockResolvedValue({
      ok:true,status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
        search:true,records:[{
          title:'书店新书',query:'2026文学出版社新书目录',reason:'我想知道朋友说的新书是哪本',
          note:'想查作者和书名，尚未看网页',mood:'好奇',sourceEventIds:['e1','made-up'],
        }],
      })}}]}),
    });
    vi.stubGlobal('fetch',fetchMock);
    expect((await runCharacterPhoneBrowserAutonomy(input,'manual')).status).toBe('generated');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const items=readCharacterPhoneBrowserHistory('char');
    expect(items).toHaveLength(1);
    expect(items[0].actor).toBe('char');
    expect(items[0].query).toBe('2026文学出版社新书目录');
    expect(items[0].aiJudgement).toContain('朋友');
    expect(items[0].sourceEventIds).toEqual(['e1']);
    expect(new URL(items[0].url).hostname).toBe('www.baidu.com');
    expect(readCharacterLifeEvents('char').find(e=>e.kind==='browser-search')?.summary)
      .toContain('不代表已经阅读或验证百度结果');
    expect(readCharacterPhoneBrowserHistory('other-char')).toHaveLength(0);
    const retry=await runCharacterPhoneBrowserAutonomy(input,'manual');
    expect(retry.status).toBe('skipped');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not generate search history while asleep in background',async()=>{
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValueOnce({
      characterId:'char',observedAt:Date.now(),plannedActivity:'睡觉',
      plannedDescription:null,confirmedEvents:[],
    });
    vi.stubGlobal('fetch',vi.fn());
    // jsdom visibility is visible in this environment.
    expect((await runCharacterPhoneBrowserAutonomy(input,'background')).status).toBe('skipped');
    expect(readCharacterPhoneBrowserHistory('char')).toHaveLength(0);
  });
});
