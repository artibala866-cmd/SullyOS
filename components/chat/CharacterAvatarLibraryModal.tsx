import React, { useEffect, useRef, useState } from 'react';
import type { VisionApiConfig } from '../../types';
import { describeImageWithVisionApi, isVisionApiReady } from '../../utils/visionApi';
import { processImage } from '../../utils/file';
import { migrateDataUrlToRef } from '../../utils/blobRef';
import { addCharacterAvatar, activateCharacterAvatar, readCharacterAvatarLibrary, removeCharacterAvatar, setAutonomousAvatarEnabled, notifyCharacterAvatarChanged, saveCharacterAvatarDescription } from '../../utils/characterAvatarLibrary';
import TokenImg from '../os/TokenImg';

export default function CharacterAvatarLibraryModal({
  characterId, defaultAvatar, onClose, onApply, visionApiConfig,
}: {
  characterId:string; defaultAvatar?:string; onClose:()=>void;
  onApply:(image:string)=>Promise<void>;
  visionApiConfig?:VisionApiConfig | null;
}) {
  const [revision,setRevision] = useState(0);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const library = readCharacterAvatarLibrary(characterId);
  const [recognizing,setRecognizing] = useState(false);
  const [recognitionNotice,setRecognitionNotice] = useState('');
  const backfillStarted = useRef('');
  const refresh = () => setRevision(n=>n+1);
  // A legacy library may contain avatars saved before visual metadata existed.
  // Backfill in a bounded serial queue, never invent descriptions without vision.
  useEffect(() => {
    if (!isVisionApiReady(visionApiConfig)) return;
    const token = characterId + ':' + visionApiConfig.model;
    if (backfillStarted.current === token) return;
    backfillStarted.current = token;
    let cancelled = false;
    const run = async () => {
      const pending = readCharacterAvatarLibrary(characterId).entries
        .filter(e => !e.visionDescription).slice(0, 12);
      if (!pending.length) return;
      setRecognizing(true);
      setRecognitionNotice('正在为旧头像补存识图描述…');
      let completed = 0;
      for (const entry of pending) {
        if (cancelled) break;
        try {
          const description = await describeImageWithVisionApi(entry.image,visionApiConfig);
          if (cancelled) break;
          if (saveCharacterAvatarDescription(characterId,entry.id,description,visionApiConfig.model)) completed++;
          refresh();
        } catch (e) {
          if (!cancelled) setRecognitionNotice('部分旧头像识图失败，可重新打开头像库重试：' +
            (e instanceof Error ? e.message : '识图失败'));
          break;
        }
      }
      if (!cancelled) {
        setRecognizing(false);
        if (completed === pending.length) setRecognitionNotice('已保存 ' + completed + ' 张旧头像的识图描述');
      }
    };
    void run();
    return () => {cancelled = true;};
  }, [characterId, visionApiConfig?.enabled, visionApiConfig?.baseUrl, visionApiConfig?.model, visionApiConfig?.apiKey]);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file=event.target.files?.[0]; if(!file)return;
    setBusy(true);setError('');
    try {
      if (!isVisionApiReady(visionApiConfig)) throw new Error('先到设置配置并开启识图 API，头像入库前必须完成识图');
      const data=await processImage(file, { maxWidth: 960, quality: 0.8 });
      const description=await describeImageWithVisionApi(data,visionApiConfig);
      const image=await migrateDataUrlToRef(data);
      addCharacterAvatar(characterId,image,'upload',{description,model:visionApiConfig.model});
      notifyCharacterAvatarChanged(characterId);
      setRecognitionNotice('识图完成，外观描述已经和这张头像一起保存');
      refresh();
    }
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
      <p className="my-3 text-xs text-neutral-500">与私聊共用同一个头像库。新头像先识图、保存描述，再允许加入；旧头像打开时补识图。</p>
      {!isVisionApiReady(visionApiConfig) && <p className="my-2 text-xs text-neutral-600">识图 API 尚未配置，暂不能入库新图；已保存的旧头像仍可使用。</p>}
      {(recognizing || recognitionNotice) && <p role="status" className="my-2 text-xs text-neutral-500">{recognitionNotice}{recognizing ? '（识图中）' : ''}</p>}
      <label className="inline-block cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm">添加图片<input type="file" accept="image/*" className="hidden" disabled={busy || recognizing || !isVisionApiReady(visionApiConfig)} onChange={upload}/></label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={library.autonomousEnabled} onChange={e=>{setAutonomousAvatarEnabled(characterId,e.target.checked);refresh();}}/>允许 Char 自主从头像库换头像</label>
      <p className="mt-1 text-xs text-neutral-500">开启后根据角色心情和图片识图描述选图；未识图头像不会参与 AI 自动选择。普通聊天图片不会入库。</p>
      <div className="mt-4 grid max-h-72 grid-cols-3 gap-3 overflow-y-auto">
        {library.entries.map(entry=><div key={entry.id} className="rounded-xl border border-neutral-200 bg-white p-1">
          <TokenImg value={entry.image} className="aspect-square w-full rounded-lg object-cover" alt="收藏头像"/>
          <p title={entry.visionDescription || '尚未识图'} className="mt-1 line-clamp-3 min-h-10 text-[11px] leading-4 text-neutral-500">{entry.visionDescription || '等待识图描述'}</p>
          <button disabled={busy || recognizing} onClick={()=>void apply(entry.id)} className="mt-1 w-full rounded-md bg-neutral-800 px-1 py-1 text-xs text-white">{library.activeId===entry.id?'当前头像':'使用'}</button>
          <button disabled={busy} onClick={()=>{removeCharacterAvatar(characterId,entry.id);notifyCharacterAvatarChanged(characterId);refresh();}} className="mt-1 w-full text-xs text-neutral-500">删除收藏</button>
        </div>)}
      </div>
      {!library.entries.length && <p className="py-6 text-center text-sm text-neutral-400">还没有收藏的头像</p>}
      {error && <p role="alert" className="mt-2 text-sm text-neutral-600">{error}</p>}
    </div>
  </div>;
}
