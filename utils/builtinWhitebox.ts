import dark from '../presets/chat/acid-orbit.json';
import lavender from '../presets/chat/acid-orbit-lavender.json';
import silentLetter from '../presets/chat/silent-letter-dark.json';
import ios6 from '../presets/chat/ios6.json';
import {validateDecoration} from './chatDecoration';

/** Bundled outfits stay local; read returns a fresh validated preset for editing/applying. */
export const BUILTIN_WHITEBOX_PRESETS = [
 {id:'builtin-ios6-crystal',name:'iOS 6 · 复古水晶',read:()=>validateDecoration(structuredClone(ios6))},
 {id:'builtin-acid-orbit',name:'星轨 · 深空',read:()=>validateDecoration(structuredClone(dark))},
 {id:'builtin-acid-orbit-lavender',name:'星轨 · 雾紫',read:()=>validateDecoration(structuredClone(lavender))},
 {id:'builtin-silent-letter-dark',name:'无声回信 · 黑（by黛）',read:()=>validateDecoration(structuredClone(silentLetter))},
];
