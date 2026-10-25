import React, { useEffect, useRef, useState } from 'react';
import { readImageSettings } from '../settings/ImageApiSettingsPanel';
import { generateCharacterImage } from '../../utils/imageGeneration';
import TokenImg from '../os/TokenImg';
import { DB } from '../../utils/db';
import { dataUrlToBlob, deleteBlobRef, deleteBlobRefIfUnreferenced, getBlobForRef, isBlobRef, putImageBlob } from '../../utils/blobRef';

const key = (id: string) => 'sully_image_character_v1_' + id;
export type CharacterImageProfile = { appearance: string; reference: string };
export const readCharacterImageProfile = (id: string): CharacterImageProfile => {
  try { return { appearance: '', reference: '', ...JSON.parse(localStorage.getItem(key(id)) || '{}') }; }
  catch { return { appearance: '', reference: '' }; }
};

const CharacterImagePanel: React.FC<{ characterId: string }> = ({ characterId }) => {
  const [profile, setProfile] = useState<CharacterImageProfile>(() => readCharacterImageProfile(characterId));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const characterRef = useRef(characterId);
  characterRef.current = characterId;

  useEffect(() => {
    let active = true;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setGenerated('');
    const current = readCharacterImageProfile(characterId);
    setProfile(current);
    setStatus('');

    // Older builds saved the whole reference picture in localStorage. Migrate it
    // to the same IndexedDB blob store used throughout SullyOS, without losing
    // the original if migration is interrupted.
    if (/^data:image\//i.test(current.reference)) {
      void putImageBlob(dataUrlToBlob(current.reference)).then(ref => {
        if (!active) return;
        const latest = readCharacterImageProfile(characterId);
        if (latest.reference !== current.reference) return;
        const migrated = { ...latest, reference: ref };
        localStorage.setItem(key(characterId), JSON.stringify(migrated));
        setProfile(migrated);
      }).catch(() => {
        if (active) setStatus('旧参考图迁移失败；原图已保留，可以重新上传');
      });
    }
    return () => { active = false; controllerRef.current?.abort(); };
  }, [characterId]);

  const save = (value: CharacterImageProfile): boolean => {
    try {
      localStorage.setItem(key(characterId), JSON.stringify(value));
      setProfile(value);
      setStatus('已保存到当前浏览器');
      return true;
    } catch {
      setStatus('保存失败：浏览器存储空间不足');
      return false;
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setStatus('请上传 PNG、JPG 或 WebP 图片');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus('锁脸参考图请小于 10 MB');
      return;
    }
    try {
      const targetId = characterId;
      const ref = await putImageBlob(file);
      if (targetId !== characterRef.current) {
        await deleteBlobRef(ref);
        return;
      }
      const previous = readCharacterImageProfile(targetId);
      if (!save({ ...previous, reference: ref })) {
        await deleteBlobRef(ref);
        return;
      }
      if (isBlobRef(previous.reference)) void deleteBlobRefIfUnreferenced(previous.reference);
      setStatus('锁脸参考图已保存');
    } catch (error) {
      setStatus('参考图上传失败：' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const generate = async () => {
    if (busy) {
      controllerRef.current?.abort();
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setStatus('正在生成...');
    try {
      const image = await generateCharacterImage(readImageSettings(), { ...profile }, controller.signal);
      if (controller.signal.aborted) return;
      const ref = await putImageBlob(image);
      if (controller.signal.aborted) {
        await deleteBlobRef(ref);
        return;
      }
      try {
        await DB.saveGalleryImage({
          id: 'generated-' + Date.now() + '-' + Math.random().toString(36).slice(2),
          charId: characterId,
          url: ref,
          timestamp: Date.now(),
        });
      } catch (error) {
        await deleteBlobRef(ref);
        throw error;
      }
      if (!controller.signal.aborted) {
        setGenerated(ref);
        setStatus('生成成功，已自动保存到该角色相册');
      }
    } catch (error) {
      if (controllerRef.current === controller) {
        setStatus(controller.signal.aborted ? '已取消生图' : '生成失败：' + (error instanceof Error ? error.message : String(error)));
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  };

  const removeReference = () => {
    const oldRef = profile.reference;
    if (save({ ...profile, reference: '' }) && isBlobRef(oldRef)) {
      void deleteBlobRefIfUnreferenced(oldRef);
    }
  };

  const downloadGenerated = async () => {
    try {
      const blob = await getBlobForRef(generated);
      if (!blob) throw new Error('生成图片已丢失');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sully-character-' + characterId + '-' + Date.now() + (blob.type === 'image/jpeg' ? '.jpg' : blob.type === 'image/webp' ? '.webp' : '.png');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      setStatus('下载失败：' + (error instanceof Error ? error.message : String(error)));
    }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
    <div><h3 className="text-sm font-semibold text-slate-700">生图外貌设定</h3><p className="text-xs text-slate-400 mt-1">专属参考图与外貌提示词，不影响聊天人设</p></div>
    <label className="block text-xs text-slate-500 space-y-2">外貌描述 / 正面提示词<textarea rows={4} value={profile.appearance} onChange={e => save({ ...profile, appearance: e.target.value })} placeholder="发型、发色、眼睛、五官、服装等" className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none" /></label>
    <label className="block text-xs text-slate-500 space-y-2">锁脸参考图（上传角色图片）<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} className="block w-full text-xs" /></label>
    {profile.reference && <div className="space-y-2"><TokenImg alt="角色生图参考图" value={profile.reference} className="max-h-44 rounded-xl object-contain" /><button type="button" className="text-xs text-slate-500 underline" onClick={removeReference}>移除参考图</button></div>}
    <p className="text-xs text-slate-400">参考图将用于支持图生图或参考图的生图渠道；仅上传并不能保证模型锁脸，实际效果取决于 API。</p>
    <button type="button" onClick={() => { void generate(); }} className="w-full rounded-xl bg-slate-700 text-white py-3 text-sm">{busy ? '取消本次生图' : '使用当前生图 API 生成角色图片'}</button>
    {generated && <div className="space-y-2"><TokenImg alt="生成的角色图片" value={generated} className="w-full max-h-96 object-contain rounded-xl" /><button type="button" onClick={() => { void downloadGenerated(); }} className="text-xs underline text-slate-600">下载生成图片</button></div>}
    {status && <p role="status" className="text-xs text-slate-500">{status}</p>}
  </section>;
};
export default CharacterImagePanel;
