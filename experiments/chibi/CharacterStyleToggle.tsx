import React,{useEffect,useState} from 'react';
import {getCharacterStyle,setCharacterStyle,subscribeCharacterStyle,type CharacterStyle} from '../../apps/room3d/chibi/characterStyle';

/** Global preference only; never rewrites a resident's saved figure/hair data. */
export function CharacterStyleToggle(){
 const [style,update]=useState(getCharacterStyle);
 useEffect(()=>subscribeCharacterStyle(()=>update(getCharacterStyle())),[]);
 return <fieldset className="flex shrink-0 items-center justify-center gap-2 border-b border-black/10 px-3 py-2 text-xs" aria-label="3D 人物画风">
  <legend className="sr-only">3D 人物画风</legend>
  <span>人物画风</span>
  {([['modern','现代'],['legacy','经典']] as [CharacterStyle,string][]).map(([key,label])=>
   <button key={key} type="button" aria-label={label+'画风'} aria-pressed={style===key}
     className={'rounded-full border px-3 py-2 '+(style===key?'border-green-800 bg-green-800 text-white':'border-slate-400')}
     onClick={()=>setCharacterStyle(key)}>{label}</button>)}
 </fieldset>;
}
