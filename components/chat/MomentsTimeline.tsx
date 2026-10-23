import React from 'react';
import PhoneAvatar from './PhoneAvatar';
import { setMomentLike, addMomentComment, deleteCharacterMoment } from '../../utils/characterPhoneMoments';
import { useState } from 'react';
import type { CharacterMoment } from '../../utils/characterPhoneMoments';
import type { UserProfile } from '../../types';
import type { NpcProfile } from '../../utils/characterPhoneNpcs';

export function MomentsTimeline({name,characterId,posts,contacts,charAvatar,userProfile}:{name:string;characterId:string;posts:CharacterMoment[];contacts:NpcProfile[];charAvatar?:string;userProfile?:UserProfile}) {
  const [reply,setReply]=useState('');
  const [draft,setDraft]=useState('');
  const avatar=(id:string)=>id===characterId?charAvatar:id==='user'?(userProfile?.perCharAvatars?.[characterId]||userProfile?.avatar):undefined;
  const label=(id:string)=>id===characterId?name:contacts.find(p=>p.id===id)?.nickname||contacts.find(p=>p.id===id)?.name||'微信好友';
  return <section className="bg-white">
    {posts.filter(p=>!p.deletedAt).map(p=><article key={p.id} className="flex gap-3 border-b border-gray-100 px-4 py-5">
      <PhoneAvatar key={avatar(p.authorId)||label(p.authorId)} src={avatar(p.authorId)} name={label(p.authorId)} className="h-11 w-11 rounded text-lg"/>
      <div className="min-w-0 flex-1"><strong className="text-[#536c93]">{label(p.authorId)}</strong><p className="mt-2 whitespace-pre-wrap break-words text-sm">{p.text}</p>
      {!!p.imageUrls?.length&&<div className="mt-2 grid grid-cols-3 gap-1">{p.imageUrls.map((url,i)=><img key={i} src={url} alt="朋友圈图片" className="aspect-square w-full object-cover"/>)}</div>}
      <div className="mt-3 flex items-center justify-between text-xs text-gray-400"><time>{new Date(p.createdAt).toLocaleString('zh-CN')}</time><span className="flex gap-3"><button onClick={()=>setMomentLike(characterId,p.id,'user',!p.likes?.some(l=>l.actorId==='user'))}>赞</button><button onClick={()=>setReply(p.id)}>评论</button>{p.authorId===characterId&&<button onClick={()=>{if(window.confirm('删除这条朋友圈？'))deleteCharacterMoment(characterId,p.id,'user');}}>删除</button>}</span></div>
      {(!!p.likes?.length||!!p.comments?.length)&&<div className="mt-2 rounded bg-gray-100 p-2 text-xs">{!!p.likes?.length&&<div>♥ {p.likes.map(l=>l.actorId==='user'?'我':label(l.actorId)).join('、')}</div>}{p.comments?.filter(c=>!c.deletedAt).map(c=><div key={c.id}>{c.authorId==='user'?'我':label(c.authorId)}：{c.text}</div>)}</div>}
      {reply===p.id&&<form className="mt-2 flex gap-2" onSubmit={e=>{e.preventDefault();if(draft.trim())addMomentComment(characterId,p.id,{id:crypto.randomUUID(),authorId:'user',text:draft.trim(),createdAt:Date.now()});setDraft('');setReply('');}}><input aria-label="评论" value={draft} onChange={e=>setDraft(e.target.value)} className="min-w-0 flex-1 border p-1 text-sm"/><button>发送</button></form>}</div>
    </article>)}
  </section>;
}
