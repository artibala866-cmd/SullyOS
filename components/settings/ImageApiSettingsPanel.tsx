import React, { useEffect, useState } from 'react';

export type ImageProvider = 'openai' | 'nai';
export type ImageApiSettings = { provider: ImageProvider; baseUrl: string; apiKey: string; model: string; positive: string; negative: string; width: number; height: number };
const KEY = 'sully_image_api_v1';
export const readImageSettings = (): ImageApiSettings => {
  const fallback: ImageApiSettings = { provider: 'openai', baseUrl: '', apiKey: '', model: '', positive: '', negative: '', width: 832, height: 1216 };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return fallback; }
};
export const saveImageSettings = (settings: ImageApiSettings) => localStorage.setItem(KEY, JSON.stringify(settings));
const inputStyle = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400';
export const ImageApiSettingsPanel: React.FC = () => {
  const [form, setForm] = useState<ImageApiSettings>(readImageSettings);
  const [status, setStatus] = useState('');
  const patch = (value: Partial<ImageApiSettings>) => setForm(prev => ({ ...prev, ...value }));
  return <section className="bg-[#fffefe] rounded-3xl p-5 shadow-sm border border-slate-200 space-y-4">
    <div><h2 className="font-semibold text-slate-800">生图 API</h2><p className="text-xs text-slate-400 mt-1">独立于对话及语音 API，支持中转站与 NovelAI</p></div>
    <label className="block text-xs text-slate-500 space-y-2">接入渠道<select className={inputStyle} value={form.provider} onChange={e => patch({ provider: e.target.value as ImageProvider })}><option value="openai">OpenAI 兼容中转站</option><option value="nai">NovelAI (NAI)</option></select></label>
    <label className="block text-xs text-slate-500 space-y-2">API 地址<input className={inputStyle} value={form.baseUrl} placeholder={form.provider === 'nai' ? 'https://image.novelai.net' : 'https://your-relay.example/v1'} onChange={e => patch({ baseUrl: e.target.value })} /></label>
    <label className="block text-xs text-slate-500 space-y-2">API Key<input className={inputStyle} type="password" autoComplete="off" value={form.apiKey} onChange={e => patch({ apiKey: e.target.value })} /></label>
    <label className="block text-xs text-slate-500 space-y-2">模型名称<input className={inputStyle} value={form.model} placeholder={form.provider === 'nai' ? 'nai-diffusion-4-5-full' : '填写中转站模型 ID'} onChange={e => patch({ model: e.target.value })} /></label>
    <label className="block text-xs text-slate-500 space-y-2">全局正面提示词<textarea className={inputStyle} rows={3} value={form.positive} onChange={e => patch({ positive: e.target.value })} placeholder="画风、光影、画质等" /></label>
    <label className="block text-xs text-slate-500 space-y-2">全局负面提示词<textarea className={inputStyle} rows={3} value={form.negative} onChange={e => patch({ negative: e.target.value })} placeholder="不希望出现的元素" /></label>
    <div className="grid grid-cols-2 gap-3">{(['width','height'] as const).map(key => <label key={key} className="text-xs text-slate-500 space-y-2">{key === 'width' ? '宽度' : '高度'}<input className={inputStyle} type="number" min={64} max={2048} step={64} value={form[key]} onChange={e => patch({ [key]: Number(e.target.value) })} /></label>)}</div>
    <button className="w-full py-3 rounded-xl bg-slate-700 text-white text-sm" onClick={() => { try { saveImageSettings(form); setStatus('生图配置已保存到当前设备'); } catch { setStatus('保存失败，请检查浏览器存储权限'); } }}>保存生图 API</button>
    {status && <p role="status" className="text-xs text-slate-500">{status}</p>}
    <p className="text-xs text-slate-400">API Key 仅保存在当前浏览器，请勿在公共设备填写。不同中转站的生图协议可能不同。</p>
  </section>;
};
export default ImageApiSettingsPanel;
