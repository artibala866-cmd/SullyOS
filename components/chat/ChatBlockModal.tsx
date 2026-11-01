import React, { useState } from 'react';
import type { ChatBlockState } from '../../types';
import { allowsCharacterToBlock, characterBlocksUser, userBlocksCharacter } from '../../utils/chatBlock';

export interface ChatBlockModalProps {
  characterName: string;
  state?: ChatBlockState;
  onClose: () => void;
  onSetUserBlock: (blocked: boolean) => void;
  onSetCharacterAllowed: (allowed: boolean) => void;
}

/** 仅是糯叽机两方向独立状态的设置入口；尚未实现 AI 剧情判定时不伪造角色自主决定。 */
const ChatBlockModal: React.FC<ChatBlockModalProps> = ({ characterName, state, onClose, onSetUserBlock, onSetCharacterAllowed }) => {
  const [confirming, setConfirming] = useState(false);
  const userBlocked = userBlocksCharacter(state);
  const charBlocked = characterBlocksUser(state);
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
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white p-3">
            <div>
              <div className="text-sm font-medium">你拉黑了 {characterName}</div>
              <p className="mt-1 text-xs text-neutral-500">{userBlocked ? '已拉黑' : '未拉黑'}</p>
            </div>
            <button type="button" aria-label={userBlocked ? '解除拉黑角色' : '拉黑角色'}
              onClick={() => userBlocked ? onSetUserBlock(false) : setConfirming(true)}
              className="rounded-full border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700">
              {userBlocked ? '解除拉黑' : '拉黑'}
            </button>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{characterName} 拉黑了你</span>
              <span className="text-xs text-neutral-500">{charBlocked ? '已拉黑' : '未拉黑'}</span>
            </div>
            <label className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-600">
              <span>允许角色自主拉黑我</span>
              <input type="checkbox" aria-label="允许角色自主拉黑我"
                checked={allowsCharacterToBlock(state)}
                onChange={e => onSetCharacterAllowed(e.target.checked)}
                className="h-4 w-4 accent-neutral-700"/>
            </label>
            <p className="mt-2 text-[11px] leading-4 text-neutral-400">
              角色自主拉黑与求原谅判断尚未接入；当前已保存权限和双方独立状态。
            </p>
          </div>
        </div>
        {confirming && (
          <div className="mt-4 rounded-2xl border border-neutral-300 bg-neutral-100 p-3">
            <p className="text-sm font-medium">确定拉黑 {characterName}？</p>
            <p className="mt-1 text-xs text-neutral-500">聊天记录会保留。可以随时解除拉黑。</p>
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
