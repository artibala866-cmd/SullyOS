import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { activateUserSave, deleteCurrentUserSave, newUserSaveId, readUserSaves, renameUserSave, USER_SAVE_ID } from '../../utils/userSaves';
import { USER_SAVES_KEY } from '../../utils/userSaveScope';

/** The editable name is the identity picker. No second identity form or
 * separate switch/rename controls: choosing an entry activates it directly. */
export default function UserSaveSection({disabled = false, onBusyChange}: {disabled?: boolean; onBusyChange?: (value: boolean) => void}) {
    const { userProfile, updateUserProfile, addToast } = useOS();
    const [registry, setRegistry] = useState(readUserSaves);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const profileRef = useRef(userProfile);
    profileRef.current = userProfile;
    useEffect(() => {
        const refresh = (event: StorageEvent) => { if (event.key === USER_SAVES_KEY) setRegistry(readUserSaves()); };
        window.addEventListener('storage', refresh);
        return () => window.removeEventListener('storage', refresh);
    }, []);
    // Use the actual editable profile name in the picker, including identities
    // created by earlier releases whose list label was a separate field.
    useEffect(() => {
        const name = userProfile.name.trim().slice(0,40);
        if (!name || busyRef.current) return;
        const latest = readUserSaves();
        if (latest.activeId !== USER_SAVE_ID || latest.saves.find(save => save.id === USER_SAVE_ID)?.name === name) return;
        try { renameUserSave(USER_SAVE_ID, name); setRegistry(readUserSaves()); }
        catch { /* A running backup owns the index; switching retries with the latest name. */ }
    }, [userProfile.name]);
    const run = async (action: () => Promise<void>) => {
        if (busyRef.current || disabled) return;
        busyRef.current = true; setBusy(true); onBusyChange?.(true);
        try {
            await DB.saveUserProfile(profileRef.current);
            const label = profileRef.current.name.trim().slice(0,40);
            if (label && readUserSaves().saves.find(save => save.id === USER_SAVE_ID)?.name !== label) renameUserSave(USER_SAVE_ID, label);
            await action();
        } catch (error) {
            addToast(error instanceof Error ? error.message : '身份保存失败，请重试', 'error');
            busyRef.current = false; setBusy(false); onBusyChange?.(false);
        }
    };
    const create = () => {
        const used = new Set(readUserSaves().saves.map(save => save.name));
        let name = '新身份', index = 2;
        while (used.has(name)) name = `新身份 ${index++}`;
        void run(() => activateUserSave(newUserSaveId(), {name}));
    };
    const remove = () => {
        if (registry.saves.length < 2 || busyRef.current || disabled) return;
        if (!window.confirm(`移除「${userProfile.name || '当前身份'}」？本机存档会保留，可在身份列表中恢复。`)) return;
        void run(deleteCurrentUserSave);
    };
    const labels = registry.saves.map(save => {
        const name = save.id === USER_SAVE_ID ? userProfile.name.trim() || save.name : save.name;
        return save.restored ? `${name} · 副本` : name;
    });
    return <div className="mt-4" aria-label="user 身份存档" aria-busy={busy}>
        <div className="relative mb-1 h-8 flex items-center justify-center">
            <label htmlFor="archive-user-name" className="text-[11px] font-bold text-slate-400 tracking-widest" aria-live="polite">{busy ? '切换中…' : '你的名字'}</label>
            <div className="absolute -right-1 -top-1 flex items-center gap-0.5 text-slate-400">
                <button type="button" aria-label="新建身份" title="新建身份" disabled={busy || disabled} onClick={create} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50 active:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/30 disabled:opacity-30 transition-colors touch-manipulation">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path strokeLinecap="round" d="M12 5v14M5 12h14"/></svg>
                </button>
                <button type="button" aria-label="删除当前身份" title={registry.saves.length < 2 ? '至少保留一个身份' : '删除当前身份'} disabled={busy || disabled || registry.saves.length < 2} onClick={remove} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50 active:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/30 disabled:opacity-30 transition-colors touch-manipulation">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg>
                </button>
            </div>
        </div>
        <div className="relative group">
            <input id="archive-user-name" aria-label="你的名字" disabled={busy || disabled} value={userProfile.name}
                onChange={event => { void updateUserProfile({name:event.target.value}).catch(error => addToast(error.message || '名字保存失败','error')); }}
                placeholder="点击输入名字" className="w-full bg-slate-50 focus:bg-white border border-transparent focus:border-primary/30 rounded-2xl px-14 py-3 text-xl font-bold text-slate-800 text-center outline-none transition-all placeholder:text-slate-300 placeholder:font-normal"/>
            <span aria-hidden="true" className="absolute right-0 top-1 bottom-1 w-14 rounded-r-xl border-l border-slate-200/50 flex items-center justify-center text-slate-400 group-focus-within:text-slate-600 pointer-events-none">
                {busy ? <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" className="opacity-20"/><path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round"/></svg> : <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6"/></svg>}
            </span>
            <select id="user-save-select" aria-label="切换身份" title="切换身份" disabled={busy || disabled} value={USER_SAVE_ID}
                onChange={event => { const id=event.target.value; if(id!==USER_SAVE_ID) void run(()=>activateUserSave(id, undefined, {restore: !!registry.deletedSaves?.some(save => save.id === id)})); }}
                className="absolute right-0 top-0 bottom-0 w-14 h-full opacity-0 cursor-pointer touch-manipulation">
                {registry.saves.map((save, index) => {
                    const label = labels[index];
                    const number = labels.filter(value => value === label).length > 1
                        ? ` · ${labels.slice(0, index + 1).filter(value => value === label).length}` : '';
                    return <option key={save.id} value={save.id}>{label}{number}{save.id === USER_SAVE_ID ? ' · 当前' : ''}</option>;
                })}
                {!!registry.deletedSaves?.length && <optgroup label="恢复本机保留的身份">
                    {registry.deletedSaves.map(save => <option key={save.id} value={save.id}>恢复：{save.name}</option>)}
                </optgroup>}
            </select>
        </div>
    </div>;
}
