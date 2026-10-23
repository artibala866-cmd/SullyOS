import React,{useState} from 'react';
export default function PhoneMemo({characterId}:{characterId:string}){
  const key='sully_character_phone_memo_v1:'+characterId;
  const [value,setValue]=useState(()=>{try{return localStorage.getItem(key)||'';}catch{return '';}});
  return <section className="min-h-full bg-[#fffdf6] p-5"><p className="mb-3 text-sm text-gray-500">备忘录 · 仅保存在当前角色手机</p><textarea aria-label="备忘录" placeholder="写点什么…" value={value} onChange={e=>{setValue(e.target.value);try{localStorage.setItem(key,e.target.value);}catch{}}} className="min-h-[55vh] w-full resize-none bg-transparent text-base leading-7 outline-none"/></section>;
}
