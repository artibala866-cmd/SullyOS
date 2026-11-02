import React from 'react';
import type { ChatBlockState } from '../../types';

type Scene = NonNullable<ChatBlockState['forgivenessScenes']>[number];

/** 原版 withTheater 的独处片段：只显示独立判定的第三人称记录，不是聊天送达消息。
 * 旧一轮的独处片段也保留在这里，不能因再次拉黑而假装从未发生。
 */
const ChatForgivenessScene: React.FC<{ scenes: Scene[] }> = ({ scenes }) => {
  const latest = scenes[scenes.length - 1];
  if (!latest?.body) return null;
  return (
    <div className="mx-4 mb-4" data-forgiveness-theater="true">
      <details className="rounded-2xl border border-neutral-200/80 bg-white/85 text-neutral-600 shadow-sm">
        <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium">
          <span aria-hidden="true" className="mr-2">◌</span>
          独处小剧场{latest.title ? ` · ${latest.title}` : ''}
          {scenes.length > 1 ? <span className="ml-2 text-neutral-400">（共{scenes.length}段）</span> : null}
        </summary>
        <div className="max-h-72 space-y-4 overflow-y-auto border-t border-neutral-200/80 px-4 pb-3 pt-3">
          {[...scenes].reverse().map((scene, index) => (
            <div key={scene.blockedAt + ':' + scene.at + ':' + index}>
              {scenes.length > 1 ? (
                <p className="mb-1 text-[10px] text-neutral-400">
                  {new Date(scene.at).toLocaleString('zh-CN')} · {scene.title || '独处片段'}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-neutral-700">{scene.body}</p>
            </div>
          ))}
          <p className="text-[10px] leading-4 text-neutral-400">独处片段，不代表对方已发来消息</p>
        </div>
      </details>
    </div>
  );
};
export default React.memo(ChatForgivenessScene);
