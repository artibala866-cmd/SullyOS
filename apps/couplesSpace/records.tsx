import React, { useState } from 'react';
import type { Bond, Entry, EntryKind, Side } from '../../utils/couplesSpace';
import { capsuleDate, capsuleStatus, createEntry } from '../../utils/couplesSpace';
import { processImage } from '../../utils/file';
import { useLocalDateKey } from '../../hooks/useLocalDateKey';
import TokenImg from '../../components/os/TokenImg';

export const recordNames: Record<EntryKind, string> = {
  timeline: '牵绊时光', anniversary: '纪念日', diary: '交换日记', wish: '愿望清单',
  gift: '礼物图鉴', mail: '时光信箱', capsule: '时间胶囊', hollow: '树洞',
};
export type ChangeBond = (update: (bond: Bond) => Bond) => Promise<void>;
export type Generate = (instruction: string) => Promise<string>;

export function BondRecords({ kind, bond, names, change, generate, share, busy }: {
  kind: EntryKind; bond: Bond; names: Record<Side, string>; change: ChangeBond;
  generate: Generate; share?: (content: string, label?: string) => Promise<void>; busy: boolean;
}) {
  const [draft, setDraft] = useState<Entry>();
  const [filter, setFilter] = useState('all');
  const [earlyId, setEarlyId] = useState<string>();
  const today = useLocalDateKey();
  const capsules = bond.entries.filter(item => item.kind === 'capsule');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const run = async (task: () => Promise<void>) => {
    setWorking(true);
    setError('');
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setWorking(false); }
  };
  const save = async (entry: Entry) => {
    await change(current => ({
      ...current,
      entries: current.entries.some(item => item.id === entry.id)
        ? current.entries.map(item => item.id === entry.id ? entry : item)
        : [...current.entries, entry],
    }));
  };
  const rows = bond.entries.filter(item => item.kind === kind)
    .filter(item => filter === 'all' || (kind === 'capsule' ? capsuleStatus(item, today) === filter : filter === 'pending' ? !item.reply : item.side === filter))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date));
  const roleInstruction = {
    timeline: '根据实际可见的关系记录写一段时间轴回忆，采用「标题」和正文两行格式；若没有明确事件，就写当前感受，不虚构过去。',
    anniversary: '从资料里找一个确知日期的纪念事件，用「YYYY-MM-DD｜标题」作为首行并补充正文。没有确知日期则只回复「没有明确日期」。',
    diary: `用第一人称写一篇今天的日记，兼顾你的生活和这段关系。风格偏好：${bond.diaryStyle || '随角色自身表达习惯'}。`,
    wish: '写一个你真的想和对方完成的愿望，标题一行、原因一段。',
    gift: '写你想送给对方的一件礼物，首行是礼物名，正文是想送它的原因。',
    mail: '提出一个与你们关系有关的开放问题，第二行写你自己的回答。',
    capsule: '写一封寄给未来的短信，结合已有经历和你对未来的期待。',
    hollow: '写下最近不方便当面说的一点真实心事。心事来自你的性格和已有经历。',
  }[kind];
  const newEntry = () => ({ ...createEntry(kind, '', ''), unlockDate: kind === 'capsule' ? capsuleDate(1) : undefined });
  const generated = async () => {
    const content = await generate(roleInstruction);
    const [first, ...rest] = content.split('\n').filter(line => line.trim());
    const entry = { ...newEntry(), side: 'them' as const };
    if (kind === 'anniversary') {
      const match = first?.match(/^(\d{4}-\d{2}-\d{2})\s*[｜|]\s*(.+)$/);
      if (!match || !Number.isFinite(Date.parse(match[1]))) throw new Error('目前没有找到日期明确的纪念事件');
      await save({ ...entry, date: match[1], title: match[2], body: rest.join('\n') });
      return;
    }
    if (kind === 'diary' || kind === 'capsule' || kind === 'hollow') {
      await save({ ...entry, title: kind === 'diary' ? '今日记事' : recordNames[kind], body: content });
      return;
    }
    await save({ ...entry, title: first, body: rest.join('\n') });
  };
  const openCapsule = (id: string, allowEarly: boolean) => void run(async () => {
    await change(current => ({
      ...current, entries: current.entries.map(item => {
        if (item.id !== id || item.kind !== 'capsule') return item;
        const state = capsuleStatus(item);
        if (state === 'opened' || (state === 'sealed' && !allowEarly)) return item;
        return { ...item, opened: true, openedEarly: state === 'sealed' };
      }),
    }));
    setEarlyId(undefined);
  });
  const patch = (updates: Partial<Entry>) => setDraft(current => current ? { ...current, ...updates } : current);
  return <>
    <div className="couple-actions">
      <button disabled={working || busy} onClick={() => setDraft(newEntry())}>{kind === 'capsule' ? '写信并封存' : '新增记录'}</button>
      <button disabled={working || busy} onClick={() => void run(generated)}>{working || busy ? '处理中…' : `请 ${names.them} 写`}</button>
      {kind === 'hollow' && <button disabled={!rows.length} onClick={() => {
        const row = rows[Math.floor(Math.random() * rows.length)];
        document.getElementById(`bond-entry-${row.id}`)?.scrollIntoView({ block: 'center' });
      }}>摇一摇</button>}
    </div>
    {kind === 'diary' && <div className="couple-card">
      <label><input type="checkbox" checked={!!bond.diaryAuto} onChange={event => {
        const diaryAuto = event.target.checked;
        void run(() => change(current => ({ ...current, diaryAuto })));
      }} /> 每日角色日记（有新对话时）</label>
      <label><input type="checkbox" checked={!!bond.diaryContext} onChange={event => {
        const diaryContext = event.target.checked;
        void run(() => change(current => ({ ...current, diaryContext })));
      }} /> 在私聊中回顾日记</label>
      <label>角色写作风格<input key={bond.id} defaultValue={bond.diaryStyle} onBlur={event => {
        const diaryStyle = event.target.value.trim();
        if (diaryStyle !== (bond.diaryStyle ?? '')) void run(() => change(current => ({ ...current, diaryStyle })));
      }} /></label>
    </div>}
    {kind === 'capsule' && <nav className="couple-segments" aria-label="胶囊状态">
      {([['all', '全部'], ['sealed', '封存中'], ['ready', '可拆封'], ['opened', '已拆封']] as const).map(([id, label]) =>
        <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
          {label}{id === 'ready' ? ` ${capsules.filter(item => capsuleStatus(item, today) === 'ready').length}` : ''}
        </button>)}
    </nav>}
    {(kind === 'diary' || kind === 'mail') && <div className="couple-actions">
      <select aria-label="筛选记录" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">全部</option><option value="me">{names.me}</option><option value="them">{names.them}</option>
        {kind === 'mail' && <option value="pending">待回信</option>}
      </select>
    </div>}
    {kind === 'hollow' && <div className="couple-card"><label>
      <input type="checkbox" checked={!!bond.hollowAuto} disabled={working} onChange={event => {
        const hollowAuto = event.target.checked;
        void run(() => change(current => ({ ...current, hollowAuto })));
      }} /> 允许角色在私聊后悄悄留下心事
    </label></div>}
    {error && <p role="alert" className="couple-error">{error}</p>}
    {draft && <form className="couple-card" onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        const title = draft.title.trim();
        if (!title) return;
        const record = { ...draft, title, body: draft.body.trim() };
        await save(record);
        setDraft(undefined);
      });
    }}>
      <label>{kind === 'mail' ? '问题' : '标题'}<input required value={draft.title} onChange={event => patch({ title: event.target.value })} maxLength={140} /></label>
      <label>日期<input type="date" required value={draft.date} onChange={event => patch({ date: event.target.value })} /></label>
      <label>来自<select value={draft.side} onChange={event => patch({ side: event.target.value as Side })}>
        <option value="me">{names.me}</option><option value="them">{names.them}</option>
      </select></label>
      <label>{kind === 'mail' ? '写信人的回答' : '内容'}<textarea value={draft.body} onChange={event => patch({ body: event.target.value })} maxLength={10000} /></label>
      {kind === 'wish' && <label>小目标（每行一个）<textarea value={draft.steps?.map(step => step.text).join('\n') ?? ''} onChange={event => {
        const steps = event.target.value.split('\n').map(text => ({ text, done: draft.steps?.find(step => step.text === text)?.done ?? false }));
        patch({ steps });
      }} /></label>}
      {kind === 'capsule' && !draft.opened && <>
        <label>开启日期<input required type="date" min={today} value={draft.unlockDate ?? ''} onChange={event => patch({ unlockDate: event.target.value })} /></label>
        <div className="couple-segments" aria-label="快捷开启日期">
          {([[1, '一个月'], [6, '半年'], [12, '一年']] as const).map(([months, label]) =>
            <button key={months} type="button" onClick={() => patch({ unlockDate: capsuleDate(months) })}>{label}</button>)}
        </div>
      </>}
      {kind === 'diary' && <label>贴纸<input placeholder="例如 ♡ ✦ ☘" value={draft.stickers?.join(' ') ?? ''} onChange={event => patch({ stickers: event.target.value.split(' ').slice(0, 16) })} /></label>}
      {kind === 'gift' && <label>礼物照片<input type="file" accept="image/*" disabled={working} onChange={event => {
        const file = event.target.files?.[0];
        if (file) void run(async () => patch({ image: await processImage(file, { maxWidth: 720 }) }));
      }} /></label>}
      <div className="couple-actions"><button disabled={working}>保存</button><button type="button" onClick={() => setDraft(undefined)}>取消</button></div>
    </form>}
    {!rows.length && <p className="couple-muted">这里还没有记录。</p>}
    {rows.map(item => {
      const state = kind === 'capsule' ? capsuleStatus(item, today) : undefined;
      const sealed = state === 'ready' || state === 'sealed';
      return <article className="couple-card" key={item.id} id={`bond-entry-${item.id}`}>
        <small>{item.date} · {names[item.side]}{item.pinned ? ' · 置顶' : ''}</small>
        <h3>{item.title}</h3>
        {state && <span className="couple-status" data-state={state}>
          {state === 'ready' ? '可以拆封' : state === 'sealed' ? '封存中' : item.openedEarly ? '提前拆封' : '已拆封'}
        </span>}
        {sealed ? <>
          <p>{item.unlockDate} 开启</p>
          {earlyId === item.id ? <div className="couple-inline-confirm">
            <p>现在打开会记为提前拆封。</p>
            <div className="couple-actions"><button disabled={working} className="couple-primary" onClick={() => openCapsule(item.id, true)}>确认提前拆封</button>
              <button onClick={() => setEarlyId(undefined)}>继续封存</button></div>
          </div> : <div className="couple-actions">
            <button className={state === 'ready' ? 'couple-primary' : undefined} disabled={working}
              onClick={() => state === 'ready' ? openCapsule(item.id, false) : setEarlyId(item.id)}>
              {state === 'ready' ? '拆封' : '提前拆封'}
            </button>
            <button disabled={working} onClick={() => {
              if (window.confirm('删除这封尚未拆开的信？')) void run(() => change(current => ({ ...current, entries: current.entries.filter(row => row.id !== item.id) })));
            }}>删除</button>
          </div>}
        </> : <>
          {item.image && <TokenImg value={item.image} alt={item.title} className="couple-record-image" />}
          <p>{item.body}</p>
          {item.stickers?.some(Boolean) && <div className="couple-stickers" aria-label="日记贴纸">
            {item.stickers.map((sticker, index) => sticker && <button key={index} type="button" disabled={working}
              title="拖动贴纸" aria-label={`移动贴纸 ${sticker}`} style={{
                left: `${item.stickerPositions?.[index]?.x ?? 12 + index % 6 * 14}%`,
                top: `${item.stickerPositions?.[index]?.y ?? 30 + Math.floor(index / 6) * 21}%`,
              }} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerUp={event => {
                const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                if (!bounds?.width || !bounds.height) return;
                const clamp = (value: number) => Math.max(5, Math.min(95, value));
                const position = { x: clamp((event.clientX - bounds.left) / bounds.width * 100), y: clamp((event.clientY - bounds.top) / bounds.height * 100) };
                const stickerPositions = (item.stickers ?? []).map((_, i) => i === index ? position : item.stickerPositions?.[i] ??
                  { x: 12 + i % 6 * 14, y: 30 + Math.floor(i / 6) * 21 });
                void run(() => save({ ...item, stickerPositions }));
              }}>{sticker}</button>)}
          </div>}
          {item.reply && <p className="couple-reply">{names[item.side === 'me' ? 'them' : 'me']}回信 · {item.reply}</p>}
          {item.steps?.filter(step => step.text.trim()).map((step, index) => <label key={index}>
            <input type="checkbox" checked={step.done} disabled={working} onChange={event => {
              const done = event.target.checked;
              void run(() => save({ ...item, steps: item.steps?.filter(value => value.text.trim()).map((value, i) => i === index ? { ...value, done } : value) }));
            }} /> {step.text}
          </label>)}
          <div className="couple-actions">
            <button disabled={working} onClick={() => setDraft(item)}>编辑</button>
            {(kind === 'wish' || kind === 'hollow') && <button disabled={working} onClick={() => void run(() => save({ ...item, done: !item.done }))}>
              {item.done ? '重新打开' : kind === 'wish' ? '标记完成' : '标记已解决'}
            </button>}
            {kind === 'wish' && <button disabled={working} onClick={() => void run(() => save({ ...item, pinned: !item.pinned }))}>{item.pinned ? '取消置顶' : '置顶'}</button>}
            {(kind === 'mail' || kind === 'diary' || kind === 'capsule') && <button disabled={working || busy} onClick={() => {
              if (item.side === 'them') {
                const reply = window.prompt('写回信', item.reply);
                if (reply?.trim()) void run(() => save({ ...item, reply: reply.trim() }));
              } else void run(async () => save({ ...item, reply: await generate(`请以角色身份回复这份${recordNames[kind]}。\n标题：${item.title}\n内容：${item.body}`) }));
            }}>{item.reply ? '重写回信' : '回信'}</button>}
            {(kind === 'mail' || kind === 'capsule') && share && <button disabled={working} onClick={() => void run(() => share(`【${recordNames[kind]}】${item.title}\n${item.body}${item.reply ? `\n回信：${item.reply}` : ''}`, recordNames[kind]))}>分享到私聊</button>}
            <button disabled={working} onClick={() => {
              if (window.confirm('删除这条记录？')) void run(() => change(current => ({ ...current, entries: current.entries.filter(row => row.id !== item.id) })));
            }}>删除</button>
          </div>
        </>}
      </article>;
    })}
  </>;
}
