// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {
  addCharacterAvatar,readCharacterAvatarLibrary,saveCharacterAvatarDescription,
  setAutonomousAvatarEnabled,
} from './characterAvatarLibrary';
import {readCharacterPhoneSelfProfile,runCharacterPhoneSelfAutonomy} from './characterPhoneSelfProfile';
import type {CharacterProfile} from '../types';
vi.mock('./characterLifeScheduleContext',()=>({
  getCharacterLifeScheduleContext:vi.fn(async()=>({
    characterId:'c',observedAt:Date.now(),plannedActivity:'晚上看书',
    plannedDescription:'房间里',confirmedEvents:[],
  })),
}));
const char={id:'c',name:'阿澄',systemPrompt:'喜欢小动物，话不多'} as CharacterProfile;
const api={baseUrl:'https://example.invalid/v1',apiKey:'test',model:'test'};
let serial=0;
beforeEach(()=>{localStorage.clear();serial=0;vi.stubGlobal('crypto',{randomUUID:()=>String(++serial)})});
afterEach(()=>vi.unstubAllGlobals());
describe('Shared Char avatar vision and profile',()=>{
  it('persists recognized descriptions and protects old entries without captions',()=>{
    const old=addCharacterAvatar('c','https://example.invalid/old.jpg','upload');
    const vision=addCharacterAvatar('c','https://example.invalid/mood.jpg','upload',{
      description:'角色正面半身像，浅色衣服，神情放松',model:'vision-model',
    });
    expect(old.visionDescription).toBeUndefined();
    expect(readCharacterAvatarLibrary('c').entries.find(e=>e.id===vision.id)?.visionDescription)
      .toContain('神情放松');
    expect(saveCharacterAvatarDescription('c',old.id,'黑色外套，表情严肃','vision-model')).toBe(true);
    expect(readCharacterAvatarLibrary('c').entries.find(e=>e.id===old.id)?.visionModel)
      .toBe('vision-model');
  });
  it('updates AI poke suffix and only chooses a recognized avatar ID',async()=>{
    addCharacterAvatar('c','https://example.invalid/unseen.jpg','upload');
    const described=addCharacterAvatar('c','https://example.invalid/quiet.jpg','upload',{
      description:'低头看书，神情安静',model:'vision-model',
    });
    setAutonomousAvatarEnabled('c',true);
    const fetchMock=vi.fn().mockResolvedValue({
      ok:true,status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
        pokeSuffix:'的书包',mood:'专注',reason:'今天想安静看书',avatarId:described.id,
      })}}]}),
    });
    vi.stubGlobal('fetch',fetchMock);
    const apply=vi.fn(async (_image:string)=>{});
    expect(await runCharacterPhoneSelfAutonomy(char,api,apply)).toBe('changed');
    expect(apply).toHaveBeenCalledWith('https://example.invalid/quiet.jpg');
    expect(readCharacterAvatarLibrary('c').activeId).toBe(described.id);
    expect(readCharacterPhoneSelfProfile('c').pokeSuffix).toBe('的书包');
    expect((fetchMock.mock.calls[0][1].body as string)).toContain('低头看书');
    expect((fetchMock.mock.calls[0][1].body as string)).not.toContain('unseen.jpg');
    expect(await runCharacterPhoneSelfAutonomy(char,api,apply)).toBe('skipped');
  });
});
