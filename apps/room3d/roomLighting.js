import * as T from 'three';
import {nowInTimeZone} from '../../utils/timezone';

// Art-directed time bands, not astronomical sunrise/sunset. Preserve readable
// local colours in every phase; use the sky and light colour for atmosphere.
export const ROOM_LIGHT_PHASES={
 morning:{directSun:true,sunPower:4.8,label:'清晨',sky:'#eaf0f6',ground:'#e5dfdf',ambient:1.05,key:'#fff0da',keyPower:1.8,fill:'#e3efff',fillPower:.42,window:'#ffe6ba',windowPower:.78,background:'#eeece8',shade:'#f0efed',sun:'#fff5e7',brightness:1,skyTop:'#a3d3f3',skyBottom:'#ffe7ce',cloud:'#fff9f2',night:0,character:'#fffaf2'},
 day:{label:'白天',sky:'#f7f8f5',ground:'#e8e4e0',ambient:1.38,key:'#fff9eb',keyPower:2.25,fill:'#e7f4ff',fillPower:.46,window:'#fff0ce',windowPower:1,background:'#f1efeb',shade:'#f1f0ec',sun:'#fffaf0',brightness:1.04,skyTop:'#70c6fa',skyBottom:'#f4fbff',cloud:'#ffffff',night:0,character:'#ffffff'},
 sunset:{directSun:true,sunPower:6.2,label:'夕阳',sky:'#f1e7ed',ground:'#d7c4cc',ambient:1.05,key:'#ffdebd',keyPower:1.8,fill:'#d8dfff',fillPower:.44,window:'#ffb36e',windowPower:1.2,background:'#f0e7e3',shade:'#f0e9ec',sun:'#ffdfb9',brightness:1,skyTop:'#c29be0',skyBottom:'#ffcb8f',cloud:'#ffe8cf',night:0,character:'#fff0e0'},
 night:{label:'夜晚',sky:'#dce3f0',ground:'#c8c3d2',ambient:1.12,key:'#ffe6c8',keyPower:1.75,fill:'#aec7ff',fillPower:.38,window:'#adcbff',windowPower:.16,background:'#d6d3db',shade:'#e2e5ef',sun:'#fff0db',brightness:.86,skyTop:'#24375d',skyBottom:'#6a7397',cloud:'#91a1be',night:1,character:'#f3eeff'},
};
export function roomLightPhase(timeZone,base=new Date()){
 const hour=nowInTimeZone(timeZone,base).getHours();
 return hour>=5&&hour<8?'morning':hour>=8&&hour<16?'day':hour>=16&&hour<19?'sunset':'night';
}
export function resolveRoomLightPhase(mode,timeZone,base){
 return Object.hasOwn(ROOM_LIGHT_PHASES,mode)?mode:roomLightPhase(timeZone,base);
}
// These uniform objects are shared by this editor's materials. Changing time
// updates values only: no rebuild, shader compilation or new render pass.
export function createRoomLightUniforms(){
 return {skySunset:{value:0},roomSunContrast:{value:0},roomShadeTint:{value:new T.Color()},roomSunTint:{value:new T.Color()},roomBrightness:{value:1},skyTop:{value:new T.Color()},skyBottom:{value:new T.Color()},skyCloud:{value:new T.Color()},skyNight:{value:0}};
}
export function updateRoomLightUniforms(uniforms,profile){
 for(const [key,field]of [['roomShadeTint','shade'],['roomSunTint','sun'],['skyTop','skyTop'],['skyBottom','skyBottom'],['skyCloud','cloud']])uniforms[key].value.set(profile[field]);
 uniforms.roomBrightness.value=profile.brightness;uniforms.skyNight.value=profile.night;
 uniforms.roomSunContrast.value=profile.directSun?1:0;
 uniforms.skySunset.value=profile===ROOM_LIGHT_PHASES.sunset?1:0;
}
