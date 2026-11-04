import React, { useEffect, useState } from 'react';
import type { DiaryEntry } from '../../types';
import { DB } from '../../utils/db';
import type { Bond, Entry, EntryKind, Side } from '../../utils/couplesSpace';
import { capsuleDate, capsuleStatus, createEntry } from '../../utils/couplesSpace';
import { processImage } from '../../utils/file';
import { useLocalDateKey } from '../../hooks/useLocalDateKey';
import TokenImg from '../../components/os/TokenImg';

export const recordNames: Record<EntryKind, string> = {
  timeline: '牵绊时光', anniversary: '纪念日', diary: '交换日记', wish: '愿望清单',
  gift: '礼物图鉴', mail: '时光信箱', capsule: '时间胶囊', hollow: '树洞',
};

const recordLooks: Record<EntryKind, { english: string; intro: string; create: string; empty: string; title: string; body: string }> = {
  timeline: { english: 'OUR TIMELINE', intro: '沿着时间的线，慢慢收集共同的片段。', create: '记下这一刻', empty: '第一段故事，从此刻开始。', title: '给这个瞬间一个名字', body: '这一天发生了什么？' },
  anniversary: { english: 'SPECIAL DATES', intro: '留一张日期票根，记住值得庆祝的日子。', create: '添加纪念日', empty: '留一个日期给未来的我们。', title: '这是什么特别的日子？', body: '写下为什么值得纪念' },
  diary: { english: 'PRIVATE JOURNAL', intro: '两本日记，写下今天各自的心情。', create: '翻开新的一页', empty: '写下第一页，等 TA 也来写。', title: '今天这一页的标题', body: '今天想记住些什么……' },
  wish: { english: 'OUR WISHLIST', intro: '想和你完成的事，变成一张张待勾选的愿望。', create: '许一个心愿', empty: '第一张愿望卡，留给我们。', title: '我们想一起做什么？', body: '为什么想和 TA 一起实现？' },
  gift: { english: 'GIFT GALLERY', intro: '每一份心意，都值得像礼物一样被收藏。', create: '包装一份礼物', empty: '第一份礼物，会是什么样子？', title: '礼物的名字', body: '写一句送礼物的心意' },
  mail: { english: 'LETTERS BETWEEN US', intro: '将想说的话装进信封，等待对方回信。', create: '写一封信', empty: '信箱空着，等你的第一封信。', title: '想问 TA 什么？', body: '在这里写下你的回答与心里话' },
  capsule: { english: 'TO THE FUTURE', intro: '封好一封寄给未来的信，到了日子再打开。', create: '封存一封信', empty: '在未来的某一天，打开今天写的信。', title: '给未来的一句话', body: '写给未来的我们……' },
  hollow: { english: 'QUIET CORNER', intro: '把难以开口的小心事，轻轻藏在这里。', create: '藏一张心事卡', empty: '这里是一处安静的角落。', title: '这件心事叫什么？', body: '不方便说出口的话，写在这里' },
};
function RecordArt({ kind, date, count, image }: { kind: EntryKind; date: string; count: number; image?: string }) {
  const month = date.slice(5, 7) || '--';
  const day = date.slice(8, 10) || '--';
  return <div className={'couple-record-art couple-record-art-' + kind} aria-hidden="true">
    {kind === 'timeline' && <div className="couple-art-rail"><i/><i/><i/><span>{date.slice(0, 4)}</span></div>}
    {kind === 'anniversary' && <div className="couple-art-calendar"><span>DATE</span><strong>{day}</strong><small>{month} / {date.slice(0, 4)}</small></div>}
    {kind === 'diary' && <div className="couple-art-notebook"><span>MY DEAR DIARY</span><i/><i/><i/><i/></div>}
    {kind === 'wish' && <div className="couple-art-checklist"><i/><i/><i/></div>}
    {kind === 'gift' && <div className="couple-art-gift">{image ? <TokenImg value={image} alt="" /> : <><span className="couple-gift-box"/><span className="couple-gift-ribbon"/></>}</div>}
    {kind === 'mail' && <div className="couple-art-envelope"><i/><span>TO YOU</span></div>}
    {kind === 'capsule' && <div className="couple-art-capsule"><span>FUTURE</span><i/><small>SEALED LETTER</small></div>}
    {kind === 'hollow' && <div className="couple-art-secret"><i/><i/><span>PRIVATE</span></div>}
    <span className="couple-art-count">{String(count).padStart(2, '0')}</span>
  </div>;
}


/* Distinct pages, not a single collection template with different badges. */
function upcomingDate(date: string, today: string) {
  const parts = date.split('-').map(Number);
  if (parts.length !== 3 || parts.some(v => !Number.isFinite(v))) return undefined;
  const now = new Date(today + 'T12:00:00');
  if (!Number.isFinite(now.getTime())) return undefined;
  let year = now.getFullYear();
  let due = new Date(year, parts[1] - 1, Math.min(parts[2], new Date(year, parts[1], 0).getDate()), 12);
  if (due < now) { year++; due = new Date(year, parts[1] - 1, Math.min(parts[2], new Date(year, parts[1], 0).getDate()), 12); }
  return Math.round((due.getTime() - now.getTime()) / 86400000);
}
function elapsedDate(start: string, today: string) {
  const a = new Date(start + 'T12:00:00').getTime();
  const b = new Date(today + 'T12:00:00').getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b-a)/86400000)+1) : 1;
}
type CoupleSceneProps = {
  kind: EntryKind; bond: Bond; names: Record<Side,string>; rows: Entry[]; today: string;
  onNew: () => void; onAI: () => void; busy: boolean; onJump: (id:string) => void;
  avatarMe?: string; avatarThem?: string; charId?: string; onNativeJournal?: () => void;
};
function SceneAvatar({ value, name }: { value?: string; name: string }) {
  return <span className="couple-scene-avatar">{value ? <TokenImg value={value} alt={name} /> : <span>{name.slice(0,1)}</span>}</span>;
}
function CoupleScene({ kind, bond, names, rows, today, onNew, onAI, busy, onJump,
  avatarMe, avatarThem, charId, onNativeJournal }: CoupleSceneProps) {
  const [native, setNative] = useState<DiaryEntry[]>([]);
  const [journalPage, setJournalPage] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (kind !== 'diary' || !charId) return;
    let active = true;
    DB.getDiariesByCharId(charId).then(items => {
      if (active) { setNative(items.sort((a,b) => b.date.localeCompare(a.date))); setError(''); }
    }).catch(() => { if (active) setError('原生日记读取失败，可以打开日记应用重试。'); });
    return () => { active = false; };
  }, [kind, charId]);
  const actions = (label: string, secondary?: string) => <div className="couple-scene-controls">
    <button type="button" className="couple-scene-main-action" disabled={busy} onClick={onNew}>{label}</button>
    <button type="button" className="couple-scene-ai-action" disabled={busy} onClick={onAI}>{secondary ?? ('邀请' + names.them)}</button>
  </div>;
  const total = rows.length;
  if (kind === 'anniversary') {
    const source = [ { id:'start', title:'我们的起点', date:bond.start },...rows.map(r=>({id:r.id,title:r.title,date:r.date})) ];
    const nearest = source.map(r=>({...r,delta:upcomingDate(r.date,today) ?? 9999})).sort((a,b)=>a.delta-b.delta)[0];
    const elapsed = elapsedDate(bond.start,today);
    return <div className="couple-scene couple-scene-anniversary">
      <div className="couple-anniversary-hero">
        <div className="couple-anniversary-kicker"><span>SINCE {bond.start}</span><span>纪念日</span></div>
        <div className="couple-anniversary-pair"><SceneAvatar value={avatarMe} name={names.me}/><span className="couple-anniversary-thread">♡</span><SceneAvatar value={avatarThem} name={names.them}/></div>
        <div className="couple-anniversary-time"><span>我们已经相伴</span><strong>{elapsed.toLocaleString('zh-CN')}</strong><em>天</em></div>
        <div className="couple-anniversary-names">{names.me} <span>&</span> {names.them}</div>
      </div>
      <div className="couple-anniversary-next">
        <div><span>下一次值得期待</span><strong>{nearest?.title ?? '属于我们的日子'}</strong></div>
        <div className="couple-anniversary-countdown"><strong>{nearest?.delta ?? '—'}</strong><small>天后</small></div>
      </div>
      <div className="couple-anniversary-calendar">
        <div className="couple-anniversary-calendar-head"><strong>纪念日期</strong><small>{source.length} 个日子</small></div>
        {source.map(item => <button key={item.id} type="button" disabled={item.id==='start'}
          onClick={()=>item.id!=='start' && onJump(item.id)}>
          <span className="couple-anniversary-calendar-date"><b>{item.date.slice(8,10)}</b><small>{item.date.slice(5,7)}月</small></span>
          <span>{item.title}<small>{item.date}</small></span>
          <span className="couple-anniversary-calendar-chevron">{item.id==='start' ? '始' : '›'}</span>
        </button>)}
      </div>
      {actions('＋ 添加一个特别的日子','请 '+names.them+' 回忆')}
    </div>;
  }
  if (kind === 'diary') {
    const active = native[Math.min(journalPage,Math.max(native.length-1,0))];
    return <div className="couple-scene couple-scene-diary">
      <div className="couple-diary-cover"><span className="couple-diary-spine"/><span>DIARY EXCHANGE</span>
        <strong>两个人的日记</strong><small>今天的生活，交换着读。</small>
        <div className="couple-diary-cover-people"><span>{names.me}</span><span>·</span><span>{names.them}</span></div>
      </div>
      <div className="couple-diary-native">
        <div className="couple-diary-native-head"><strong>原生日记本</strong><span>{native.length} 篇</span></div>
        {native.length ? <>
          <div className="couple-diary-paper-spread">
            <div className="couple-diary-left-page"><small>{active?.date} / {names.me}</small><p>{active?.userPage?.text?.trim() || '这一页还没有写下文字。'}</p></div>
            <div className="couple-diary-right-page"><small>{names.them} / REPLY</small><p>{active?.charPage?.text?.trim() || '这一页还在等 TA 的日记。'}</p></div>
          </div>
          <div className="couple-diary-page-flip">
            <button disabled={journalPage>=native.length-1} onClick={()=>setJournalPage(i=>i+1)}>‹ 旧日记</button>
            <span>{journalPage+1} / {native.length}</span>
            <button disabled={journalPage===0} onClick={()=>setJournalPage(i=>i-1)}>新日记 ›</button>
          </div>
        </> : <div className="couple-diary-native-empty"><span>↗</span><strong>还没有交换的日记</strong><p>写下今天的事，再看看 TA 会记住些什么。</p></div>}
        {error && <p role="alert" className="couple-error">{error}</p>}
        {onNativeJournal && <button className="couple-diary-open-original" onClick={onNativeJournal}>打开原生交换日记 <span>↗</span></button>}
      </div>
      <div className="couple-diary-sidebook"><div><span>COUPLE SPACE</span><strong>情侣空间的日记页</strong><p>这里另外收藏了 {total} 页与你们的关系有关的记事。</p></div>
        {actions('＋ 写下新的一页','请 '+names.them+' 写一页')}</div>
    </div>;
  }
  if(kind==='mail'){
    const unread=rows.filter(r=>!r.reply).length;
    return <div className="couple-scene couple-scene-mail">
      <div className="couple-mail-postbox"><span className="couple-mail-stamp">POST / {today.slice(0,4)}</span>
        <div className="couple-mail-slot"><span className="couple-mail-paper"><small>TO.</small><strong>{names.them}</strong><i/></span></div>
        <div className="couple-mail-bottom"><strong>时光信箱</strong><small>{unread} 封等待回信</small></div>
      </div>
      <div className="couple-mail-routing"><div><small>FROM</small><strong>{names.me}</strong></div><span>━━━━ →</span><div><small>TO</small><strong>{names.them}</strong></div></div>
      <div className="couple-mail-trays"><span>LETTERS · {total}</span>
        {rows.length ? rows.map((item,i)=><button key={item.id} type="button" onClick={()=>onJump(item.id)}>
          <span className="couple-mail-tray-envelope"><span>✉</span></span>
          <span><strong>{item.title}</strong><small>{item.reply?'已有回信':'等待回信'} · {item.date}</small></span><b>{String(i+1).padStart(2,'0')}</b>
        </button>) : <div className="couple-mail-no-letters">信箱里没有信，第一封由你寄出。</div>}
      </div>
      {actions('写信给 '+names.them, '请 '+names.them+' 寄信')}
    </div>;
  }
  if(kind==='timeline'){
    return <div className="couple-scene couple-scene-timeline">
      <div className="couple-timeline-cover"><span>THE STORY SO FAR</span><strong>{names.me} <em>×</em> {names.them}</strong><p>一段关系的时间，不是数字，是有名字的瞬间。</p><div><b>{total}</b><span>个被珍藏的瞬间</span></div></div>
      <div className="couple-timeline-flow"><span className="couple-timeline-flow-label">MOMENTS / {today.slice(0,4)}</span>
        {rows.length ? rows.map((item,index)=><button type="button" key={item.id} onClick={()=>onJump(item.id)}><span className="couple-timeline-flow-date">{item.date.slice(5).replace('-','/')}</span><span className="couple-timeline-flow-dot"/><span><strong>{item.title}</strong><small>{item.body || names[item.side]+' 记录'}</small></span>{item.image&&<TokenImg value={item.image} alt="" />}</button>)
        : <div className="couple-timeline-first">故事开始于 {bond.start}。<br/>下一件值得收藏的事，等你们来写。</div>}
      </div>{actions('＋ 珍藏这一刻','请 '+names.them+' 讲述')}
    </div>;
  }
  if(kind==='wish'){
    const done=rows.filter(row=>row.done).length;
    return <div className="couple-scene couple-scene-wish">
      <div className="couple-wish-header"><div><span>OUR BUCKET LIST</span><h2>想和你一起做的事</h2></div><div className="couple-wish-ratio"><strong>{done}<small> / {total}</small></strong><span>已完成</span></div></div>
      <div className="couple-wish-board">
        {rows.length?rows.map((item,index)=><button type="button" key={item.id} onClick={()=>onJump(item.id)} className={'couple-wish-note couple-wish-note-'+index%3+(item.done?' done':'')}>
          <span className="couple-wish-pin" /><span className="couple-wish-note-index">{String(index+1).padStart(2,'0')}</span>
          <strong>{item.title}</strong><small>{item.done?'✓ 已完成':'待一起实现'}</small>
          <span className="couple-wish-note-steps">{(item.steps??[]).filter(s=>s.text.trim()).length} 个小目标</span>
        </button>):<div className="couple-wish-blank"><span>01 · 02 · 03</span><strong>这面愿望墙还空着。</strong><small>先贴上第一件想一起做的事吧。</small></div>}
      </div>{actions('＋ 写一张愿望纸','问问 '+names.them+' 的愿望')}
    </div>;
  }
  if(kind==='gift'){
    return <div className="couple-scene couple-scene-gift">
      <div className="couple-gift-counter"><span>THE THOUGHTFUL THINGS</span><strong>礼物收藏室</strong><small>{total} 份被认真收藏的心意</small></div>
      <div className="couple-gift-pedestal"><span className="couple-gift-pedestal-light"/><div className="couple-gift-pedestal-stage">{rows[0]?.image?<TokenImg value={rows[0].image} alt={rows[0].title}/>:<span className="couple-gift-display-box"><i/></span>}</div><span>FOR {names.them}</span></div>
      {rows.length?<div className="couple-gift-shelf">{rows.map((item,i)=><button key={item.id} onClick={()=>onJump(item.id)}><span className="couple-gift-thumbnail">{item.image?<TokenImg value={item.image} alt=""/>:<span>◻</span>}</span><span><strong>{item.title}</strong><small>{item.date}</small></span><small>NO.{String(i+1).padStart(2,'0')}</small></button>)}</div>:
      <div className="couple-gift-no-items">这里还没有礼物。第一份心意不必昂贵。</div>}
      {actions('＋ 包装一份礼物','听听 '+names.them+' 的心意')}
    </div>;
  }
  if(kind==='capsule'){
    const ready=rows.filter(item=>capsuleStatus(item,today)==='ready').length;
    return <div className="couple-scene couple-scene-capsule">
      <div className="couple-capsule-vault"><span className="couple-capsule-top">DO NOT OPEN UNTIL</span><div className="couple-capsule-lock"><i/><strong>{ready}</strong><small>封可开启</small></div><strong>寄给未来的我们</strong><span className="couple-capsule-foot">{total} 个时间约定</span></div>
      <div className="couple-capsule-shelves">{rows.length?rows.map(item=><button type="button" key={item.id} onClick={()=>onJump(item.id)} className={capsuleStatus(item,today)==='sealed'?'is-sealed':''}><span className="couple-capsule-round">◉</span><span><strong>{capsuleStatus(item,today)==='sealed'?'封存中的时间胶囊':item.title}</strong><small>{capsuleStatus(item,today)==='sealed'?'将在 '+item.unlockDate+' 开启':item.date+' 写下'}</small></span><small>{capsuleStatus(item,today)==='ready'?'可拆':'›'}</small></button>):<div>还没有封存的约定，把想说的话留给未来。</div>}</div>
      {actions('＋ 寄给未来一封信','请 '+names.them+' 封存')}
    </div>;
  }
  return <div className="couple-scene couple-scene-hollow">
    <div className="couple-hollow-door"><span>KEEP BETWEEN US</span><div className="couple-hollow-keyhole">○<i/></div><strong>不必说出口的心事</strong><p>写在这里，不必解释给任何人听。</p><small>已收藏 {total} 张心事</small></div>
    <div className="couple-hollow-drawer">{rows.length?rows.map(item=><button key={item.id} type="button" onClick={()=>onJump(item.id)}><span>密封便笺</span><strong>•••• ••••</strong><small>{item.date} · 点击打开</small></button>):<div className="couple-hollow-empty">暂时没有心事。空着也很好。</div>}</div>
    {actions('＋ 留一张心事便笺','听听 '+names.them+' 的心事')}
  </div>;
}

export type ChangeBond = (update: (bond: Bond) => Bond) => Promise<void>;
export type Generate = (instruction: string) => Promise<string>;

export function BondRecords({ kind, bond, names, change, generate, share, busy }: {
  kind: EntryKind; bond: Bond; names: Record<Side, string>; change: ChangeBond;
  generate: Generate; share?: (content: string, label?: string) => Promise<void>; busy: boolean;
}) {
  const [draft, setDraft] = useState<Entry>();
  const [filter, setFilter] = useState('all');
  const [earlyId, setEarlyId] = useState<string>();
  const [replyDraft, setReplyDraft] = useState<{ id: string; text: string }>();
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
  const look = recordLooks[kind];
  const latest = rows[0];
  const countDone = kind === 'wish' ? rows.filter(row => row.done).length : rows.length;
  return <div className={'couple-records couple-records-' + kind + (draft ? ' couple-records-editing' : '')}>
    <section className="couple-record-feature">
      <div className="couple-record-feature-copy">
        <span className="couple-record-overline">{look.english}</span>
        <strong>{kind === 'wish' ? countDone + ' / ' + rows.length + ' 已完成' : kind === 'capsule' ? capsules.filter(row => capsuleStatus(row, today) === 'ready').length + ' 封待拆' : rows.length + ' 份收藏'}</strong>
        <p>{look.intro}</p>
      </div>
      <RecordArt kind={kind} date={latest?.date || today} count={rows.length} image={kind === 'gift' ? latest?.image : undefined} />
    </section>
    <div className="couple-record-actions">
      <div className="couple-actions">
      <button disabled={working || busy} onClick={() => setDraft(newEntry())}>{look.create}</button>
      <button disabled={working || busy} onClick={() => void run(generated)}>{working || busy ? '处理中…' : `请 ${names.them} 写`}</button>
      {kind === 'hollow' && <button disabled={!rows.length} onClick={() => {
        const row = rows[Math.floor(Math.random() * rows.length)];
        document.getElementById(`bond-entry-${row.id}`)?.scrollIntoView({ block: 'center' });
      }}>摇一摇</button>}
      </div>
    </div>
    {kind === 'diary' && <details className="couple-record-preferences">
      <summary>日记偏好 <span>自动写作与回顾设置</span></summary>
      <div className="couple-record-preferences-body">
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
      </div>
    </details>}
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
    {kind === 'hollow' && <div className="couple-record-preferences couple-hollow-preference"><label>
      <input type="checkbox" checked={!!bond.hollowAuto} disabled={working} onChange={event => {
        const hollowAuto = event.target.checked;
        void run(() => change(current => ({ ...current, hollowAuto })));
      }} /> 允许角色在私聊后悄悄留下心事
    </label></div>}
    {error && <p role="alert" className="couple-error">{error}</p>}
    {draft && <form className={'couple-card couple-compose couple-compose-' + kind} onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        const title = draft.title.trim();
        if (!title) return;
        const record = { ...draft, title, body: draft.body.trim() };
        await save(record);
        setDraft(undefined);
      });
    }}>
      <div className="couple-compose-intro">
        <span>{look.english} / {rows.some(row => row.id === draft.id) ? 'EDIT' : 'NEW'}</span>
        <strong>{look.create}</strong>
        {kind === 'mail' && <div className="couple-compose-mail-route">
          <span>FROM · {names[draft.side]}</span>
          <span>TO · {names[draft.side === 'me' ? 'them' : 'me']}</span>
        </div>}
        <p>{look.intro}</p>
      </div>
      <div className="couple-compose-paper">
        <div className="couple-compose-metadata">
          <label>{kind === 'anniversary' ? '值得记住的日期' : '日期'}
            <input type="date" required value={draft.date} onChange={event => patch({ date: event.target.value })} />
          </label>
          <label>署名
            <select value={draft.side} onChange={event => patch({ side: event.target.value as Side })}>
              <option value="me">{names.me}</option><option value="them">{names.them}</option>
            </select>
          </label>
        </div>
        <label className="couple-compose-heading">{kind === 'mail' ? '信件主题' : kind === 'hollow' ? '一个代号' : '标题'}
          <input required value={draft.title} placeholder={look.title} onChange={event => patch({ title: event.target.value })} maxLength={140} />
        </label>
        <label className="couple-compose-textarea">{kind === 'mail' ? '信件正文' : kind === 'diary' ? '日记内页' : '内容'}
          <textarea value={draft.body} placeholder={look.body} onChange={event => patch({ body: event.target.value })} maxLength={10000} />
        </label>
      </div>
      {kind === 'wish' && <div className="couple-compose-checklist">
        <span>愿望的小步骤</span>
        {(draft.steps ?? []).map((step, index) => <div className="couple-compose-step" key={index}>
          <span className="couple-compose-step-bullet" aria-hidden="true">{step.done ? '✓' : ''}</span>
          <input aria-label={'第 ' + (index+1) + ' 个步骤'} placeholder="写下一个可以一起完成的步骤"
            value={step.text} onChange={event => patch({ steps: (draft.steps ?? []).map((value, i) => i === index ? { ...value, text: event.target.value } : value) })} />
          <button type="button" aria-label={'删除第 ' + (index+1) + ' 个步骤'}
            onClick={() => patch({ steps: (draft.steps ?? []).filter((_, i) => i !== index) })}>×</button>
        </div>)}
        <button type="button" className="couple-compose-step-add"
          onClick={() => patch({ steps: [...(draft.steps ?? []), { text: '', done: false }] })}>＋ 添加一个小步骤</button>
      </div>}
      {kind === 'capsule' && !draft.opened && <div className="couple-compose-unlock">
        <label>开启日期<input required type="date" min={today} value={draft.unlockDate ?? ''} onChange={event => patch({ unlockDate: event.target.value })} /></label>
        <div className="couple-segments" aria-label="快捷开启日期">
          {([[1, '一个月'], [6, '半年'], [12, '一年']] as const).map(([months, label]) =>
            <button key={months} type="button" onClick={() => patch({ unlockDate: capsuleDate(months) })}>{label}</button>)}
        </div>
      </div>}
      {kind === 'diary' && <div className="couple-diary-sticker-tray">
        <span>给这页贴上小贴纸</span>
        <div className="couple-diary-sticker-chips">
          {['♡', '✦', '☾', '☼'].map(sticker => <button key={sticker} type="button"
            aria-pressed={!!draft.stickers?.includes(sticker)} aria-label={'贴纸 ' + sticker}
            onClick={() => patch({ stickers: draft.stickers?.includes(sticker)
              ? draft.stickers.filter(value => value !== sticker)
              : [...(draft.stickers ?? []).filter(Boolean), sticker].slice(0, 16) })}>{sticker}</button>)}
        </div>
      </div>}
      {(['gift', 'diary', 'timeline', 'anniversary'] as EntryKind[]).includes(kind) && <label className="couple-compose-gift-photo">
        <span>{kind === 'gift' ? '礼物照片' : kind === 'diary' ? '这一页的照片' : kind === 'anniversary' ? '纪念日照片' : '这一刻的照片'}</span>
        <div className="couple-compose-photo-preview">{draft.image ? <TokenImg value={draft.image} alt="记录照片预览" /> : <span>{kind === 'gift' ? '添加礼物照片' : '为这段记录添加一张照片'}</span>}</div>
        <input type="file" accept="image/*" disabled={working} onChange={event => {
        const file = event.target.files?.[0];
        if (file) void run(async () => patch({ image: await processImage(file, { maxWidth: 720 }) }));
      }} /></label>}
      <div className="couple-compose-buttons">
        <button className="couple-primary" disabled={working}>{kind === 'capsule' ? '保存并封存' : '保存这张卡片'}</button>
        <button type="button" onClick={() => setDraft(undefined)}>取消</button>
      </div>
    </form>}
    {!rows.length && !draft && <section className="couple-record-empty">
      <span className="couple-record-empty-line" aria-hidden="true">—</span>
      <strong>{look.empty}</strong>
      <button type="button" onClick={() => setDraft(newEntry())}>＋ {look.create}</button>
    </section>}
    {!draft && rows.map(item => {
      const state = kind === 'capsule' ? capsuleStatus(item, today) : undefined;
      const sealed = state === 'ready' || state === 'sealed';
      return <article className={'couple-card couple-record-entry couple-entry-' + kind + (item.done ? ' couple-entry-completed' : '')} key={item.id} id={`bond-entry-${item.id}`}>
        <div className="couple-entry-head">
          <span>{kind === 'anniversary' ? item.date.slice(5) : kind === 'wish' ? (item.done ? '✓' : '○') : kind === 'mail' ? 'LETTER' : kind === 'capsule' ? 'FUTURE' : kind === 'gift' ? 'GIFT' : kind === 'diary' ? 'JOURNAL' : kind === 'hollow' ? 'PRIVATE' : item.date.slice(5)}</span>
          <span>{recordNames[kind]}</span>
        </div>
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
                setReplyDraft({ id: item.id, text: item.reply ?? '' });
              } else void run(async () => save({ ...item, reply: await generate(`请以角色身份回复这份${recordNames[kind]}。\n标题：${item.title}\n内容：${item.body}`) }));
            }}>{item.reply ? '重写回信' : '回信'}</button>}
            {(kind === 'mail' || kind === 'capsule') && share && <button disabled={working} onClick={() => void run(() => share(`【${recordNames[kind]}】${item.title}\n${item.body}${item.reply ? `\n回信：${item.reply}` : ''}`, recordNames[kind]))}>分享到私聊</button>}
            <button disabled={working} onClick={() => {
              if (window.confirm('删除这条记录？')) void run(() => change(current => ({ ...current, entries: current.entries.filter(row => row.id !== item.id) })));
            }}>删除</button>
          </div>
        </>}
        {replyDraft?.id === item.id && <form className="couple-letter-reply-form" onSubmit={event => {
          event.preventDefault();
          const reply = replyDraft.text.trim();
          if (!reply) return;
          void run(async () => { await save({ ...item, reply }); setReplyDraft(undefined); });
        }}>
          <span>REPLY / {names.me}</span>
          <label>写给 {names.them}
            <textarea required maxLength={10000} value={replyDraft.text}
              onChange={event => setReplyDraft({ id: item.id, text: event.target.value })}
              placeholder="把想说的话写进这封回信……" />
          </label>
          <div className="couple-actions">
            <button className="couple-primary" disabled={working || !replyDraft.text.trim()}>保存回信</button>
            <button type="button" onClick={() => setReplyDraft(undefined)}>取消</button>
          </div>
        </form>}
      </article>;
    })}
  </div>;
}
