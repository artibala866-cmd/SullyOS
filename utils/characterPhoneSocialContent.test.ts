// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {normalizeSocialSnapshot,readSocialSnapshot,saveSocialSnapshot,generateSocialSnapshot} from './characterPhoneSocialContent';
import {saveCharacterPhoneInstallPlan} from './characterPhoneAppInstall';

beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();});
const sample={
 profile:{handle:'quiet.char',bio:'少说多看'},
 posts:[{text:'一杯咖啡。',visual:'木桌上的咖啡杯',likes:9,comments:[
  {authorName:'老赵',content:'店在哪里',charReply:'常去那家。'},
  {authorName:'路过的人',content:'好看'},
 ]}],
 viewed:[{authorName:'摄影小站',text:'暮色里的旧城',charComment:'光很好。'}],
};
describe('optional social phone snapshots',()=>{
 it('normalizes character-authored posts and identifies known NPCs',()=>{
  const data=normalizeSocialSnapshot('char','instagram',sample,['老赵']);
  expect(data?.posts[0].comments[0]).toMatchObject({authorName:'老赵',knownNpc:true});
  expect(data?.posts[0].comments[1].knownNpc).toBe(false);
  expect(data?.viewed[0].charComment).toBe('光很好。');
  expect(data?.characterId).toBe('char');
 });
 it('keeps Weibo and Instagram separate for each Char',()=>{
  const first=normalizeSocialSnapshot('char','weibo',sample,['老赵'])!;
  const second=normalizeSocialSnapshot('char','instagram',{...sample,posts:[{text:'Instagram 专属内容'}]},[])!;
  saveSocialSnapshot(first);saveSocialSnapshot(second);
  expect(readSocialSnapshot('char','weibo')?.posts[0].text).toBe('一杯咖啡。');
  expect(readSocialSnapshot('char','instagram')?.posts[0].text).toBe('Instagram 专属内容');
  expect(readSocialSnapshot('other','weibo')).toBeNull();
 });
 it('rejects empty model response rather than erasing an existing snapshot',()=>{
  const existing=normalizeSocialSnapshot('char','weibo',sample,[])!;
  saveSocialSnapshot(existing);
  expect(normalizeSocialSnapshot('char','weibo',{posts:[],viewed:[]},[])).toBeNull();
  expect(readSocialSnapshot('char','weibo')?.posts[0].text).toBe('一杯咖啡。');
 });
 it('does not call API when optional App is not installed',async()=>{
  const fetchMock=vi.fn();
  vi.stubGlobal('fetch',fetchMock);
  await expect(generateSocialSnapshot({
   char:{id:'char',name:'测试'} as never,
   user:{} as never,groups:[],api:{baseUrl:'https://example.org/v1',apiKey:'key',model:'m'},appId:'instagram',
  })).rejects.toThrow('尚未安装');
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
 });
 it('uninstalling preserves independent snapshot but stops generation',async()=>{
  const snapshot=normalizeSocialSnapshot('char','instagram',sample,[])!;
  saveSocialSnapshot(snapshot);
  saveCharacterPhoneInstallPlan({characterId:'char',installedAppIds:[],reason:'手动卸载',generatedAt:1,source:'manual'});
  expect(readSocialSnapshot('char','instagram')?.posts).toHaveLength(1);
  await expect(generateSocialSnapshot({
   char:{id:'char',name:'测试'} as never,user:{} as never,groups:[],
   api:{baseUrl:'https://example.org/v1',apiKey:'key',model:'m'},appId:'instagram',
  })).rejects.toThrow('尚未安装');
 });
});
