import React, { useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { activateUserSave, newUserSaveId, readUserSaves, USER_SAVE_ID } from '../../utils/userSaves';
import Modal from '../os/Modal';

export default function UserSaveSection() {
    const { userProfile, addToast } = useOS();
    const [registry] = useState(readUserSaves);
    const [selected, setSelected] = useState(USER_SAVE_ID);
    const [creating, setCreating] = useState(false);
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
    return <section aria-label="user 身份存档" className="bg-white rounded-[1.75rem] shadow-[0_10px_30px_-12px_rgba(76,76,76,0.18)] border border-slate-100 p-5">
        <h2 className="text-sm font-bold text-slate-700">user 身份 · 独立存档</h2>
        <p className="text-[11px] text-slate-400 mt-1 mb-3 leading-relaxed">角色、世界书与界面外观共用；聊天、记忆宫殿和游玩进度分别保存。切换时会重新打开页面。</p>
        <label className="block text-[11px] font-bold text-slate-500 mb-2" htmlFor="user-save-select">当前身份</label>
        <select id="user-save-select" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)} className="w-full min-w-0 bg-slate-50 border border-slate-100 focus:border-primary/30 rounded-2xl px-3 py-3 text-sm text-slate-700 outline-none">
            {registry.saves.map(save => <option key={save.id} value={save.id}>{save.name}{save.id === USER_SAVE_ID ? ' · 使用中' : ''}</option>)}
        </select>
        <div className="flex gap-3 mt-3">
            <button disabled={busy} onClick={() => { setCreating(true); setError(''); }} className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-500 text-xs font-bold disabled:opacity-50">新建身份</button>
            <button disabled={busy || selected === USER_SAVE_ID} onClick={() => void change()} className="flex-1 py-2.5 rounded-2xl bg-primary text-white text-xs font-bold disabled:opacity-40">{busy ? '正在保存…' : '切换身份'}</button>
        </div>
        <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">目前备份按当前身份导出，请为各身份分别备份。</p>
        {error && <p role="alert" className="text-xs text-red-500 mt-3">{error}</p>}
        <Modal isOpen={creating} title="新建 user 身份" onClose={() => { if (!busy) setCreating(false); }} footer={<>
            <button disabled={busy} onClick={() => setCreating(false)} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-500 text-sm font-bold">取消</button>
            <button disabled={busy || !name.trim()} onClick={() => void change(true)} className="flex-1 py-3 rounded-2xl bg-primary text-white text-sm font-bold disabled:opacity-40">{busy ? '正在保存…' : '创建并切换'}</button>
        </>}>
            <label className="block text-xs font-bold text-slate-500 mb-2" htmlFor="new-user-save-name">身份名称</label>
            <input id="new-user-save-name" autoFocus maxLength={40} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="为这段新故事取个名字" className="w-full min-w-0 bg-slate-50 border border-slate-100 focus:border-primary/30 rounded-2xl px-4 py-3 text-sm outline-none" />
            <p className="text-[11px] text-slate-400 leading-relaxed mt-3">原身份的记录会保留。新身份保留已有角色、世界书和外观，互动记录从空白开始；名字和设定可在档案中分别修改。</p>
            {error && <p role="alert" className="text-xs text-red-500 mt-3">{error}</p>}
        </Modal>
    </section>;
}
