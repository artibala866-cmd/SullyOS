import React, { useEffect, useRef, useState } from 'react';
import { Headphones, X } from '@phosphor-icons/react';
import { C } from './MusicUI';

export type MusicTogetherPerson = {
  id: string;
  name: string;
  incoming: boolean;
  incomingMessageId?: number;
  trackName?: string;
  active: boolean;
  outgoing?: string;
};

type Props = {
  people: MusicTogetherPerson[];
  onClose: () => void;
  onAnswer: (charId: string, messageId: number, accept: boolean) => Promise<'resolved' | 'stale' | 'failed' | 'busy'>;
  onInvite: (charId: string) => void | Promise<boolean>;
  onCancel: (charId: string) => void | Promise<boolean>;
  onEnd: (charId: string) => void;
};

/** One shared, on-demand sheet. It is never repeated inside music tabs or the mini player. */
export const MusicTogetherSheet: React.FC<Props> = ({ people, onClose, onAnswer, onInvite, onCancel, onEnd }) => {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const workingRef = useRef(new Set<string>());
  const [working, setWorking] = useState<Record<string, 'invite' | 'cancel' | 'accept' | 'reject'>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const answerChar = (charId: string, inviteId: number | undefined, accepted: boolean) => {
    if (workingRef.current.has(charId)) return;
    if (!Number.isSafeInteger(inviteId)) {
      setAnswerErrors(prev => ({ ...prev, [charId]: '这条邀请已失效，请重新打开面板' }));
      return;
    }
    workingRef.current.add(charId);
    setAnswerErrors(prev => { const next = { ...prev }; delete next[charId]; return next; });
    setWorking(prev => ({ ...prev, [charId]: accepted ? 'accept' : 'reject' }));
    // Promise.resolve() also catches synchronous adapter errors; neither type
    // of failure may leave the accept/reject buttons permanently locked.
    void Promise.resolve().then(() => onAnswer(charId, inviteId!, accepted)).then(result => {
      if (result === 'failed') setAnswerErrors(prev => ({ ...prev, [charId]: '保存失败，请重试' }));
      else if (result === 'stale') setAnswerErrors(prev => ({ ...prev, [charId]: '邀请已过期或已在其他页面处理' }));
      else if (result === 'busy') setAnswerErrors(prev => ({ ...prev, [charId]: '正在处理，请稍后再试' }));
    }).catch(() => setAnswerErrors(prev => ({ ...prev, [charId]: '保存失败，请重试' })))
      .finally(() => {
        workingRef.current.delete(charId);
        setWorking(prev => { const next = { ...prev }; delete next[charId]; return next; });
      });
  };
  const runAction = (charId: string, kind: 'invite' | 'cancel', action: () => void | Promise<boolean>) => {
    if (workingRef.current.has(charId)) return;
    workingRef.current.add(charId);
    setWorking(prev => ({ ...prev, [charId]: kind }));
    try {
      void Promise.resolve(action()).catch(err =>
        console.warn('[MusicTogether] 操作失败', err)).finally(() => {
        workingRef.current.delete(charId);
        setWorking(prev => {
          const next = { ...prev };
          delete next[charId];
          return next;
        });
      });
    } catch (err) {
      console.warn('[MusicTogether] 操作失败', err);
      workingRef.current.delete(charId);
      setWorking(prev => {
        const next = { ...prev };
        delete next[charId];
        return next;
      });
    }
  };
  const sheetRef = useRef<HTMLElement | null>(null);
  // The host re-renders frequently (playback ticks). Keep one stable focus
  // guard and always call the latest close handler.
  const closeHandlerRef = useRef(onClose);
  closeHandlerRef.current = onClose;
  // Android/browser Back produces popstate. Keep one history entry per sheet
  // so Back dismisses the dialog instead of navigating out of Music.
  useEffect(() => {
    const marker = 'music-together-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    let pushed = false;
    try {
      window.history.pushState({ ...(window.history.state || {}), sullyMusicTogetherSheet: marker }, '', window.location.href);
      pushed = true;
    } catch { /* Restricted WebView: on-screen close and Escape still work. */ }
    const onBack = () => closeHandlerRef.current();
    window.addEventListener('popstate', onBack);
    return () => {
      window.removeEventListener('popstate', onBack);
      if (pushed && window.history.state?.sullyMusicTogetherSheet === marker) window.history.back();
    };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) || []);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeHandlerRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !sheetRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !sheetRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      // Keyboard navigation must never activate controls behind this dialog.
      if (event.target instanceof Node && !sheetRef.current?.contains(event.target)) {
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const incomingCount = people.filter(p => p.incoming).length;
  const listeningCount = people.filter(p => p.active).length;

  return <div className="absolute inset-0 z-[75] flex flex-col justify-end">
    <div aria-hidden="true" className="absolute inset-0 bg-black/25" onClick={onClose} />
    <section ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="music-together-title"
      className="relative flex flex-col min-h-0 w-full rounded-t-[26px] overflow-hidden music-panel-enter"
      style={{
        maxHeight: 'min(72dvh, 540px)',
        maxWidth: '100%',
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
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain shizuku-scrollbar px-3 sm:px-4 pb-4"
        style={{ borderTop: '1px solid #ecece9' }}>
        {!people.length && <div className="text-[12px] text-center py-12" style={{ color: C.muted }}>
          还没有可邀请的角色
        </div>}
        {people.map(p => {
          const action = p.active ? '结束' : p.outgoing === 'pending' ? '撤回' : '邀请';
          return <div key={p.id} className="flex items-center gap-2.5 min-w-0 px-2 py-3"
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
              {answerErrors[p.id] && <div role="status" className="text-[10px] mt-1 text-rose-600">{answerErrors[p.id]}</div>}
            </div>
            <div className="flex gap-1 shrink-0">
              {p.incoming ? <>
                <button type="button" aria-label={'接受 ' + p.name + ' 的一起听邀请'}
                  disabled={!!working[p.id]} aria-busy={!!working[p.id]}
                  className="music-tap min-h-11 min-w-11 px-3 rounded-full text-[12px] font-medium disabled:opacity-50"
                  style={{ background: C.primary, color: '#fff' }}
                  onClick={() => answerChar(p.id, p.incomingMessageId, true)}>{working[p.id] === 'accept' ? '接受中…' : '接受'}</button>
                <button type="button" aria-label={'拒绝 ' + p.name + ' 的一起听邀请'}
                  disabled={!!working[p.id]} aria-busy={!!working[p.id]}
                  className="music-tap min-h-11 min-w-11 px-3 rounded-full text-[12px] disabled:opacity-50"
                  style={{ background: '#e9e9e7', color: C.text }}
                  onClick={() => answerChar(p.id, p.incomingMessageId, false)}>{working[p.id] === 'reject' ? '拒绝中…' : '拒绝'}</button>
              </> : <button type="button" aria-label={action + '与 ' + p.name + ' 的一起听'}
                disabled={!!working[p.id]}
                aria-busy={!!working[p.id]}
                className="music-tap min-h-11 min-w-11 px-3 rounded-full text-[12px] font-medium disabled:opacity-60"
                style={{ background: p.active ? C.primary : '#e9e9e7', color: p.active ? '#fff' : C.text }}
                onClick={() => p.active ? onEnd(p.id) : p.outgoing === 'pending'
                  ? runAction(p.id, 'cancel', () => onCancel(p.id))
                  : runAction(p.id, 'invite', () => onInvite(p.id))}>
                {working[p.id] === 'invite' ? '邀请中…' : working[p.id] === 'cancel' ? '撤回中…' : action}
              </button>}
            </div>
          </div>;
        })}
      </div>
    </section>
  </div>;
};

export default MusicTogetherSheet;
