import React, { useState } from 'react';
import { processImage } from '../../utils/file';
import { migrateDataUrlToRef } from '../../utils/blobRef';
import { addCharacterAvatar, activateCharacterAvatar, readCharacterAvatarLibrary, removeCharacterAvatar, setAutonomousAvatarEnabled, notifyCharacterAvatarChanged } from '../../utils/characterAvatarLibrary';
import TokenImg from '../os/TokenImg';

export default function CharacterAvatarLibraryModal({ characterId, defaultAvatar, onClose, onApply }: {characterId:string;defaultAvatar?:string;onClose:()=>void;onApply:(image:string)=>Promise<void>}) {
  const [revision,setRevision] = useState(0);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const library = readCharacterAvatarLibrary(characterId);
  const refresh = () => setRevision(n=>n+1);
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file=event.target.files?.[0]; if(!file)return;
    setBusy(true);setError('');
    try {const data=await processImage(file);const image=await migrateDataUrlToRef(data);addCharacterAvatar(characterId,image,'upload');refresh();}
    catch(e){setError(e instanceof Error?e.message:'图片保存失败');}
    finally {setBusy(false);event.target.value='';}
  };
  const apply = async (id:string) => {
    setBusy(true);setError('');
    try {
      const entry=library.entries.find(e=>e.id===id);
      if(!entry)throw new Error('头像不存在');
      await onApply(entry.image);
      activateCharacterAvatar(characterId,id,false);
      refresh();
    } catch(e){setError(e instanceof Error?e.message:'头像更新失败');}
    finally{setBusy(false);}
  };
  return <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/45 p-5" role="dialog" aria-modal="true" aria-label="角色头像库">
    <div className="w-full max-w-md rounded-2xl bg-neutral-50 p-5 text-neutral-900 shadow-xl">
      <div className="flex items-center justify-between"><h2 className="font-semibold">角色头像库</h2><button onClick={onClose} aria-label="关闭头像库">关闭</button></div>
      <p className="my-3 text-xs text-neutral-500">每位角色独立保存。选择后同步私聊、角色档案与查手机。</p>
      <label className="inline-block cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm">添加图片<input type="file" accept="image/*" className="hidden" disabled={busy} onChange={upload}/></label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={library.autonomousEnabled} onChange={e=>{setAutonomousAvatarEnabled(characterId,e.target.checked);refresh();}}/>允许 Char 自主从头像库换头像</label>
      <p className="mt-1 text-xs text-neutral-500">开启后，Char 可以自主从头像库挑选；普通聊天图片不会被自动用作头像。</p>
      <div className="mt-4 grid max-h-72 grid-cols-3 gap-3 overflow-y-auto">
        {library.entries.map(entry=><div key={entry.id} className="rounded-xl border border-neutral-200 bg-white p-1">
          <TokenImg value={entry.image} className="aspect-square w-full rounded-lg object-cover" alt="收藏头像"/>
          <button disabled={busy} onClick={()=>void apply(entry.id)} className="mt-1 w-full rounded-md bg-neutral-800 px-1 py-1 text-xs text-white">{library.activeId===entry.id?'当前头像':'使用'}</button>
          <button disabled={busy} onClick={()=>{removeCharacterAvatar(characterId,entry.id);notifyCharacterAvatarChanged(characterId);refresh();}} className="mt-1 w-full text-xs text-neutral-500">删除收藏</button>
        </div>)}
      </div>
      {!library.entries.length && <p className="py-6 text-center text-sm text-neutral-400">还没有收藏的头像</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  </div>;
}
