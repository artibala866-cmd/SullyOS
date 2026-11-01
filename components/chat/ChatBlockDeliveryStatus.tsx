import React from 'react';
import type { Message } from '../../types';
import { privateChatDeliveryFailure } from '../../utils/chatBlock';

/** 原版消息发送状态：用户拉黑 Char 时，仅 Char 回复出现红色感叹号。 */
export default function ChatBlockDeliveryStatus({ message }: { message: Pick<Message, 'role' | 'metadata'> }) {
  const status = privateChatDeliveryFailure(message);
  if (!status) return null;
  const userRejected = status === 'user-rejected';
  const label = userRejected ? '消息已被对方拒收' : '对方未收到你的回复';
  return <div role="status"
    className={`flex items-center gap-1 pb-1 text-[11px] text-red-500 ${userRejected ? 'justify-end pr-4' : 'justify-start pl-12'}`}>
    <span aria-label="消息发送失败" title={label}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[11px] font-semibold text-white">!</span>
  </div>;
}
