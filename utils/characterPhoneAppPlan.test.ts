import { describe,expect,it } from 'vitest';
import { suggestCharacterPhoneApps } from './characterPhoneAppPlan';
describe('character phone optional app plan',()=>{
it('recommends only relevant optional apps',()=>{expect(suggestCharacterPhoneApps('喜欢画画和听歌').map(a=>a.key)).toEqual(['music','art']);});
it('does not duplicate installed apps',()=>{const installed=[{id:'existing',name:'音乐收藏',icon:'🎧',color:'#fff',prompt:'',layout:'generic' as const}];expect(suggestCharacterPhoneApps('喜欢音乐和绘画',installed).map(a=>a.key)).toEqual(['art']);});
it('does not invent interests for an empty persona',()=>{expect(suggestCharacterPhoneApps('')).toEqual([]);});
it('limits recommendations',()=>{expect(suggestCharacterPhoneApps('喜欢音乐游戏绘画阅读运动电影').length).toBeLessThanOrEqual(3);});
});
