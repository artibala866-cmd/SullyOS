import React, { useState } from 'react';
import type { CharacterProfile } from '../../types';
import Modal from '../os/Modal';
import { canCharBlockUser, isCharBlockingUser, isUserBlockingChar } from '../../utils/privateChatBlock';

interface Props {
  character: CharacterProfile;
  onClose: () => void;
  onBlockUser: () => void;
  onUnblockUser: () => void;
  onChangeCharPermission: (allowed: boolean) => void;
}
/** 同一角色的两条独立拉黑方向。自主判定和挽回剧情不在框架阶段伪造。 */
const PrivateChatBlockModal: React.FC<Props> = ({ character, onClose, onBlockUser, onUnblockUser, onChangeCharPermission }) => {
  const [confirming, setConfirming] = useState(false);
  const youBlocked = isUserBlockingChar(character);
  const charBlocked = isCharBlockingUser(character);
  const permitted = canCharBlockUser(character);
  return (
    <Modal isOpen={true} title="拉黑" onClose={onClose}>
      <section aria-label="私聊拉黑" className="space-y-4 text-sm">
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4 space-y-2">
          <div className="font-semibold text-neutral-800">你与{character.name}</div>
          <p className="text-xs leading-relaxed text-neutral-600">
            {youBlocked ? '你已拉黑对方。' : '你尚未拉黑对方。'}
            {charBlocked ? ' 对方已拉黑你。' : ''}
          </p>
          {youBlocked ? (
            <button type="button" onClick={() => { onUnblockUser(); setConfirming(false); }} className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 font-medium text-neutral-800">
              解除拉黑{character.name}
            </button>
          ) : confirming ? (
            <div className="space-y-2">
              <p className="text-xs text-neutral-600">确定要拉黑{character.name}吗？历史消息不会删除。</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2.5">取消</button>
                <button type="button" onClick={() => { onBlockUser(); setConfirming(false); }} className="flex-1 rounded-xl bg-neutral-800 px-3 py-2.5 text-white">确认拉黑</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 font-medium text-neutral-800">
              拉黑{character.name}
            </button>
          )}
        </div>
        <div className="rounded-2xl border border-neutral-200 px-4 py-4">
          <label className="flex items-center justify-between gap-3">
            <span className="flex-1"><span className="block font-medium text-neutral-800">允许角色拉黑我</span>
              <span className="mt-1 block text-xs leading-relaxed text-neutral-500">剧情走到底线时，角色可以决定拉黑；关闭许可会解除角色对你的拉黑。</span>
            </span>
            <input type="checkbox" aria-label="允许角色拉黑我" checked={permitted}
              onChange={event => onChangeCharPermission(event.target.checked)}
              className="h-5 w-5 accent-neutral-700" />
          </label>
          {charBlocked && <p className="mt-3 text-xs text-neutral-600">当前状态：对方已拉黑你。</p>}
        </div>
        <p className="text-xs leading-relaxed text-neutral-500">本阶段建立双向状态和设置入口；角色自主判断、拒收消息与求原谅等原版剧情链在下一阶段接入。</p>
      </section>
    </Modal>
  );
};
export default PrivateChatBlockModal;
