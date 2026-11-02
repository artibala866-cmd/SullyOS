import React from 'react';
import {
  DEFAULT_REAL_PERSON_REPLY_RHYTHM, MAX_REAL_PERSON_REPLY_SECONDS,
  normalizeRealPersonReplyRhythm, type RealPersonAttention, type RealPersonReplyRhythm,
} from '../../utils/realPersonReplyRhythm';

type Props = {
  value?: Partial<RealPersonReplyRhythm>;
  onChange: (next: RealPersonReplyRhythm) => void;
};
const FIELDS: readonly { state: RealPersonAttention; title: string; detail: string }[] = [
  { state:'normal', title:'普通接话', detail:'不在连续聊天时' },
  { state:'conversation', title:'连续聊天', detail:'双方刚刚来回接话' },
  { state:'occupied', title:'忙碌中', detail:'日程确有工作或其他占用' },
  { state:'waiting', title:'正在等你', detail:'刚回过你，仍在聊天' },
];

/** Edits existing CharacterProfile only. No new scheduler or API call. */
export default function RealPersonRhythmSettings({ value, onChange }: Props) {
  const ranges = normalizeRealPersonReplyRhythm(value);
  const change = (state: RealPersonAttention, which: 'minSeconds'|'maxSeconds', raw: string) => {
    const number = Number(raw);
    if (!Number.isSafeInteger(number) || number < 1 || number > MAX_REAL_PERSON_REPLY_SECONDS) return;
    const previous = ranges[state];
    const minSeconds = which === 'minSeconds' ? Math.min(number, previous.maxSeconds) : previous.minSeconds;
    const maxSeconds = which === 'maxSeconds' ? Math.max(number, previous.minSeconds) : previous.maxSeconds;
    onChange({ ...ranges, [state]:{ minSeconds, maxSeconds } });
  };
  return (
    <section className="space-y-2">
      <div className="text-xs text-neutral-700 font-medium">角色接话状态（按真实对话和日程判断）</div>
      <p className="text-[11px] text-neutral-500 leading-relaxed">
        真人感现在由你真正发出的消息、连续对话的注意力、输入是否结束和角色日程决定是否接话；不再等下面的随机秒数倒计时。旧版自定义秒数保留在角色资料中，不再参与触发，也不影响主动消息、音乐或日程。
      </p>
      <div className="space-y-2">
        {FIELDS.map(({state,title,detail})=>(
          <div key={state} className="flex items-center gap-2 rounded-xl border border-neutral-200 p-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-neutral-700">{title}</div>
              <div className="text-[10px] text-neutral-400">{detail}</div>
            </div>
            <input type="number" aria-label={title+'最短秒数'} value={ranges[state].minSeconds}
              disabled title="旧版倒计时参数已停用，保留原有保存数据"
              min={1} max={MAX_REAL_PERSON_REPLY_SECONDS} step={1}
              className="w-14 rounded-lg border border-neutral-200 bg-white px-1.5 py-1.5 text-xs text-neutral-700"
              onChange={e=>change(state,'minSeconds',e.target.value)} />
            <span className="text-neutral-400 text-xs">–</span>
            <input type="number" aria-label={title+'最长秒数'} value={ranges[state].maxSeconds}
              min={1} max={MAX_REAL_PERSON_REPLY_SECONDS} step={1}
              className="w-14 rounded-lg border border-neutral-200 bg-white px-1.5 py-1.5 text-xs text-neutral-700"
              onChange={e=>change(state,'maxSeconds',e.target.value)} />
          </div>
        ))}
      </div>
      <button type="button" disabled title="旧版计时参数保留，不再控制真人感自动接话" onClick={()=>onChange(normalizeRealPersonReplyRhythm(DEFAULT_REAL_PERSON_REPLY_RHYTHM))}
        className="text-xs text-neutral-500 underline underline-offset-2">旧版倒计时设置已停用</button>
      <p className="text-[10px] text-neutral-500">实际日程显示睡眠或忙碌时，会等待角色恢复可回应状态；你还在编辑时不会抢话。没有日程时不会凭时钟猜测角色在忙。</p>
    </section>
  );
}
