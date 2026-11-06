import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { activateUserSave, newUserSaveId, readUserSaves, renameUserSave, USER_SAVE_ID } from '../../utils/userSaves';
import { USER_SAVES_KEY } from '../../utils/userSaveScope';
import Modal from '../os/Modal';

export default function UserSaveSection() {
    const { userProfile, addToast } = useOS();
    const [registry, setRegistry] = useState(readUserSaves);
    useEffect(() => { const refresh = (event: StorageEvent) => { if (event.key === USER_SAVES_KEY) setRegistry(readUserSaves()); }; window.addEventListener('storage', refresh); return () => window.removeEventListener('storage', refresh); }, []);
    const [selected, setSelected] = useState(USER_SAVE_ID);
    const [dialog, setDialog] = useState<'create' | 'rename' | null>(null);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [error, setError] = useState('');
    const change = async (create = false) => {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        try {
            // Flush the profile form before taking the base-resource snapshot.
            await DB.saveUserProfile(userProfile);
            await activateUserSave(create ? newUserSaveId() : selected, create ? { name, profile: userProfile } : undefined);
        } catch (reason) {
            const message = reason instanceof Error ? reason.message : '身份切换失败，请重试';
            setError(message); addToast(message, 'error');
            busyRef.current = false; setBusy(false);
        }
    };
    const rename = () => {
        try { renameUserSave(USER_SAVE_ID, name); setRegistry(readUserSaves()); setDialog(null); setError(''); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '身份名称保存失败'); }
    };
    return <section aria-label="user 身份存档" className="mt-4 pt-4 border-t border-slate-100 text-left">
        <div className="flex items-center justify-between gap-2 mb-2">
            <label className="text-[11px] font-bold text-slate-400" htmlFor="user-save-select">身份存档</label>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <button disabled={busy} aria-label="重命名身份" onClick={() => { setName(registry.saves.find(save => save.id === USER_SAVE_ID)?.name || ''); setDialog('rename'); setError(''); }} className="py-1 disabled:opacity-40 hover:text-primary">重命名</button>
                <button disabled={busy} aria-label="新建身份" onClick={() => { setName(''); setDialog('create'); setError(''); }} className="py-1 font-bold text-primary disabled:opacity-40">新建</button>
            </div>
        </div>
        <div className="flex items-stretch gap-2">
            <select aria-label="当前身份" id="user-save-select" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)} className="flex-1 w-full min-w-0 bg-slate-50 border border-transparent focus:border-primary/30 rounded-2xl px-3 py-2.5 text-xs text-slate-600 outline-none">
                {registry.saves.map(save => <option key={save.id} value={save.id}>{save.name}{save.id === USER_SAVE_ID ? ' · 使用中' : ''}</option>)}
            </select>
            {selected !== USER_SAVE_ID && <button disabled={busy} onClick={() => void change()} className="shrink-0 px-4 py-2.5 rounded-2xl bg-primary text-white text-xs font-bold disabled:opacity-40">{busy ? '保存中…' : '切换身份'}</button>}
        </div>
        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">聊天、记忆和剧情各自保存，切换后继续对应故事。</p>
        {error && !dialog && <p role="alert" className="text-xs text-red-500 mt-2">{error}</p>}
        <Modal isOpen={dialog !== null} title={dialog === 'rename' ? '重命名身份' : '新建 user 身份'} onClose={() => { if (!busy) setDialog(null); }} footer={<>
            <button disabled={busy} onClick={() => setDialog(null)} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-500 text-sm font-bold">取消</button>
            <button disabled={busy || !name.trim()} onClick={() => dialog === 'rename' ? rename() : void change(true)} className="flex-1 py-3 rounded-2xl bg-primary text-white text-sm font-bold disabled:opacity-40">{busy ? '正在保存…' : dialog === 'rename' ? '保存名称' : '创建并切换'}</button>
        </>}>
            <label className="block text-xs font-bold text-slate-500 mb-2" htmlFor="new-user-save-name">身份名称</label>
            <input id="new-user-save-name" autoFocus maxLength={40} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="为这段新故事取个名字" className="w-full min-w-0 bg-slate-50 border border-slate-100 focus:border-primary/30 rounded-2xl px-4 py-3 text-sm outline-none" />
            <p className="text-[11px] text-slate-400 leading-relaxed mt-3">{dialog === 'rename' ? '只修改存档列表里的名称，人物资料和已有故事保持原样。' : '原身份的记录会保留。新身份保留已有角色、世界书和外观，互动记录从空白开始。'}</p>
            {error && <p role="alert" className="text-xs text-red-500 mt-3">{error}</p>}
        </Modal>
    </section>;
}
