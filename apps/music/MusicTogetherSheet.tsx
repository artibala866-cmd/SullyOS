import React, { useEffect, useRef } from 'react';
import { Headphones, X } from '@phosphor-icons/react';
import { C } from './MusicUI';

export type MusicTogetherPerson = {
  id: string;
  name: string;
  incoming: boolean;
  trackName?: string;
  active: boolean;
  outgoing?: string;
};

type Props = {
  people: MusicTogetherPerson[];
  onClose: () => void;
  onAnswer: (charId: string, accept: boolean) => void;
  onInvite: (charId: string) => void;
  onCancel: (charId: string) => void;
  onEnd: (charId: string) => void;
};

/** One shared, on-demand sheet. It is never repeated inside music tabs or the mini player. */
export const MusicTogetherSheet: React.FC<Props> = ({ people, onClose, onAnswer, onInvite, onCancel, onEnd }) => {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const incomingCount = people.filter(p => p.incoming).length;
  const listeningCount = people.filter(p => p.active).length;

  return <div className="absolute inset-0 z-[75] flex flex-col justify-end"
    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <button type="button" className="absolute inset-0 bg-black/25"
      aria-label="关闭一起听" onClick={onClose} />
    <section role="dialog" aria-modal="true" aria-labelledby="music-together-title"
      className="relative flex flex-col min-h-0 w-full rounded-t-[26px] overflow-hidden music-panel-enter"
      style={{
        maxHeight: 'min(70dvh, 540px)',
        background: C.bg,
        boxShadow: '0 -10px 36px rgba(0,0,0,.11)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
      <div className="w-9 h-1 rounded-full self-center mt-2.5 mb-2 shrink-0" style={{ background: '#d5d5d2' }} />
      <div className="flex items-center justify-between px-5 pt-1 pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Headphones size={19} weight="regular" aria-hidden="true" />
          <div>
            <h2 id="music-together-title" className="text-[15px] font-semibold" style={{ color: C.text }}>一起听</h2>
            <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>
              {incomingCount ? '有 ' + incomingCount + ' 条待回应邀请'
                : listeningCount ? '正在与 ' + listeningCount + ' 位角色听歌' : '选择角色发起邀请'}
            </p>
          </div>
        </div>
        <button ref={closeRef} type="button" aria-label="关闭一起听面板" onClick={onClose}
          className="music-icon-press w-11 h-11 rounded-full flex items-center justify-center"
          style={{ color: C.text }}><X size={20} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain shizuku-scrollbar px-4 pb-4"
        style={{ borderTop: '1px solid #ecece9' }}>
        {!people.length && <div className="text-[12px] text-center py-12" style={{ color: C.muted }}>
          还没有可邀请的角色
        </div>}
        {people.map(p => {
          const action = p.active ? '结束' : p.outgoing === 'pending' ? '撤回' : '邀请';
          return <div key={p.id} className="flex items-center gap-3 min-w-0 px-2 py-3"
            style={{ borderBottom: '1px solid #eeecea' }}>
            <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-[13px] font-medium"
              style={{ background: '#e9e9e7', color: C.text }}>{p.name.slice(0, 1)}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate" style={{ color: C.text }}>{p.name}</div>
              <div className="text-[11px] mt-0.5 truncate" style={{ color: C.muted }}>
                {p.incoming
                  ? (p.trackName ? '邀请你听《' + p.trackName + '》' : '邀请你一起听')
                  : p.active ? '一起听中'
                    : p.outgoing === 'pending' ? '等待回应'
                    : p.outgoing === 'rejected' ? '上次邀请已拒绝' : '可邀请'}
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {p.incoming ? <>
                <button type="button" aria-label={'接受 ' + p.name + ' 的一起听邀请'}
                  className="music-tap min-h-11 min-w-11 px-3 rounded-full text-[12px] font-medium"
                  style={{ background: C.primary, color: '#fff' }}
                  onClick={() => onAnswer(p.id, true)}>接受</button>
                <button type="button" aria-label={'拒绝 ' + p.name + ' 的一起听邀请'}
                  className="music-tap min-h-11 min-w-11 px-3 rounded-full text-[12px]"
                  style={{ background: '#e9e9e7', color: C.text }}
                  onClick={() => onAnswer(p.id, false)}>拒绝</button>
              </> : <button type="button" aria-label={action + '与 ' + p.name + ' 的一起听'}
                className="music-tap min-h-11 min-w-11 px-3 rounded-full text-[12px] font-medium"
                style={{ background: p.active ? C.primary : '#e9e9e7', color: p.active ? '#fff' : C.text }}
                onClick={() => p.active ? onEnd(p.id) : p.outgoing === 'pending' ? onCancel(p.id) : onInvite(p.id)}>
                {action}
              </button>}
            </div>
          </div>;
        })}
      </div>
    </section>
  </div>;
};

export default MusicTogetherSheet;
