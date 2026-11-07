import React, { useEffect, useRef, useState } from 'react';
import TokenImg from '../os/TokenImg';
import { dataUrlToBlob, deleteBlobRef, deleteBlobRefIfUnreferenced, isBlobRef, putImageBlob } from '../../utils/blobRef';
import { readCharacterImageProfile, writeCharacterImageProfile, type CharacterImageProfile } from '../../utils/characterImageProfile';

export { readCharacterImageProfile, writeCharacterImageProfile, clearCharacterImageProfile } from '../../utils/characterImageProfile';
export type { CharacterImageProfile } from '../../utils/characterImageProfile';

const CharacterImagePanel: React.FC<{ characterId: string }> = ({ characterId }) => {
  const [profile, setProfile] = useState<CharacterImageProfile>(() => readCharacterImageProfile(characterId));
  const [status, setStatus] = useState('');
  const uploadRevision = useRef(0);
  const characterRef = useRef(characterId);
  characterRef.current = characterId;

  useEffect(() => {
    let active = true;
    const current = readCharacterImageProfile(characterId);
    setProfile(current);
    setStatus('');

    // Older builds saved the whole reference picture in localStorage. Migrate it
    // to the same IndexedDB blob store used throughout SullyOS, without losing
    // the original if migration is interrupted.
    if (/^data:image\//i.test(current.reference)) {
      void Promise.resolve().then(() => putImageBlob(dataUrlToBlob(current.reference))).then(async ref => {
        try {
          const latest = readCharacterImageProfile(characterId);
          if (!active || latest.reference !== current.reference) return;
          const migrated = { ...latest, reference: ref };
          writeCharacterImageProfile(characterId, migrated);
          setProfile(migrated);
        } finally {
          if (readCharacterImageProfile(characterId).reference !== ref) await deleteBlobRef(ref);
        }
      }).catch(() => {
        if (active) setStatus('旧参考图迁移失败；原图已保留，可以重新上传');
      });
    }
    return () => { active = false; uploadRevision.current++; };
  }, [characterId]);

  const save = (value: CharacterImageProfile): boolean => {
    try {
      writeCharacterImageProfile(characterId, value);
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
    const revision = ++uploadRevision.current;
    try {
      const targetId = characterId;
      const previewUrl = URL.createObjectURL(file);
      try {
        const preview = new Image();
        preview.src = previewUrl;
        await preview.decode();
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
      if (revision !== uploadRevision.current) return;
      const ref = await putImageBlob(file);
      if (revision !== uploadRevision.current || targetId !== characterRef.current) {
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
      if (revision === uploadRevision.current) setStatus('参考图上传失败：' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const removeReference = () => {
    uploadRevision.current++;
    const latest = readCharacterImageProfile(characterId);
    const oldRef = latest.reference;
    if (save({ ...latest, reference: '' }) && isBlobRef(oldRef)) {
      void deleteBlobRefIfUnreferenced(oldRef);
    }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
    <div><h3 className="text-sm font-semibold text-slate-700">生图外貌设定</h3><p className="text-xs text-slate-400 mt-1">自动保存。角色实际生图时会读取此处设置。</p></div>
    <label className="block text-xs text-slate-500 space-y-2">外貌描述 / 正面提示词<textarea rows={4} value={profile.appearance} onChange={e => save({ ...profile, appearance: e.target.value })} placeholder="发型、发色、眼睛、五官、服装等" className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none" /></label>
    <label className="block text-xs text-slate-500 space-y-2">五官 / 脸部特征提示词<textarea rows={2} value={profile.facePrompt || ''} onChange={e => save({ ...profile, facePrompt: e.target.value })} placeholder="稳定的五官、脸型、发色等" className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none" /></label>
    <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={profile.referenceEnabled !== false} onChange={e => save({ ...profile, referenceEnabled: e.target.checked })} /> 生图时启用此角色的锁脸参考图</label>
    <label className="block text-xs text-slate-500 space-y-2">参考图用途
      <select value={profile.referenceMode || 'identity'} onChange={e => save({ ...profile, referenceMode: e.target.value as 'identity' | 'composition' })} className="block w-full rounded-xl border border-slate-200 p-2.5 text-sm">
        <option value="identity">锁定人物身份 / 脸部（默认）</option>
        <option value="composition">参考画面构图 / 造型</option>
      </select>
    </label>
    <details className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600 space-y-2">
      <summary className="cursor-pointer font-medium">服装约束与种子设置（含 BabyLink 导入项）</summary>
      <label className="block space-y-1 pt-2">服装指导<textarea rows={2} value={profile.wardrobe?.guidance || ''} onChange={e => save({ ...profile, wardrobe: { guidance: e.target.value, inventory: profile.wardrobe?.inventory || '', avoid: profile.wardrobe?.avoid || '' } })} className="block w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="block space-y-1">服装资料<textarea rows={2} value={profile.wardrobe?.inventory || ''} onChange={e => save({ ...profile, wardrobe: { guidance: profile.wardrobe?.guidance || '', inventory: e.target.value, avoid: profile.wardrobe?.avoid || '' } })} className="block w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="block space-y-1">应避免的服装<textarea rows={2} value={profile.wardrobe?.avoid || ''} onChange={e => save({ ...profile, wardrobe: { guidance: profile.wardrobe?.guidance || '', inventory: profile.wardrobe?.inventory || '', avoid: e.target.value } })} className="block w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="flex items-center gap-2 pt-1"><input type="checkbox" checked={profile.seedLockEnabled === true} onChange={e => save({ ...profile, seedLockEnabled: e.target.checked })} /> 固定生图随机种子（仅支持的渠道）</label>
      <label className="block space-y-1">随机种子<input value={profile.seed || ''} onChange={e => save({ ...profile, seed: e.target.value })} inputMode="numeric" className="block w-full rounded-lg border border-slate-200 p-2" placeholder="整数 0～4294967295" /></label>
    </details>
    <label className="block text-xs text-slate-500 space-y-2">锁脸参考图（上传角色图片）<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} className="block w-full text-xs" /></label>
    {profile.reference && <div className="space-y-2"><TokenImg alt="角色生图参考图" value={profile.reference} className="max-h-44 rounded-xl object-contain" /><button type="button" className="text-xs text-slate-500 underline" onClick={removeReference}>移除参考图</button></div>}
    <p className="text-xs text-slate-400">{profile.referenceEnabled === false ? '当前已关闭参考图参与生成，图片仍会保留。' : '已启用的参考图将用于支持图生图或参考图的生图渠道；锁脸效果取决于 API。'} 不同生图渠道可能不支持固定种子。</p>
    {status && <p role="status" className="text-xs text-slate-500">{status}</p>}
  </section>;
};
export default CharacterImagePanel;
