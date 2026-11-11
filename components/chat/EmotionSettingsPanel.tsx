import React from 'react';
import type { CharacterProfile, ApiPreset, APIConfig, CharacterBuff } from '../../types';
import { isEmotionBuffEnabled } from '../../utils/emotionFeature';

interface EmotionSettingsPanelProps {
    char: CharacterProfile;
    // 保留对现有调用方的参数兼容；专用情绪 API 已不再用于私聊。
    apiPresets: ApiPreset[];
    addApiPreset: (name: string, config: APIConfig) => void;
    onSave: (config: NonNullable<CharacterProfile['emotionConfig']>) => void;
    onClearBuffs: () => void;
    onToggle: (enabled: boolean) => void;
}

const dots = (value: number | null | undefined) => {
    const intensity = Math.max(1, Math.min(3, Math.round(Number(value) || 2)));
    return '●'.repeat(intensity) + '○'.repeat(3 - intensity);
};

const EmotionSettingsPanel: React.FC<EmotionSettingsPanelProps> = ({char, onClearBuffs, onToggle}) => {
    const enabled = isEmotionBuffEnabled(char);
    const buffs: CharacterBuff[] = char.activeBuffs || [];

    return (
        <div className="space-y-4">
            <div>
                <div className="text-xs font-bold text-slate-700 mb-1">🎭 情绪 Buff</div>
                <div className="text-[11px] text-slate-500 leading-relaxed space-y-1">
                    <p>与私聊回复共用同一次 API 调用，不再单独请求情绪评估模型，也不需要配置副 API。</p>
                    <p>关闭时不添加情绪生成指令、不发起情绪请求、不更新或显示 Buff；已保存的状态会保留，重新开启后继续使用。</p>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
                <div>
                    <span className="text-xs font-bold text-slate-700">情绪 Buff</span>
                    <p className="mt-1 text-[10px] text-slate-500">只随正常私聊生成，不额外扣一次 API 费用</p>
                </div>
                <button type="button" role="switch" aria-label="情绪 Buff" aria-checked={enabled}
                    onClick={() => onToggle(!enabled)}
                    className={`w-11 h-7 rounded-full p-1 flex items-center shrink-0 transition-colors ${enabled ? 'bg-primary' : 'bg-slate-300'}`}>
                    <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : ''}`} />
                </button>
            </div>

            {enabled && buffs.length > 0 ? (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">当前情绪状态</label>
                        <button type="button" onClick={onClearBuffs} className="text-xs text-slate-400 hover:text-neutral-400 transition-colors">清除</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {buffs.map(buff => (
                            <div key={buff.id}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold"
                                style={{
                                    backgroundColor: buff.color ? buff.color + '22' : '#fdf2f8',
                                    color: buff.color || '#646464',
                                    border: `1px solid ${buff.color ? buff.color + '55' : '#dcdcdc'}`,
                                }}>
                                {buff.emoji && <span>{buff.emoji}</span>}
                                <span>{buff.label}</span>
                                <span className="opacity-60">{dots(buff.intensity)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : enabled ? (
                <div className="text-xs text-slate-400 text-center py-2">暂无情绪状态 — 下次私聊回复时同步生成</div>
            ) : null}
        </div>
    );
};

export default React.memo(EmotionSettingsPanel);
