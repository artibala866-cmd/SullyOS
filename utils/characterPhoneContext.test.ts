import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import type { CharacterProfile, UserProfile } from '../types';
import { buildCharacterPhoneContext } from './characterPhoneContext';
import { loadCharacterContextMessages } from './chatContextRange';
import { mirrorPrivateChat } from './characterPhonePrivateSync';

beforeEach(() => localStorage.clear());
describe('phone/private-chat context integration', () => {
  it('uses the same history breakpoint and worldbook evidence without private-chat tool instructions', async () => {
    const char = { id:'phone-parity', name:'角色', systemPrompt:'喜欢画画的学生',
      contextRangeMode:'manual', contextRangePolicyVersion:1, contextLimit:10,
      timeAwarenessEnabled:false, scheduleFeatureEnabled:false,
      mountedWorldbooks:[
        {id:'old-book',title:'旧关键词',content:'过期关键词不应激活此条',key:['OLD_KEY'],constant:false},
        {id:'new-book',title:'新关键词',content:'目前讨论的是水彩课',key:['LATEST_KEY'],constant:false},
      ],
    } as CharacterProfile;
    const ids:number[]=[];
    for(let i=0;i<12;i++) ids.push(await DB.saveMessage({charId:char.id,role:'user',type:'text',content:i===0?'OLD_KEY':i===11?'LATEST_KEY':'句子'+i}));
    char.contextUserStartMessageId=ids[10];
    const context=await buildCharacterPhoneContext(char,{name:'用户'} as UserProfile,[]);
    expect(context.privateMessages.map(m=>m.id)).toEqual((await loadCharacterContextMessages(char)).map(m=>m.id));
    expect(context.privateMessages.map(m=>m.id)).toEqual(ids.slice(10));
    expect(context.systemPrompt).toContain('喜欢画画的学生');
    expect(context.systemPrompt).toContain('目前讨论的是水彩课');
    expect(context.systemPrompt).not.toContain('过期关键词不应激活此条');
    expect(context.systemPrompt).not.toContain('OLD_KEY');
    expect(context.systemPrompt).not.toContain('[[SEARCH:');
    expect(context.systemPrompt).toContain('不是本轮手机收件人');
  });
  it('mirrors persisted send order and voice/image meaning without rewriting the user or leaking image data', () => {
    const rows = [
      {id:1,charId:'sync',role:'user',type:'text',content:'先发出的',timestamp:200},
      {id:2,charId:'sync',role:'assistant',type:'text',content:'后补收的',timestamp:100},
      {id:3,charId:'sync',role:'user',type:'image',content:'data:image/png;base64,SECRET',timestamp:300},
      {id:4,charId:'sync',role:'user',type:'voice',content:'声音里的话',timestamp:400},
    ] as any;
    const copy=JSON.stringify(rows);
    const result=mirrorPrivateChat('sync',rows).messages;
    expect(result.map(m=>m.sourceMessageId)).toEqual([1,2,3,4]);
    expect(result[3].text).toContain('声音里的话');
    expect(result[2].text).not.toContain('base64');
    expect(JSON.stringify(rows)).toBe(copy);
  });
});
