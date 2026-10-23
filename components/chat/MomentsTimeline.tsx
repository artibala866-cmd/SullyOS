import React from 'react';
import type { CharacterMoment } from '../../utils/characterPhoneMoments';
import type { NpcProfile } from '../../utils/characterPhoneNpcs';

export function MomentsTimeline({name,characterId,posts,contacts}:{name:string;characterId:string;posts:CharacterMoment[];contacts:NpcProfile[]}) {
  const label=(id:string)=>id===characterId?name:contacts.find(p=>p.id===id)?.nickname||contacts.find(p=>p.id===id)?.name||'微信好友';
  return <section className="bg-white">
    {posts.filter(p=>!p.deletedAt).map(p=><article key={p.id} className="flex gap-3 border-b border-gray-100 px-4 py-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-teal-200">{label(p.authorId).slice(0,1)}</div>
      <div className="min-w-0 flex-1"><strong className="text-[#536c93]">{label(p.authorId)}</strong><p className="mt-2 whitespace-pre-wrap break-words text-sm">{p.text}</p>
      {!!p.imageUrls?.length&&<div className="mt-2 grid grid-cols-3 gap-1">{p.imageUrls.map((url,i)=><img key={i} src={url} alt="朋友圈图片" className="aspect-square w-full object-cover"/>)}</div>}
      <div className="mt-3 text-xs text-gray-400">{new Date(p.createdAt).toLocaleString('zh-CN')}</div></div>
    </article>)}
  </section>;
}
