import React from 'react';
import StudyAvatar from './StudyAvatar';
import type {CharacterProfile} from '../types';

type CharacterChoice=Pick<CharacterProfile,'id'|'name'|'avatar'>;
interface Props{
  characters:readonly CharacterChoice[];
  selectedId:string;
  onSelect:(id:string)=>void;
  compact?:boolean;
}
export default function StudyCharPicker({characters,selectedId,onSelect,compact=false}:Props){
  return <div className={'min-w-0 '+(compact?'':'space-y-3')} aria-label="选择陪伴 Char">
    {!compact&&<div className="flex items-center justify-between gap-3 px-1">
      <div><p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400">YOUR COMPANIONS</p><h2 className="font-semibold text-sm">今天谁陪你？</h2></div>
      <span className="text-[11px] text-neutral-400">{characters.length} 位伙伴</span>
    </div>}
    <div className={'flex min-w-0 gap-2 overflow-x-auto pb-0.5 snap-x snap-mandatory '+(compact?'':'rounded-2xl')} role="group" aria-label="Char 头像选择">
      {characters.map(char=><button key={char.id} type="button" aria-label={'选择 '+char.name}
        aria-pressed={selectedId===char.id} onClick={()=>onSelect(char.id)}
        className={'snap-start flex shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-1 transition-colors focus-visible:ring-2 focus-visible:ring-neutral-800 '+(selectedId===char.id?'bg-[#ededed]':'hover:bg-neutral-100')}>
        <span className={'relative grid place-items-center rounded-full border-2 p-[2px] '+(compact?'h-12 w-12':'h-14 w-14')+' '+(selectedId===char.id?'border-neutral-900':'border-transparent')}>
          <StudyAvatar value={char.avatar} name={char.name} className="h-full w-full rounded-full"/>
          {selectedId===char.id&&<span className="absolute -bottom-0.5 -right-1 grid h-4 w-4 place-items-center rounded-full border-2 border-white bg-neutral-900 text-[10px] text-white">✓</span>}
        </span>
        <span className={'max-w-[84px] truncate text-center '+(compact?'text-[10px]':'text-[11px] font-medium')}>{char.name}</span>
      </button>)}
      {characters.length===0&&<div className="w-full rounded-2xl border border-dashed border-neutral-200 p-5 text-center text-xs text-neutral-500">神经链接中还没有角色；建立角色后会在这里显示真实头像。</div>}
    </div>
  </div>;
}
