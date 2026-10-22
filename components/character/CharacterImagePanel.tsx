import { readImageSettings } from '../settings/ImageApiSettingsPanel';
import { generateCharacterImage } from '../../utils/imageGeneration';
import React, { useEffect, useState } from 'react';
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
  const generate = async () => {
    setBusy(true); setStatus('正在生成...');
    try { const image = await generateCharacterImage(readImageSettings(), profile); setGenerated(image); setStatus('生成成功'); }
    catch (e) { setStatus('生成失败：' + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  };
  useEffect(() => { setProfile(readCharacterImageProfile(characterId)); setStatus(''); }, [characterId]);
  const save = (value: CharacterImageProfile) => {
    setProfile(value);
    try { localStorage.setItem(key(characterId), JSON.stringify(value)); setStatus('已保存到当前浏览器'); }
    catch { setStatus('存储空间不足，建议上传更小的参考图'); }
  };
  const upload = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setStatus('请选择图片文件'); return; }
    if (file.size > 2 * 1024 * 1024) { setStatus('参考图请小于 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') save({ ...profile, reference: reader.result }); };
    reader.readAsDataURL(file);
  };
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
    <div><h3 className="text-sm font-semibold text-slate-700">生图外貌设定</h3><p className="text-xs text-slate-400 mt-1">专属参考图与外貌提示词，不影响聊天人设</p></div>
    <label className="block text-xs text-slate-500 space-y-2">外貌描述 / 正面提示词<textarea rows={4} value={profile.appearance} onChange={e => save({ ...profile, appearance: e.target.value })} placeholder="发型、发色、眼睛、五官、服装等" className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none" /></label>
    <label className="block text-xs text-slate-500 space-y-2">锁脸参考图（上传角色图片）<input type="file" accept="image/*" onChange={e => upload(e.target.files?.[0])} className="block w-full text-xs" /></label>
    {profile.reference && <div className="space-y-2"><img alt="角色生图参考图" src={profile.reference} className="max-h-44 rounded-xl object-contain" /><button type="button" className="text-xs text-slate-500 underline" onClick={() => save({ ...profile, reference: '' })}>移除参考图</button></div>}
    <p className="text-xs text-slate-400">参考图将用于支持图生图或参考图的生图渠道；仅上传并不能保证模型锁脸，实际效果取决于 API。</p>
    <button type="button" disabled={busy} onClick={generate} className="w-full rounded-xl bg-slate-700 text-white py-3 text-sm disabled:opacity-50">{busy ? '正在生图...' : '使用当前生图 API 生成角色图片'}</button>
    {generated && <div className="space-y-2"><img alt="生成的角色图片" src={generated} className="w-full max-h-96 object-contain rounded-xl" /><a href={generated} target="_blank" rel="noreferrer" className="text-xs underline text-slate-600">打开生成图片</a></div>}
    {status && <p role="status" className="text-xs text-slate-500">{status}</p>}
  </section>;
};
export default CharacterImagePanel;
