import type { PhoneCustomApp } from '../types';
/** Check-phone-only deterministic starter app suggestions; no AI calls or automatic installs. */
export type SuggestedPhoneApp = Pick<PhoneCustomApp, 'name'|'icon'|'color'|'prompt'|'layout'> & { key:string };
const CATALOG: readonly (SuggestedPhoneApp & {signals:RegExp})[] = [
{key:'video',name:'视频收藏',icon:'📺',color:'#fb7185',layout:'feed',prompt:'角色自己的视频收藏与感想；不得把计划当作事实。',signals:/视频|追番|动画|动漫|电影|电视剧|b站|bilibili|剪辑|up主/i},
{key:'music',name:'音乐收藏',icon:'🎧',color:'#a78bfa',layout:'generic',prompt:'角色自己的歌单、听歌记录和感想。',signals:/音乐|听歌|唱歌|乐队|吉他|钢琴|作曲|歌手/i},
{key:'games',name:'游戏记录',icon:'🎮',color:'#60a5fa',layout:'forum',prompt:'角色自己的游戏兴趣和记录，不编造战绩。',signals:/游戏|电竞|主机|手游|steam|玩家/i},
{key:'books',name:'阅读书架',icon:'📚',color:'#fbbf24',layout:'novel',prompt:'角色自己的阅读清单与读后感。',signals:/读书|小说|文学|阅读|书店|写作|诗歌/i},
{key:'fitness',name:'运动笔记',icon:'🏃',color:'#34d399',layout:'generic',prompt:'角色自己的运动计划与真实训练记录，计划不等于完成。',signals:/健身|跑步|运动|瑜伽|篮球|足球|游泳|骑行/i},
{key:'art',name:'灵感图库',icon:'🎨',color:'#f472b6',layout:'feed',prompt:'角色自己的视觉灵感与创作想法。',signals:/画画|绘画|插画|设计|摄影|艺术|美术|画师/i}
];
export function suggestCharacterPhoneApps(persona:string,installed:readonly PhoneCustomApp[]=[]):SuggestedPhoneApp[]{
const existing=new Set(installed.map(a=>a.name.trim().toLowerCase()));
return CATALOG.filter(a=>a.signals.test((persona||'').slice(0,12000))&&!existing.has(a.name.toLowerCase())).slice(0,3).map(({signals:_signals,...app})=>app);
}
