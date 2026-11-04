import React, {useEffect, useState} from 'react';
import {Question} from '@phosphor-icons/react';
import {IMAGE_PERMISSION_CHANGED, imagePermission, setImagePermission, type ImageScope} from '../../utils/automaticImage';

export default function AutomaticImageToggle({scope, id}: {scope: ImageScope; id: string}) {
    const [enabled, setEnabled] = useState(() => !!imagePermission(scope, id));
    const [error, setError] = useState(false);
    const [showGroupHelp, setShowGroupHelp] = useState(false);

    useEffect(() => {
        const sync = () => setEnabled(!!imagePermission(scope, id));
        sync();
        window.addEventListener(IMAGE_PERMISSION_CHANGED, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(IMAGE_PERMISSION_CHANGED, sync);
            window.removeEventListener('storage', sync);
        };
    }, [scope, id]);

    const label = scope === 'moments' ? '朋友圈生图' : '角色主动生图';
    const description = scope === 'moments'
        ? '开启后，适合配图的动态可调用生图 API。'
        : '开启后，角色才有机会随回复发图。';
    const onChange = (next: boolean) => {
        try {
            setImagePermission(scope, id, next);
            setEnabled(next);
            setError(false);
        } catch {
            setError(true);
        }
    };
    const errorMessage = error && <p role="alert" className="mt-1 text-xs text-red-700">生图开关保存失败</p>;

    // Match the translation / voice switches immediately below this control in private chat.
    if (scope === 'private') {
        return <div className="pt-2 border-t border-slate-100">
            <button type="button" role="switch" aria-checked={enabled} onClick={() => onChange(!enabled)}
                className="flex w-full justify-between items-center cursor-pointer text-left">
                <span className="text-xs font-bold text-slate-400 uppercase">{label}</span>
                <span aria-hidden="true" className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${enabled ? 'bg-neutral-400' : 'bg-slate-200'}`}>
                    <span className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${enabled ? 'translate-x-4' : ''}`}></span>
                </span>
            </button>
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{description}</p>
            {errorMessage}
        </div>;
    }

    // Match the checkbox rows and "?" help buttons in ChatInputSettings.
    if (scope === 'group') {
        return <div className="space-y-1">
            <div className="flex items-center gap-1">
                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 text-xs font-bold text-slate-600">
                    <span>{label}</span>
                    <input type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked)}
                        className="h-5 w-5 shrink-0 cursor-pointer accent-primary"/>
                </label>
                <button type="button" aria-label={`${label}说明`} aria-expanded={showGroupHelp}
                    aria-controls={`group-image-help-${id}`} onClick={() => setShowGroupHelp(open => !open)}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 ${showGroupHelp ? 'text-primary' : 'text-slate-400'}`}>
                    <Question size={18} weight="bold"/>
                </button>
            </div>
            <p id={`group-image-help-${id}`} hidden={!showGroupHelp}
                className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">{description}</p>
            {errorMessage}
        </div>;
    }

    // Match the native checkbox-and-description cards in CharacterPhone settings.
    return <div>
        <label className="flex items-center justify-between gap-4 rounded-2xl bg-white px-4 py-4 text-sm">
            <span className="min-w-0 space-y-1">
                <span className="block font-semibold text-[#222]">{label}</span>
                <span className="block text-xs leading-5 text-[#777]">{description}</span>
            </span>
            <input type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked)}
                className="h-5 w-5 shrink-0 cursor-pointer accent-[#444]"/>
        </label>
        {errorMessage}
    </div>;
}
