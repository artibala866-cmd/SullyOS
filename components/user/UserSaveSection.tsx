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
        void run(() => activateUserSave(newUserSaveId(), {name, profile:profileRef.current}));
    };
    const remove = () => {
        if (registry.saves.length < 2 || busyRef.current || disabled) return;
        if (!window.confirm(`删除「${userProfile.name || '当前身份'}」？角色和世界书会保留。`)) return;
        void run(deleteCurrentUserSave);
    };
    return <div className="mt-4" aria-label="user 身份存档" aria-busy={busy}>
        <div className="relative mb-1 h-5 flex items-center justify-center">
            <label htmlFor="archive-user-name" className="text-[11px] font-bold text-slate-400 tracking-widest">你的名字</label>
            <div className="absolute right-0 -top-1 flex items-center gap-0.5 text-slate-400">
                <button type="button" aria-label="新建身份" title="新建身份" disabled={busy || disabled} onClick={create} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-50 disabled:opacity-30">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path strokeLinecap="round" d="M12 5v14M5 12h14"/></svg>
                </button>
                <button type="button" aria-label="删除当前身份" title={registry.saves.length < 2 ? '至少保留一个身份' : '删除当前身份'} disabled={busy || disabled || registry.saves.length < 2} onClick={remove} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-50 disabled:opacity-30">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg>
                </button>
            </div>
        </div>
        <div className="relative">
            <input id="archive-user-name" aria-label="你的名字" disabled={busy || disabled} value={userProfile.name}
                onChange={event => { void updateUserProfile({name:event.target.value}).catch(error => addToast(error.message || '名字保存失败','error')); }}
                placeholder="点击输入名字" className="w-full bg-slate-50 focus:bg-white border border-transparent focus:border-primary/30 rounded-2xl px-10 py-3 text-xl font-bold text-slate-800 text-center outline-none transition-all placeholder:text-slate-300 placeholder:font-normal"/>
            <svg aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6"/></svg>
            <select id="user-save-select" aria-label="切换身份" title="切换身份" disabled={busy || disabled} value={USER_SAVE_ID}
                onChange={event => { const id=event.target.value; if(id!==USER_SAVE_ID) void run(()=>activateUserSave(id)); }}
                className="absolute right-0 top-0 bottom-0 w-10 h-full opacity-0 cursor-pointer">
                {registry.saves.map(save => <option key={save.id} value={save.id}>{save.id === USER_SAVE_ID ? userProfile.name || save.name : save.name}</option>)}
            </select>
        </div>
    </div>;
}
