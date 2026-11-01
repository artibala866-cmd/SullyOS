import React, { useState } from 'react';
import type { ChatBlockState } from '../../types';
import { allowsCharacterToBlock, userBlocksCharacter } from '../../utils/chatBlock';

export interface ChatBlockModalProps {
  characterName: string;
  state?: ChatBlockState;
  onClose: () => void;
  onSetUserBlock: (blocked: boolean) => void;
  onSetCharacterAllowed: (allowed: boolean) => void;
}

/** 只展示用户自己的拉黑操作，绝不暴露角色是否偷偷拉黑用户。 */
const ChatBlockModal: React.FC<ChatBlockModalProps> = ({ characterName, state, onClose, onSetUserBlock, onSetCharacterAllowed }) => {
  const [confirming, setConfirming] = useState(false);
  const userBlocked = userBlocksCharacter(state);
  return (
    <div className="fixed inset-0 z-[280] flex items-end sm:items-center justify-center bg-black/40 px-3 pb-[max(12px,env(safe-area-inset-bottom))]"
      role="presentation" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="私聊拉黑" onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-[24px] bg-[#fafafa] p-5 text-[#303030] shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">拉黑</h2>
          <button type="button" aria-label="关闭拉黑设置" onClick={onClose}
            className="rounded-full px-2 py-1 text-lg text-neutral-500">×</button>
        </div>
        <p className="mt-1 text-xs leading-5 text-neutral-500">与 {characterName} 的私聊关系</p>
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-neutral-200 bg-white p-3">
          <div>
            <div className="text-sm font-medium">{userBlocked ? '解除拉黑' : '拉黑对方'}</div>
            <p className="mt-1 text-xs text-neutral-500">{characterName}</p>
          </div>
          <button type="button" aria-label={userBlocked ? '解除拉黑角色' : '拉黑角色'}
            onClick={() => userBlocked ? onSetUserBlock(false) : setConfirming(true)}
            className="rounded-full border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700">
            {userBlocked ? '解除拉黑' : '拉黑'}
          </button>
        </div>
        <details className="mt-3 rounded-xl border border-neutral-100 px-3 py-2 text-xs text-neutral-500">
          <summary className="cursor-pointer select-none">角色行为权限</summary>
          <label className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-600">
            <span>允许角色自主决定是否拉黑</span>
            <input type="checkbox" aria-label="允许角色自主拉黑我"
              checked={allowsCharacterToBlock(state)}
              onChange={e => onSetCharacterAllowed(e.target.checked)}
              className="h-4 w-4 accent-neutral-700"/>
          </label>
        </details>
        {confirming && (
          <div className="mt-4 rounded-2xl border border-neutral-300 bg-neutral-100 p-3">
            <p className="text-sm font-medium">确定拉黑 {characterName}？</p>
            <p className="mt-1 text-xs text-neutral-500">聊天记录会保留，你仍能发消息。对方的回复会显示发送失败。</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-2 text-xs">取消</button>
              <button type="button" onClick={() => { setConfirming(false); onSetUserBlock(true); }}
                className="rounded-lg bg-neutral-800 px-3 py-2 text-xs text-white">确认拉黑</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
export default ChatBlockModal;