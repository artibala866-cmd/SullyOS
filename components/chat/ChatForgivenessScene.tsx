import React from 'react';
import type { ChatBlockState } from '../../types';

type Scene = NonNullable<ChatBlockState['forgivenessScenes']>[number];

/** 原版 withTheater 的独处片段：来自角色独立心软判定，不是原账号发送成功的聊天消息。 */
const ChatForgivenessScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  if (!scene?.body) return null;
  return (
    <div className="mx-4 mb-4">
      <details className="rounded-2xl border border-neutral-200/80 bg-white/85 text-neutral-600 shadow-sm">
        <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium">
          <span aria-hidden="true" className="mr-2">◌</span>
          独处小剧场{scene.title ? ` · ${scene.title}` : ''}
        </summary>
        <div className="border-t border-neutral-200/80 px-4 pb-3 pt-3">
          <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-neutral-700">{scene.body}</p>
          <p className="mt-2 text-[10px] leading-4 text-neutral-400">独处片段，不代表对方已发来消息</p>
        </div>
      </details>
    </div>
  );
};
export default React.memo(ChatForgivenessScene);
