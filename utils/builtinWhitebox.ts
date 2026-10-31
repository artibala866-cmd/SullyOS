import friendRequestRain from '../presets/chat/friend-request-rain.json';
import dark from '../presets/chat/acid-orbit.json';
import lavender from '../presets/chat/acid-orbit-lavender.json';
import silentLetter from '../presets/chat/silent-letter-dark.json';
import ios6 from '../presets/chat/ios6.json';
import faintSilk from '../presets/chat/faint-silk.json';
import weixinBaiyu from '../presets/chat/weixin-baiyu.json';
import {validateDecoration} from './chatDecoration';

/** Bundled outfits stay local; read returns a fresh validated preset for editing/applying. */
export const BUILTIN_WHITEBOX_PRESETS = [
 {id:'builtin-friend-request-rain',name:'请求添加好友 · 雨梦（by 池谕）',read:()=>validateDecoration(structuredClone(friendRequestRain))},
 {id:'builtin-weixin-baiyu',name:'微信 · 白榆（by白榆，转账 by小Q怡）',read:()=>validateDecoration(structuredClone(weixinBaiyu))},
 {id:'builtin-faint-silk',name:'Faint Silk · 浅丝（by落吟）',read:()=>validateDecoration(structuredClone(faintSilk))},
 {id:'builtin-ios6-crystal',name:'iOS 6 · 复古水晶',read:()=>validateDecoration(structuredClone(ios6))},
 {id:'builtin-acid-orbit',name:'星轨 · 深空',read:()=>validateDecoration(structuredClone(dark))},
 {id:'builtin-acid-orbit-lavender',name:'星轨 · 雾紫',read:()=>validateDecoration(structuredClone(lavender))},
 {id:'builtin-silent-letter-dark',name:'无声回信 · 黑（by黛）',read:()=>validateDecoration(structuredClone(silentLetter))},
];
