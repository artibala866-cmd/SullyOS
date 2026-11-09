import React, { useState } from 'react';
import Modal from '../os/Modal';
import type { PrivateChatOpening } from '../../utils/privateChatOpening';

interface Props {
    openings: PrivateChatOpening[];
    onClose: () => void;
    onApply: (opening: PrivateChatOpening) => Promise<void>;
}

export default function PrivateChatOpeningModal({ openings, onClose, onApply }: Props) {
    const [selected, setSelected] = useState<PrivateChatOpening | null>(null);
    const [busy, setBusy] = useState(false);
    const close = () => { if (!busy) onClose(); };

    return <Modal isOpen title="私聊开场白" onClose={close}
        footer={<>
            <button type="button" onClick={close} disabled={busy}
                className="flex-1 rounded-2xl bg-neutral-100 py-3 text-sm font-semibold text-neutral-600 disabled:opacity-50">取消</button>
            <button type="button" disabled={!selected || busy} onClick={async () => {
                if (!selected || busy) return;
                setBusy(true);
                try { await onApply(selected); }
                finally { setBusy(false); }
            }} className="flex-1 rounded-2xl bg-neutral-800 py-3 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? '正在添加…' : '使用开场白'}
            </button>
        </>}>
        <div role="dialog" aria-label="私聊开场白">
            <p className="mb-3 text-xs leading-5 text-neutral-500">
                {openings.length ? '选一段开场白，按原剧情顺序加入当前私聊。'
                    : '这张角色卡暂未识别到私聊开场白。导入或更新角色卡时，勾选「开场白」即可识别卡内的手机对话。'}
            </p>
            <div role="group" aria-label="开场白列表" className="space-y-2">
                {openings.map(opening => <button key={opening.id} type="button" aria-pressed={selected === opening}
                    onClick={() => setSelected(opening)} disabled={busy}
                    className={`w-full min-w-0 rounded-2xl border p-3 text-left transition-colors ${selected === opening ? 'border-neutral-600 bg-neutral-50' : 'border-neutral-200 bg-white'}`}>
                    <span className="block break-words text-sm font-semibold text-neutral-800">{opening.title}</span>
                    <span className="mt-1 block text-xs text-neutral-500">{opening.lines.length} 条消息</span>
                </button>)}
            </div>
        </div>
    </Modal>;
}
