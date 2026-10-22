import React, { useEffect, useState } from 'react';

export type ImageProvider = 'openai' | 'nai';
export type ImageApiSettings = { provider: ImageProvider; baseUrl: string; apiKey: string; model: string; positive: string; negative: string; width: number; height: number };
const KEY = 'sully_image_api_v1';
const PRESETS = 'sully_image_presets_v1';
export const readImageSettings = (): ImageApiSettings => {
  const fallback: ImageApiSettings = { provider: 'openai', baseUrl: '', apiKey: '', model: '', positive: '', negative: '', width: 832, height: 1216 };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return fallback; }
};
export const saveImageSettings = (settings: ImageApiSettings) => localStorage.setItem(KEY, JSON.stringify(settings));
const inputStyle = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400';
export const ImageApiSettingsPanel: React.FC = () => {
  const [form, setForm] = useState<ImageApiSettings>(readImageSettings);
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [presets, setPresets] = useState<{name:string; config:ImageApiSettings}[]>(() => { try { return JSON.parse(localStorage.getItem(PRESETS) || '[]'); } catch { return []; } });
  const [presetName, setPresetName] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const persist = (next: {name:string; config:ImageApiSettings}[]) => { localStorage.setItem(PRESETS, JSON.stringify(next)); setPresets(next); };
  const fetchModels = async () => {
    setLoading(true); setStatus('正在拉取模型...');
    try {
      const url = form.baseUrl.trim().replace(/[/]+$/, '') + '/models';
      const response = await fetch(url, { headers: { Authorization: 'Bearer ' + form.apiKey } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const json = await response.json();
      const list = (Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : []).map((m: any) => typeof m === 'string' ? m : m.id).filter(Boolean);
      setModels(list); setStatus(list.length ? '已拉取 ' + list.length + ' 个模型' : '未找到模型列表');
    } catch (e) { setStatus('拉取失败：' + String(e)); } finally { setLoading(false); }
  };
  const patch = (value: Partial<ImageApiSettings>) => setForm(prev => ({ ...prev, ...value }));
  return <section className="bg-[#fffefe] rounded-3xl p-5 shadow-sm border border-slate-200 space-y-4">
    <button type="button" className="w-full text-left flex justify-between items-center" onClick={() => setExpanded(v => !v)}><span><strong className="block text-[#303030] text-[16px] font-semibold tracking-wide">生图 API</strong><span className="text-xs text-[#999]">中转站 / NovelAI · 独立配置</span></span><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true" className={`w-3 h-3 text-slate-300 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg></button>
    {expanded && <div className="space-y-4">
    <label className="block text-xs text-slate-500 space-y-2">接入渠道<select className={inputStyle} value={form.provider} onChange={e => patch({ provider: e.target.value as ImageProvider })}><option value="openai">OpenAI 兼容中转站</option><option value="nai">NovelAI (NAI)</option></select></label>
    <label className="block text-xs text-slate-500 space-y-2">API 地址<input className={inputStyle} value={form.baseUrl} placeholder={form.provider === 'nai' ? 'https://image.novelai.net' : 'https://your-relay.example/v1'} onChange={e => patch({ baseUrl: e.target.value })} /></label>
    <label className="block text-xs text-slate-500 space-y-2">API Key<input className={inputStyle} type="password" autoComplete="off" value={form.apiKey} onChange={e => patch({ apiKey: e.target.value })} /></label>
    <button type="button" disabled={loading || form.provider === 'nai'} onClick={fetchModels} className="rounded-2xl bg-[#ededed] text-[#222] px-4 py-3 text-xs disabled:opacity-50">{loading ? '拉取中...' : form.provider === 'nai' ? 'NAI 手动填写模型' : '拉取模型'}</button>
    {models.length > 0 && <select className={inputStyle} value={form.model} onChange={e => patch({ model: e.target.value })}><option value="">选择模型</option>{models.map(m => <option key={m} value={m}>{m}</option>)}</select>}
    <label className="block text-xs text-slate-500 space-y-2">模型名称<input className={inputStyle} value={form.model} placeholder={form.provider === 'nai' ? 'nai-diffusion-4-5-full' : '填写中转站模型 ID'} onChange={e => patch({ model: e.target.value })} /></label>
    <label className="block text-xs text-slate-500 space-y-2">全局正面提示词<textarea className={inputStyle} rows={3} value={form.positive} onChange={e => patch({ positive: e.target.value })} placeholder="画风、光影、画质等" /></label>
    <label className="block text-xs text-slate-500 space-y-2">全局负面提示词<textarea className={inputStyle} rows={3} value={form.negative} onChange={e => patch({ negative: e.target.value })} placeholder="不希望出现的元素" /></label>
    <div className="grid grid-cols-2 gap-3">{(['width','height'] as const).map(key => <label key={key} className="text-xs text-slate-500 space-y-2">{key === 'width' ? '宽度' : '高度'}<input className={inputStyle} type="number" min={64} max={2048} step={64} value={form[key]} onChange={e => patch({ [key]: Number(e.target.value) })} /></label>)}</div>
    <button className="w-full py-3 rounded-xl bg-slate-700 text-white text-sm" onClick={() => { try { saveImageSettings(form); setStatus('生图配置已保存到当前设备'); } catch { setStatus('保存失败，请检查浏览器存储权限'); } }}>保存生图 API</button>
    {status && <p role="status" className="text-xs text-slate-500">{status}</p>}
    <div className="border-t border-slate-100 pt-3 space-y-2"><h3 className="text-sm font-semibold">API 预设</h3><div className="flex gap-2"><input className={inputStyle} placeholder="预设名称" value={presetName} onChange={e => setPresetName(e.target.value)} /><button type="button" className="rounded-2xl bg-[#242424] text-white px-4 text-xs shrink-0" onClick={() => { if (!presetName.trim()) return; persist([...presets, { name: presetName.trim(), config: { ...form } }]); setPresetName(''); }}>保存预设</button></div>{presets.map((p,i) => <div key={i} className="flex gap-3 items-center text-xs"><span className="flex-1 truncate">{p.name}</span><button type="button" className="underline" onClick={() => { setForm(p.config); saveImageSettings(p.config); setStatus('已切换预设'); }}>使用</button><button type="button" className="text-rose-500 underline" onClick={() => persist(presets.filter((_,j) => j !== i))}>删除</button></div>)}</div>
    <p className="text-xs text-slate-400">API Key 仅保存在当前浏览器，请勿在公共设备填写。不同中转站的生图协议可能不同。</p>
    </div>}
  </section>;
};
export default ImageApiSettingsPanel;
