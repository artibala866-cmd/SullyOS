// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readCharacterMoments} from './characterPhoneMoments';
import {saveNpcProfiles, type NpcProfile} from './characterPhoneNpcs';
import {readMomentInteractionPreferences,writeMomentInteractionPreferences} from './momentInteractionPreferences';
import {refreshNpcMoments,considerAutonomousNpcMoments} from './refreshNpcMoments';
vi.mock('./keepAlive',()=>({KeepAlive:{start:vi.fn(async()=>{}),stop:vi.fn()}}));
const api={baseUrl:'https://example.invalid/v1',apiKey:'test',model:'test'};
const npc=(id:string,mutualContactIds:string[]=[]):NpcProfile=>({
 id,name:id,identity:'好友',personality:'比较有主见',relationship:'朋友',background:'日常',
 source:'generated',createdAt:1,mutualContactIds,
});
let serial=0;
beforeEach(()=>{localStorage.clear();sessionStorage.clear();serial=0;
 vi.stubGlobal('crypto',{randomUUID:()=>String(++serial)});});
afterEach(()=>vi.unstubAllGlobals());

describe('one-request NPC Moments posting and trusted replies',()=>{
 it('stores an NPC post, acquainted friend comment and author reply from one model response',async()=>{
  const contacts=[npc('alice',['bob']),npc('bob',['alice']),npc('stranger',[])];
  saveNpcProfiles('char',contacts);
  const fetchMock=vi.fn().mockResolvedValue({
   ok:true,status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({posts:[
     {authorId:'alice',text:'今天终于把旧唱片找到了。',comments:[
      {authorId:'bob',text:'哪张呀？',replyToIndex:-1},
      {authorId:'alice',text:'就是你上周推荐的那张。',replyToIndex:0},
      {authorId:'stranger',text:'我们很熟的！',replyToIndex:-1},
     ]},
   ]})}}]}),
  });
  vi.stubGlobal('fetch',fetchMock);
  expect(await refreshNpcMoments('char',contacts,api)).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [post]=readCharacterMoments('char');
  expect(post.authorId).toBe('alice');
  expect(post.comments).toHaveLength(2);
  expect(post.comments?.[1].replyToId).toBe(post.comments?.[0].id);
  expect(post.comments?.some(c=>c.authorId==='stranger')).toBe(false);
 });
 it('has a separate NPC-posting toggle and bounded custom interval',async()=>{
  writeMomentInteractionPreferences('char',{npcPostingEnabled:false,npcPostIntervalMinutes:15});
  expect(readMomentInteractionPreferences('char').npcPostIntervalMinutes).toBe(60);
  vi.stubGlobal('fetch',vi.fn());
  expect(await considerAutonomousNpcMoments('char',api)).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
 });
});
