import React from 'react';
import type { Message } from '../../types';
import { privateChatDeliveryFailure } from '../../utils/chatBlock';

/** 原版消息发送状态：用户拉黑 Char 时，仅 Char 回复出现红色感叹号。 */
export default function ChatBlockDeliveryStatus({ message, inlineSide }: { message: Pick<Message, 'role' | 'metadata'>; inlineSide?: 'left' | 'right' }) {
  const status = privateChatDeliveryFailure(message);
  if (!status) return null;
  const userRejected = status === 'user-rejected';
  const label = userRejected ? '消息已被对方拒收' : '角色的回复显示发送失败';
  // 普通消息外壳走旁侧小图标；历史独立卡片继续沿用默认渲染位置。
  if (inlineSide) return <span role="status" aria-label={label} title={label}
    data-chat-block-delivery={status}
    className={`sully-chat-block-failed absolute top-1/2 -translate-y-1/2 z-10 pointer-events-none inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#e34b49] text-[12px] font-semibold leading-none text-white ${inlineSide === 'left' ? '-left-5' : '-right-5'}`}>!</span>;
  return <div role="status"
    className={`flex items-center gap-1 pb-1 text-[11px] text-red-500 ${userRejected ? 'justify-end pr-4' : 'justify-start pl-12'}`}>
    <span aria-label="消息发送失败" title={label}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[11px] font-semibold text-white">!</span>
  </div>;
}
