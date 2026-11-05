import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DiaryEntry } from '../../types';
import { DB } from '../../utils/db';
import type { Bond, Entry, EntryKind, Side } from '../../utils/couplesSpace';
import { capsuleDate, capsuleStatus, createEntry, dayKey, pickHollowPaper, timelineTags, wishCategories, wishTags } from '../../utils/couplesSpace';
import { extractJson } from '../../utils/safeApi';
import { processImage } from '../../utils/file';
import { useLocalDateKey } from '../../hooks/useLocalDateKey';
import TokenImg from '../../components/os/TokenImg';
import { TimelineCinema } from './timelineCinema';
import { WishConstellation } from './wishConstellation';

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
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b-a)/86400000)+1) : 0;
}
type CoupleSceneProps = {
  kind: EntryKind; bond: Bond; names: Record<Side,string>; rows: Entry[]; today: string;
  onNew: () => void; onAI: () => void; busy: boolean; onJump: (id:string) => void;
  onWishToggle?: (entry: Entry) => void; glowingRecordId?: string;
  avatarMe?: string; avatarThem?: string; charId?: string; onNativeJournal?: () => void;
  filter: string; onFilter: (filter: string) => void; totalRecords: number; focusRecordId?: string;
  diaryPrefs?: React.ReactNode; hollowPrefs?: React.ReactNode; tools?: React.ReactNode;
};
function SceneAvatar({ value, name }: { value?: string; name: string }) {
  return <span className="couple-scene-avatar">{value ? <TokenImg value={value} alt={name} /> : <span>{name.slice(0,1)}</span>}</span>;
}
function CoupleScene({ kind, bond, names, rows, today, onNew, onAI, busy, onJump, onWishToggle, glowingRecordId,
  avatarMe, avatarThem, charId, onNativeJournal, filter, onFilter, totalRecords, focusRecordId, diaryPrefs, hollowPrefs, tools }: CoupleSceneProps) {
  const [native, setNative] = useState<DiaryEntry[]>([]);
  const [journalPage, setJournalPage] = useState(0);
  // Purely local, user-triggered paper reveal; no API and no passive background activity.
  const [hollowShaking, setHollowShaking] = useState(false);
  const [hollowEmpty, setHollowEmpty] = useState(false);
  const hollowShakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHollowPaperId = useRef<string>();
  const hollowEmptyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (hollowShakeTimer.current !== null) clearTimeout(hollowShakeTimer.current);
    if (hollowEmptyTimer.current !== null) clearTimeout(hollowEmptyTimer.current);
  }, []);
  const shakeHollow = () => {
    if (busy || hollowShaking) return;
    if (hollowShakeTimer.current !== null) clearTimeout(hollowShakeTimer.current);
    if (hollowEmptyTimer.current !== null) clearTimeout(hollowEmptyTimer.current);
    setHollowEmpty(false);
    setHollowShaking(true);
    // Draw an existing paper locally; never request a character reply here.
    const chosen = pickHollowPaper(rows, lastHollowPaperId.current);
    if (chosen) lastHollowPaperId.current = chosen.id;
    hollowShakeTimer.current = setTimeout(() => {
      hollowShakeTimer.current = null;
      setHollowShaking(false);
      if (chosen) onJump(chosen.id);
      else {
        setHollowEmpty(true);
        hollowEmptyTimer.current = setTimeout(() => {
          setHollowEmpty(false);
          hollowEmptyTimer.current = null;
        }, 1800);
      }
    }, 1320);
  };
  const [error, setError] = useState('');
  useEffect(() => {
    if (kind !== 'diary' || !charId) return;
    let active = true;
    DB.getDiariesByCharId(charId).then(items => {
      if (active) { setNative(items.sort((a,b) => b.date.localeCompare(a.date))); setError(''); }
    }).catch(() => { if (active) setError('原生日记读取失败，可以打开日记应用重试。'); });
    return () => { active = false; };
  }, [kind, charId]);
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
        <button type="button" className="couple-anniversary-invite" disabled={busy} onClick={onNew}>
          <span aria-hidden="true">＋</span> 记住另一个特别的日子
        </button>
      </div>
      <button type="button" className="couple-anniversary-ask" disabled={busy} onClick={onAI}>
        让 {names.them} 回忆属于你们的日子 <span>↗</span>
      </button>
    </div>;
  }
  if (kind === 'diary') {
    const active = native[Math.min(journalPage,Math.max(native.length-1,0))];
    return <div className="couple-scene couple-scene-diary">
      <div className="couple-diary-cover"><span className="couple-diary-spine"/><span>DIARY EXCHANGE</span>
        <strong>两个人的日记</strong><small>今天的生活，交换着读。</small>
        <div className="couple-diary-cover-people"><span>{names.me}</span><span>·</span><span>{names.them}</span></div>
        <button className="couple-diary-cover-open" disabled={busy} onClick={onNew}>＋ 写一页</button>
        <button type="button" className="couple-diary-cover-character" disabled={busy} onClick={onAI}>✎ 请 {names.them} 写关系日记</button>
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
        {onNativeJournal && <button className="couple-diary-open-original" onClick={onNativeJournal}>在原生日记里继续写 <span>↗</span></button>}
      </div>
      {totalRecords > 0 && <div className="couple-diary-bookmarks">
        <div className="couple-diary-bookmark-head"><span>留在你们之间的书签 · {totalRecords}</span></div>
        <div className="couple-diary-filter-mark">
          <select aria-label="按记录者筛选情侣日记" value={filter} onChange={event=>onFilter(event.target.value)}>
            <option value="all">全部书签</option><option value="me">{names.me}</option><option value="them">{names.them}</option>
          </select>
        </div>
        {rows.map(row => <button key={row.id} className="couple-diary-bookmark-page" onClick={()=>onJump(row.id)}>
          <span>{row.date.slice(5)}</span><strong>{row.title}</strong><span>›</span>
        </button>)}
      </div>}
      {diaryPrefs}
    </div>;
  }
  if(kind==='mail'){
    const unread=bond.entries.filter(r=>r.kind==='mail' && !r.reply).length;
    return <div className="couple-scene couple-scene-mail">
      <div className="couple-mail-postbox"><span className="couple-mail-stamp">POST / {today.slice(0,4)}</span>
        <button className="couple-mail-slot" disabled={busy} onClick={onNew} aria-label={'写信给'+names.them}>
          <span className="couple-mail-paper"><small>TO.</small><strong>{names.them}</strong><i/></span>
        </button>
        <div className="couple-mail-bottom"><strong>时光信箱</strong><small>{unread} 封等待回信</small></div>
        <button type="button" className="couple-mail-lever" disabled={busy} onClick={onAI}>
          ◉ 请 {names.them} 寄来一封
        </button>
      </div>
      {tools}
      <div className="couple-mail-trays">
        {totalRecords > 0 && <div className="couple-mail-tray-heading">
          <span>往来信件 · {totalRecords}</span>
          <select aria-label="信箱筛选" value={filter} onChange={event=>onFilter(event.target.value)}>
            <option value="all">全部信件</option><option value="me">我寄出的</option>
            <option value="them">{names.them} 寄来的</option><option value="pending">尚未回信</option><option value="postman">时光邮递员</option>
          </select>
        </div>}
        {rows.length ? rows.map((item,i)=><button key={item.id} type="button" onClick={()=>onJump(item.id)}>
          <span className="couple-mail-tray-envelope"><span>✉</span></span>
          <span><strong>{item.title}</strong><small>{item.mailMode === 'postman' ? '时光邮递员 · ' : ''}{item.reply?'已有回信':'等待回信'} · {item.date}</small></span><b>{String(i+1).padStart(2,'0')}</b>
        </button>) : totalRecords === 0 ? null : <p className="couple-mail-no-letters">这个分类里暂时没有信。</p>}
      </div>
    </div>;
  }
  if (kind === 'timeline') return <TimelineCinema
    bond={bond} names={names} rows={rows} today={today} initialFocusId={focusRecordId} filter={filter} onFilter={onFilter}
    busy={busy} tools={tools} onNew={onNew} onAI={onAI} onJump={onJump}
  />;
  if (kind === 'wish') return <WishConstellation
    bond={bond} names={names} rows={rows} allCount={totalRecords} filter={filter}
    onFilter={onFilter} busy={busy} focusRecordId={focusRecordId} glowingRecordId={glowingRecordId}
    onNew={onNew} onAI={onAI} onOpen={onJump}
    onToggleDone={onWishToggle ?? (()=>{})}
  />;
  if(kind==='gift'){
    return <div className="couple-scene couple-scene-gift">
      <div className="couple-gift-counter"><span aria-hidden="true">✧</span><strong>礼物收藏室</strong><small>{total} 份被认真收藏的心意</small></div>
      <div className="couple-gift-pedestal"><span className="couple-gift-pedestal-light"/>
        {rows.length ? <button type="button" className="couple-gift-pedestal-stage" aria-label={`查看礼物：${rows[0].title}`} onClick={()=>onJump(rows[0].id)}>
          {rows[0].image?<TokenImg value={rows[0].image} alt={rows[0].title}/>:<span className="couple-gift-display-box"><i/></span>}
        </button> : <button type="button" className="couple-gift-pedestal-stage" disabled={busy} onClick={onNew}>
          <span className="couple-gift-display-box"><i/></span>
          <span className="couple-gift-stage-caption">＋ 放上第一份礼物</span>
        </button>}
        <span>FOR {names.them}</span></div>
      {rows.length?<div className="couple-gift-shelf">{rows.map((item,i)=><button key={item.id} onClick={()=>onJump(item.id)}><span className="couple-gift-thumbnail">{item.image?<TokenImg value={item.image} alt=""/>:<span>◻</span>}</span><span><strong>{item.title}</strong><small>{item.date}</small></span><small>NO.{String(i+1).padStart(2,'0')}</small></button>)}</div> : null}
      <div className="couple-gift-gallery-rail">
        {rows.length > 0 && <button type="button" className="couple-gift-gallery-add" disabled={busy} onClick={onNew}>＋ 新的礼物展位</button>}
        <button type="button" className="couple-gift-gallery-ask" disabled={busy} onClick={onAI}>
          <span>FROM {names.them}</span><strong>打开 TA 的心意 ↗</strong>
        </button>
      </div>
    </div>;
  }
  if(kind==='capsule'){
    const ready=bond.entries.filter(item=>item.kind==='capsule' && capsuleStatus(item,today)==='ready').length;
    return <div className="couple-scene couple-scene-capsule">
      <div className="couple-capsule-vault"><span className="couple-capsule-top" aria-hidden="true">⌛</span>
        <div className="couple-capsule-lock"><i/><strong>{ready}</strong><small>封可开启</small></div>
        <strong>寄给未来的我们</strong><span className="couple-capsule-foot">{totalRecords} 个时间约定</span>
        <button type="button" className="couple-capsule-new" disabled={busy} onClick={onNew}>＋ 放进一封给未来的信</button>
      </div>
      {totalRecords > 0 && <div className="couple-capsule-shelves">
        <div className="couple-capsule-shelf-tools"><span>信件归档</span><select aria-label="按时间胶囊状态筛选"
          value={filter} onChange={event=>onFilter(event.target.value)}>
          <option value="all">所有约定</option><option value="sealed">未到期</option>
          <option value="ready">可拆封 {ready}</option><option value="opened">已拆封</option>
        </select></div>
        {rows.length?rows.map(item=><button type="button" key={item.id} onClick={()=>onJump(item.id)} className={capsuleStatus(item,today)==='sealed'?'is-sealed':''}><span className="couple-capsule-round">◉</span><span><strong>{capsuleStatus(item,today)==='sealed'?'封存中的时间胶囊':item.title}</strong><small>{capsuleStatus(item,today)==='sealed'?'将在 '+item.unlockDate+' 开启':item.date+' 写下'}</small></span><small>{capsuleStatus(item,today)==='ready'?'可拆':'›'}</small></button>):<p className="couple-capsule-no-match">这个抽屉里暂时没有信件。</p>}</div>}
      <button type="button" className="couple-capsule-request" disabled={busy} onClick={onAI}>
        让 {names.them} 也留一封给未来的信 <span>↗</span>
      </button>
    </div>;
  }
  return <div className="couple-scene couple-scene-hollow couple-hollow-immersive">
    <div className={'couple-hollow-portal' + (hollowShaking ? ' is-shaking' : '') + (hollowEmpty ? ' is-empty' : '')}>
      <div className="couple-hollow-orbit couple-hollow-orbit-one" aria-hidden="true"/>
      <div className="couple-hollow-orbit couple-hollow-orbit-two" aria-hidden="true"/>
      <div className="couple-hollow-orbit couple-hollow-orbit-three" aria-hidden="true"/>
      <div className="couple-hollow-dust" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>
      <span className="couple-hollow-count" aria-label={`已收藏${totalRecords}张心事`}>{String(totalRecords).padStart(2,'0')}</span>
      <button type="button" className="couple-hollow-vortex" disabled={busy || hollowShaking}
        aria-label="摇一摇，从树洞里抽出一张纸条" title="摇一摇" onClick={shakeHollow}>
        <span className="couple-hollow-vortex-depth" aria-hidden="true"/>
        <span className="couple-hollow-vortex-paper" aria-hidden="true"><i/></span>
        <span className="couple-hollow-vortex-sign" aria-hidden="true">↻</span>
        <span className="couple-hollow-vortex-caption" aria-hidden="true">{hollowShaking ? '···' : hollowEmpty ? '∅' : '摇一摇'}</span>
      </button>
      <span className="couple-hollow-portal-caption" aria-hidden="true">✦</span>
    </div>
    <div className="couple-hollow-interactions">
      <button type="button" className="couple-hollow-add" disabled={busy} aria-label="向树洞投入一张纸条" title="投入纸条" onClick={onNew}>
        <span aria-hidden="true">＋</span><span>写一张</span>
      </button>
      <button type="button" className="couple-hollow-ask" disabled={busy} aria-label={`听听${names.them}的心事`} title={`听听${names.them}的心事`} onClick={onAI}>
        <span aria-hidden="true">✧</span><span>听听 TA</span>
      </button>
      {hollowPrefs}
    </div>
    {rows.length > 0 && <div className="couple-hollow-notes" aria-label="收藏的心事纸条">
      {rows.map((item,index) => <button type="button" key={item.id}
        className={'couple-hollow-note-item couple-hollow-note-item-'+index%3}
        aria-label={`打开${item.date}的心事纸条`} onClick={()=>onJump(item.id)}>
        <span className="couple-hollow-note-fold" aria-hidden="true">✉</span>
        <time>{item.date.slice(5)}</time>
      </button>)}
    </div>}
    <span className="couple-hollow-screenreader" role="status" aria-live="polite">
      {hollowEmpty ? '树洞里还没有纸条，可以先写一张。' : ''}
    </span>
  </div>;
}


function CoupleDetailHeading({ kind, entry, names, avatarMe, avatarThem, today }: {
 kind: EntryKind; entry: Entry; names: Record<Side,string>; avatarMe?:string; avatarThem?:string; today:string;
}) {
 if(kind==='anniversary') return <header className="couple-detail-anniversary">
   <div className="couple-detail-anniversary-faces"><SceneAvatar value={avatarMe} name={names.me}/><span>♡</span><SceneAvatar value={avatarThem} name={names.them}/></div>
   <small>纪念 / {entry.date}</small><h2>{entry.title}</h2>
   <div className="couple-detail-anniversary-days">从这一天起已经 <strong>{elapsedDate(entry.date,today)}</strong> 天</div>
 </header>;
 if(kind==='diary') return <header className="couple-detail-diary"><span>DIARY / {entry.date}</span><h2>{entry.title}</h2><small>{names[entry.side]} · 写下这一页</small></header>;
 if(kind==='mail') return <header className="couple-detail-mail"><span>POSTMARK · {entry.date}</span><div className="couple-detail-mail-from"><small>FROM</small><strong>{names[entry.side]}</strong><small>TO</small><strong>{names[entry.side==='me'?'them':'me']}</strong></div><h2>{entry.title}</h2></header>;
 if(kind==='timeline') return <header className="couple-detail-timeline"><span>{entry.date.slice(5).replace('-',' / ')}</span><div><small>{entry.date.slice(0,4)} / MOMENT</small><h2>{entry.title}</h2></div></header>;
 if(kind==='wish') return <header className="couple-detail-wish"><div className="wish-detail-constellation" aria-hidden="true"><i/></div><span>{entry.done?'✧ 已点亮':'○ 等待实现'}</span><h2>{entry.title}</h2><small>{names[entry.side]} 写下的心愿 · {entry.date}</small>{(entry.wishCategory || entry.wishTag) &&
   <small>{[entry.wishCategory && wishCategories[entry.wishCategory], entry.wishTag && wishTags[entry.wishTag]].filter(Boolean).join(' · ')}</small>}</header>;
 if(kind==='gift') return <header className="couple-detail-gift"><div className="couple-detail-gift-photo">{entry.image?<TokenImg value={entry.image} alt={entry.title}/>:<span>FOR YOU</span>}</div><div><small>GIFT / {entry.date}</small><h2>{entry.title}</h2><span>FROM {names[entry.side]}</span></div></header>;
 if(kind==='capsule') return <header className="couple-detail-capsule"><span className="couple-detail-capsule-stamp">◉</span><small>{entry.opened?'OPENED':'SEALED'} · {entry.date}</small><h2>{entry.opened||entry.openedEarly?entry.title:'一封写给未来的信'}</h2><p>寄给 {names[entry.side==='me'?'them':'me']} · {entry.unlockDate||'未设置日期'}</p></header>;
 return <header className="couple-detail-hollow"><span>PRIVATE / {entry.date}</span><h2>{entry.title}</h2><small>写下了，就不必一直放在心上。</small></header>;
}

export type ChangeBond = (update: (bond: Bond) => Bond) => Promise<void>;
export type Generate = (instruction: string) => Promise<string>;

export function BondRecords({ kind, bond, names, change, generate, share, busy, notify, avatarMe, avatarThem, charId, onNativeJournal, generateTimeline, backHandler }: {
  kind: EntryKind; bond: Bond; names: Record<Side, string>; change: ChangeBond;
  generate: (instruction: string, signal?: AbortSignal) => Promise<string>; share?: (content: string, label?: string) => Promise<void>; busy: boolean;
  notify?: (message: string) => void;
  avatarMe?: string; avatarThem?: string; charId?: string; onNativeJournal?: () => void;
  generateTimeline?: (instruction: string, date: string) => Promise<string>; backHandler?: React.MutableRefObject<(() => boolean) | undefined>;
}) {
  const [draft, setDraft] = useState<Entry>();
  const [filter, setFilter] = useState('all');
  const [earlyId, setEarlyId] = useState<string>();
  const [replyDraft, setReplyDraft] = useState<{ id: string; text: string; source: Entry }>();
  const [timelineDate, setTimelineDate] = useState('');
  const [timelineSelection, setTimelineSelection] = useState<string[]>();
  const [mailDelivery, setMailDelivery] = useState<string>();
  const [failedDelivery, setFailedDelivery] = useState<string>();
  const mailRequest = useRef<AbortController>();
  const draftSource = useRef<Entry>();
  const recordsView = useRef<HTMLDivElement>(null);
  const listScrollTop = useRef(0);
  useEffect(() => () => mailRequest.current?.abort(), []);
  const [activeRecordId, setActiveRecordId] = useState<string>();
  const [lastSavedRecordId, setLastSavedRecordId] = useState<string>();
  const [lastGlowingRecordId, setLastGlowingRecordId] = useState<string>();
  const today = useLocalDateKey();
  const capsules = bond.entries.filter(item => item.kind === 'capsule');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const operationRef = useRef(false);
  const run = async (task: () => Promise<void>) => {
    if (operationRef.current || busy) return;
    operationRef.current = true;
    setWorking(true);
    setError('');
    try { await task(); } catch (e) {
      const message = e instanceof Error ? e.message : '操作失败';
      setError(message);
      notify?.(message);
    }
    finally { operationRef.current = false; setWorking(false); }
  };
  useEffect(() => {
    if (!backHandler) return;
    backHandler.current = () => {
      if (mailRequest.current && !mailRequest.current.signal.aborted) {
        mailRequest.current.abort();
        return true;
      }
      if (operationRef.current) return true;
      if (draft) { setDraft(undefined); return true; }
      if (replyDraft) { setReplyDraft(undefined); return true; }
      if (earlyId) { setEarlyId(undefined); return true; }
      if (activeRecordId) { setActiveRecordId(undefined); return true; }
      return false;
    };
    return () => { backHandler.current = undefined; };
  }, [activeRecordId, backHandler, draft, earlyId, replyDraft]);
  useEffect(() => {
    if (activeRecordId && !draft && !bond.entries.some(item => item.id === activeRecordId)) {
      setActiveRecordId(undefined);
      setReplyDraft(undefined);
      setEarlyId(undefined);
    }
  }, [activeRecordId, bond.entries, draft]);
  useLayoutEffect(() => {
    recordsView.current?.closest('.couple-main')?.scrollTo({ top: draft || activeRecordId ? 0 : listScrollTop.current });
  }, [activeRecordId, draft?.id]);
  const rememberListPosition = () => {
    listScrollTop.current = recordsView.current?.closest('.couple-main')?.scrollTop ?? 0;
  };
  const save = async (entry: Entry, expected?: Entry, signal?: AbortSignal) => {
    await change(current => {
      if (signal?.aborted) return current;
      const stored = current.entries.find(item => item.id === entry.id);
      if (expected && (!stored || JSON.stringify(stored) !== JSON.stringify(expected)))
        throw new Error('这条记录已在别处修改或删除，请返回列表重新打开');
      return { ...current, entries: stored
        ? current.entries.map(item => item.id === entry.id ? entry : item)
        : [...current.entries, entry] };
    });
    if (kind === 'timeline' || kind === 'wish') setLastSavedRecordId(entry.id);
  };
  const rows = bond.entries.filter(item => item.kind === kind)
    .filter(item => {
      if (filter === 'all') return true;
      if (kind === 'wish') return (item.wishCategory ?? 'other') === filter;
      if (kind === 'capsule') return capsuleStatus(item, today) === filter;
      if (kind === 'timeline') return true;
      if (kind === 'mail' && filter === 'postman') return item.mailMode === 'postman';
      return filter === 'pending' ? !item.reply : item.side === filter;
    })
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? ''));
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
  const newEntry = (): Entry => ({
    ...createEntry(kind, '', ''),
    unlockDate: kind === 'capsule' ? capsuleDate(1) : undefined,
    wishCategory: kind === 'wish' && filter !== 'all' ? filter as Entry['wishCategory'] : undefined,
  });
  const generated = async (signal?: AbortSignal) => {
    const content = (await generate(roleInstruction, signal)).trim();
    if (signal?.aborted) return;
    if (!content) throw new Error('角色没有生成可保存的内容，请重试');
    const [first, ...rest] = content.split('\n').filter(line => line.trim());
    const entry = { ...newEntry(), side: 'them' as const };
    if (kind === 'anniversary') {
      const match = first?.match(/^(\d{4}-\d{2}-\d{2})\s*[｜|]\s*(.+)$/);
      const parsed = match ? new Date(match[1] + 'T12:00:00') : undefined;
      if (!match || !parsed || !Number.isFinite(parsed.getTime()) || dayKey(parsed) !== match[1])
        throw new Error('目前没有找到有效日期的纪念事件');
      await save({ ...entry, date: match[1], title: match[2], body: rest.join('\n') });
      return;
    }
    if (kind === 'diary' || kind === 'capsule' || kind === 'hollow') {
      await save({ ...entry, title: kind === 'diary' ? '今日记事' : recordNames[kind], body: content });
      return;
    }
    await save({ ...entry, title: first, body: rest.join('\n') }, undefined, signal);
  };
  const backfillTimeline = (date: string) => void run(async () => {
    if (!generateTimeline) return;
    const result = extractJson(await generateTimeline(
      '从提供的真实记录提取已经发生的事件，忽略假设、计划和重复事件。仅返回 JSON {"moments":[{"date":"YYYY-MM-DD","title":"事件","body":"事实摘要","tag":"日常"}]}，最多八条。', date,
    ));
    const entries: Entry[] = (Array.isArray(result?.moments) ? result.moments : []).slice(0, 8).flatMap((row: Record<string, unknown> | null) => {
      if (!row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
          typeof row.title !== 'string' || !row.title.trim() || typeof row.body !== 'string' || !row.body.trim()) return [];
      return [{ ...createEntry('timeline', row.title.trim().slice(0, 140), row.body.trim().slice(0, 1500), 'them'),
        date: row.date, timelineTag: timelineTags.find(tag => tag === row.tag) }];
    });
    if (!entries.length) throw new Error('没有找到可以补全的历史事件');
    let added = 0;
    await change(current => {
      const seen = new Set(current.entries.filter(row => row.kind === 'timeline').map(row => row.date + row.title));
      const unique = entries.filter(row => {
        const key = row.date + row.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      added = unique.length;
      return added ? { ...current, entries: [...current.entries, ...unique] } : current;
    });
    notify?.(added ? `已补全 ${added} 条回忆` : '这批回忆已经收录');
  });
  const deliverMail = (delivery: string) => void run(async () => {
    const controller = new AbortController();
    mailRequest.current = controller;
    const { signal } = controller;
    setMailDelivery(delivery);
    setFailedDelivery(undefined);
    const item = bond.entries.find(row => row.id === delivery && row.kind === 'mail');
    try {
      if (delivery === 'incoming') await generated(signal);
      else if (delivery === 'postman') {
        const result = extractJson(await generate('时光邮递员要送出一张默契问答卡。以角色身份给一个适合双方独立回答的开放问题和你自己的答案。只输出 JSON {"question":"问题","answer":"角色自己的答案"}。', signal));
        const question = typeof result?.question === 'string' ? result.question.trim() : '';
        const answer = typeof result?.answer === 'string' ? result.answer.trim() : '';
        if (!question || !answer) throw new Error('邮递员没有带回完整的问答，请重试');
        await save({ ...createEntry('mail', question.slice(0, 140), answer.slice(0, 10000), 'them'), mailMode: 'postman' }, undefined, signal);
      } else if (item) {
        const reply = (await generate(`请以角色身份回复时光信箱的问题。先独立作答，再考虑是否回应信中正文。\n主题：${item.title}\n正文：${item.body}`, signal)).trim();
        if (!reply) throw new Error('回信没有内容，请重试');
        await save({ ...item, reply }, item, signal);
      }
    } catch (error) {
      if (!signal.aborted) {
        setFailedDelivery(delivery);
        throw error;
      }
    } finally {
      mailRequest.current = undefined;
      setMailDelivery(undefined);
    }
  });
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

  const renderComposePaper = () => {
    if (!draft) return null;
    const date = <label className="couple-edit-date">日期<input type="date" required value={draft.date} onChange={event => patch({date:event.target.value})}/></label>;
    const person = <label className="couple-edit-person">记录者<select value={draft.side} onChange={event=>patch({side:event.target.value as Side})}>
      <option value="me">{names.me}</option><option value="them">{names.them}</option></select></label>;
    const title = <label className="couple-edit-title">{kind==='mail'?'信件主题':kind==='hollow'?'心事代号':'标题'}
      <input required maxLength={140} value={draft.title} placeholder={look.title} onChange={event=>patch({title:event.target.value})}/></label>;
    const note = <label className="couple-edit-note">{kind==='diary'?'日记内页':kind==='mail'?'信纸正文':'想记下的事'}
      <textarea maxLength={10000} value={draft.body} placeholder={look.body} onChange={event=>patch({body:event.target.value})}/></label>;
    const photo = <label className="couple-edit-photo">{kind==='gift'?'礼物照片':'这一页的照片'}
      <span className="couple-edit-photo-box">{draft.image?<TokenImg value={draft.image} alt="记录照片"/>:<span>＋ 添加照片</span>}</span>
      <input type="file" accept="image/*" disabled={working} onChange={event=>{
        const file = event.target.files?.[0];
        if (file) void run(async () => {
          if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024)
            throw new Error('请选择 12 MB 以内的图片');
          patch({image: await processImage(file, {maxWidth:720})});
        });
      }}/></label>;
    const steps = <div className="couple-compose-checklist"><strong>想一起完成的小步骤</strong>
      {(draft.steps??[]).map((step,index)=><div className="couple-compose-step" key={index}>
        <span className="couple-compose-step-bullet" aria-hidden>{step.done?'✓':''}</span>
        <input aria-label={'第'+(index+1)+'个步骤'} value={step.text} placeholder="一起完成的一件事"
          onChange={event=>patch({steps:(draft.steps??[]).map((v,i)=>i===index?{...v,text:event.target.value}:v)})}/>
        <button type="button" aria-label={'删除步骤'+(index+1)}
          onClick={()=>patch({steps:(draft.steps??[]).filter((_,i)=>i!==index)})}>×</button>
      </div>)}
      <button type="button" className="couple-compose-step-add"
        onClick={()=>patch({steps:[...(draft.steps??[]),{text:'',done:false}]})}>＋ 再写一个小步骤</button>
    </div>;
    const stickers = <div className="couple-diary-sticker-tray"><span>给日记角落做个标记</span>
      <div className="couple-diary-sticker-chips">
        {['♡','✦','☾','☼'].map(sticker=><button type="button" key={sticker}
          aria-pressed={!!draft.stickers?.includes(sticker)}
          onClick={()=>patch({stickers:draft.stickers?.includes(sticker)
            ?draft.stickers.filter(v=>v!==sticker):[...(draft.stickers??[]).filter(Boolean),sticker].slice(0,16)})}>{sticker}</button>)}
      </div>
    </div>;
    if(kind==='anniversary') return <div className="couple-edit-anniversary">
      <div className="couple-edit-anniversary-banner"><span>ONE MORE DAY TO REMEMBER</span>
        <div className="couple-edit-anniversary-date"><strong>{draft.date.slice(8,10)}</strong><span>{draft.date.slice(5,7)} / {draft.date.slice(0,4)}</span></div>
        <div className="couple-edit-anniversary-pair"><SceneAvatar value={avatarMe} name={names.me}/><span>♡</span><SceneAvatar value={avatarThem} name={names.them}/></div>
      </div><div className="couple-edit-anniversary-fields">{date}{title}{note}{photo}{person}</div>
    </div>;
    if(kind==='diary') return <div className="couple-edit-diary">
      <div className="couple-edit-diary-top"><span>MY PAGE · {draft.date}</span><strong>翻开今天的日记</strong></div>
      <div className="couple-edit-diary-contents">
        <div className="couple-edit-diary-left">{date}{person}{title}{note}</div>
        <div className="couple-edit-diary-right"><span>YOUR SIDE</span><small>{names.them} 的那一页，在原生交换日记中。</small>
          {onNativeJournal&&<button type="button" onClick={onNativeJournal}>打开原生日记 ↗</button>}</div>
      </div>{stickers}{photo}
    </div>;
    if(kind==='mail') return <div className="couple-edit-mail">
      <div className="couple-edit-mail-envelope"><span>POSTED WITH CARE</span>
        <div><small>FROM</small><strong>{names[draft.side]}</strong></div>
        <div><small>TO</small><strong>{names[draft.side==='me'?'them':'me']}</strong></div>
        <span className="couple-edit-mail-stamp">✳</span></div>
      <div className="couple-edit-mail-letter">{title}{note}<div className="couple-edit-mail-signature">{person}{date}</div></div>
    </div>;
    if(kind==='timeline') return <div className="couple-edit-timeline">
      <div className="couple-edit-timeline-date"><span>NEW MOMENT</span><strong>{draft.date.slice(8,10)}</strong><span>{draft.date.slice(5,7)} / {draft.date.slice(0,4)}</span></div>
      <div className="couple-edit-timeline-page">{title}{note}
        <label className="couple-edit-photo couple-timeline-upload">
          <span>事件照片 · 最多 6 张</span>
          <span className="couple-edit-photo-box">＋ 添加事件照片</span>
          <input aria-label="添加事件照片" type="file" accept="image/*" multiple disabled={working} onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (!files.length) return;
          void run(async () => {
            const existing = draft.images ?? (draft.image ? [draft.image] : []);
            if (existing.length + files.length > 6) throw new Error('每条回忆最多可保存 6 张照片');
            if (files.some(file => !file.type.startsWith('image/') || file.size > 12 * 1024 * 1024))
              throw new Error('每张照片须在 12 MB 以内');
            const images = await Promise.all(files.map(file => processImage(file, { maxWidth: 720 })));
            patch({ images: [...existing, ...images], image: undefined });
          });
        }} /></label>
        <div className="couple-timeline-photos">{(draft.images ?? (draft.image ? [draft.image] : [])).map((value, index, images) =>
          <div key={index}><TokenImg value={value} alt={`照片 ${index + 1}`} />
            <button type="button" disabled={working} onClick={() => patch({ images: images.filter((_, i) => i !== index), image: undefined })}>移除照片 {index + 1}</button></div>)}</div>
        <div className="couple-edit-timeline-by">{date}
          <label>时间<input type="time" step="1" value={draft.time ?? ''} onChange={event => patch({ time: event.target.value || undefined })}/></label>
          <label>事件标签<select value={draft.timelineTag ?? ''} onChange={event => patch({ timelineTag: timelineTags.find(tag => tag === event.target.value) })}>
            <option value="">无标签</option>{timelineTags.map(tag => <option key={tag}>{tag}</option>)}</select></label>{person}</div></div>
    </div>;
    if(kind==='wish') return <div className="couple-edit-wish">
      <div className="couple-edit-wish-paper"><span>WISH NO. {String(rows.length+1).padStart(2,'0')}</span>{title}{steps}{note}</div>
      <div className="couple-edit-wish-meta">
        <label>分类<select value={draft.wishCategory ?? 'other'} onChange={event => patch({ wishCategory: event.target.value as Entry['wishCategory'] })}>
          {Object.entries(wishCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label>计划标签<select value={draft.wishTag ?? ''} onChange={event => patch({ wishTag: (event.target.value || undefined) as Entry['wishTag'] })}>
          <option value="">无标签</option>
          {Object.entries(wishTags).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        {person}{date}
      </div>
    </div>;
    if(kind==='gift') return <div className="couple-edit-gift">
      <div className="couple-edit-gift-display"><span>FOR YOU</span>{photo}</div>
      <div className="couple-edit-gift-label">{title}{note}<div>{person}{date}</div></div>
    </div>;
    if(kind==='capsule') return <div className="couple-edit-capsule">
      <div className="couple-edit-capsule-header"><span>THE FUTURE AWAITS</span><strong>给未来的我们</strong><div className="couple-edit-capsule-seal">◉</div></div>
      {!draft.opened&&<div className="couple-edit-capsule-when">
        <label>约定拆封日<input required type="date" min={today} value={draft.unlockDate??''} onChange={event=>patch({unlockDate:event.target.value})}/></label>
        <div className="couple-segments" aria-label="快捷开启日期">{([[1,'一个月'],[6,'半年'],[12,'一年']] as const).map(([n,l])=>
          <button type="button" key={n} onClick={()=>patch({unlockDate:capsuleDate(n)})}>{l}</button>)}</div>
      </div>}
      <div className="couple-edit-capsule-message">{title}{note}<div>{person}{date}</div></div>
    </div>;
    return <div className="couple-edit-hollow">
      <div className="couple-edit-hollow-header"><span>SEALED · JUST FOR YOU</span><strong>写下不想说出口的事</strong><small>写完后，它会收进私人抽屉。</small></div>
      <div className="couple-edit-hollow-note">{note}{title}<div>{person}{date}</div></div>
    </div>;
  };
  const diaryPrefs = (<details className="couple-diary-pref-fold">
      <summary>写作设置 <span>⌄</span></summary>
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
    </details>);
  const hollowPrefs = (<details className="couple-hollow-pref-fold"><summary aria-label="树洞设置" title="树洞设置"><span aria-hidden="true">⚙</span></summary><div className="couple-hollow-pref-interior"><label>
      <input type="checkbox" checked={!!bond.hollowAuto} disabled={working} onChange={event => {
        const hollowAuto = event.target.checked;
        void run(() => change(current => ({ ...current, hollowAuto })));
      }} /> 允许角色在私聊后悄悄留下心事
    </label></div></details>);
  const deliveryStatus = (mailDelivery || failedDelivery) && <div className="couple-actions couple-record-tools" role="status">
    {mailDelivery ? <><span>信件正在寄送</span><button type="button" onClick={() => mailRequest.current?.abort()}>取消寄送</button></> : <button type="button" disabled={working || busy} onClick={() => deliverMail(failedDelivery!)}>重新寄送</button>}
  </div>;
  const sceneTools = kind === 'timeline' ? <div className="couple-record-tools">
    {generateTimeline && <details><summary>从聊天补全回忆</summary><p>也会参考已开放的日度总结。</p><div className="couple-actions">
      <label>指定日期 <input type="date" value={timelineDate} onChange={event => setTimelineDate(event.target.value)}/></label>
      <button type="button" disabled={working || busy || !timelineDate} onClick={() => backfillTimeline(timelineDate)}>补全当天</button>
      <button type="button" disabled={working || busy} onClick={() => backfillTimeline('*')}>批量补全近期</button>
    </div></details>}
    {!!rows.length && <details onToggle={event => {
      if (!event.currentTarget.open) setTimelineSelection(undefined);
    }}>
      <summary>管理回忆</summary>
      <div className="couple-actions">
        <button type="button" disabled={working} onClick={() => setTimelineSelection(rows.map(row => row.id))}>全选</button>
        <button type="button" disabled={working} onClick={() => setTimelineSelection([])}>取消全选</button>
        <button type="button" disabled={working || !timelineSelection?.length} onClick={() => {
          const selected = new Set(timelineSelection);
          if (!window.confirm(`删除选中的 ${selected.size} 条回忆？`)) return;
          void run(async () => {
            await change(current => ({ ...current, entries: current.entries.filter(item => item.kind !== 'timeline' || !selected.has(item.id)) }));
            setTimelineSelection(undefined);
          });
        }}>删除选中回忆</button>
      </div>
      <div className="couple-timeline-selection">{rows.map(row => <label key={row.id}>
        <input type="checkbox" checked={timelineSelection?.includes(row.id) ?? false} disabled={working} onChange={event => {
          const checked = event.target.checked;
          setTimelineSelection(current => checked ? [...(current ?? []), row.id] : current?.filter(id => id !== row.id));
        }}/>
        <span>{row.date} · {row.title}</span>
      </label>)}</div>
    </details>}
  </div> : kind === 'mail' ? <div className="couple-record-tools">
    <div className="couple-actions"><button type="button" disabled={working || busy} onClick={() => deliverMail('postman')}>请时光邮递员投递问答</button></div>
    {deliveryStatus}
    {bond.entries.some(row => row.kind === 'mail') && <details>
      <summary>管理信件</summary>
      <div className="couple-actions"><button type="button" disabled={working || busy} onClick={() => {
        const ids = new Set(bond.entries.filter(row => row.kind === 'mail').map(row => row.id));
        if (!window.confirm(`永久删除信箱里的 ${ids.size} 封信件？`)) return;
        void run(async () => {
          await change(current => ({ ...current, entries: current.entries.filter(row => row.kind !== 'mail' || !ids.has(row.id)) }));
          setFailedDelivery(undefined);
        });
      }}>清空时光信箱</button></div>
    </details>}
  </div> : undefined;
  return <div ref={recordsView} className={'couple-records couple-records-' + kind + (draft ? ' couple-records-editing' : '') + (activeRecordId ? ' couple-records-detail' : '')}>
    {!draft && !activeRecordId && <CoupleScene kind={kind} bond={bond} names={names} rows={rows} today={today}
      avatarMe={avatarMe} avatarThem={avatarThem} charId={charId} onNativeJournal={onNativeJournal}
      filter={filter} onFilter={setFilter} totalRecords={bond.entries.filter(item => item.kind === kind).length} focusRecordId={lastSavedRecordId}
      diaryPrefs={diaryPrefs} hollowPrefs={hollowPrefs} tools={sceneTools}
      glowingRecordId={lastGlowingRecordId}
      onWishToggle={entry => void run(async () => {
        await save({ ...entry, done: !entry.done }, entry);
        setLastGlowingRecordId(entry.done ? undefined : entry.id);
      })}
      onNew={() => { rememberListPosition(); draftSource.current = undefined; setDraft(newEntry()); }} onAI={() => kind === 'mail' ? deliverMail('incoming') : void run(generated)} busy={working || busy}
      onJump={id => { rememberListPosition(); setActiveRecordId(id); setReplyDraft(undefined); }} />}
    {!draft && activeRecordId && <button type="button" className="couple-record-detail-back" onClick={() => { setActiveRecordId(undefined); setReplyDraft(undefined); }}>‹ 返回{recordNames[kind]}</button>}
    {error && <p role="alert" className="couple-error">{error}</p>}
    {draft && <form className={'couple-card couple-compose couple-compose-' + kind} onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        const title = draft.title.trim();
        if (!title) return;
        const record = { ...draft, title, body: draft.body.trim() };
        await save(record, draftSource.current);
        if (kind === 'wish' && filter !== 'all' && (record.wishCategory ?? 'other') !== filter) setFilter('all');
        setDraft(undefined);
        setActiveRecordId(undefined);
      });
    }}>
      {renderComposePaper()}
      <div className="couple-compose-buttons">
        <button className="couple-primary" disabled={working}>{({
          timeline: '收藏这一刻', anniversary: '记住这一天', diary: '合上这页日记', wish: '贴上愿望纸',
          gift: '收藏这份心意', mail: '把信寄出去', capsule: '封进时间胶囊', hollow: '收进我的树洞',
        } as Record<EntryKind, string>)[kind]}</button>
        <button type="button" onClick={() => setDraft(undefined)}>取消</button>
      </div>
    </form>}

    {!draft && bond.entries.filter(item => item.kind === kind && item.id === activeRecordId).map(item => {
      const state = kind === 'capsule' ? capsuleStatus(item, today) : undefined;
      const sealed = state === 'ready' || state === 'sealed';
      return <article className={'couple-card couple-record-entry couple-entry-' + kind + (item.done ? ' couple-entry-completed' : '')} key={item.id} id={`bond-entry-${item.id}`}>
        <CoupleDetailHeading kind={kind} entry={item} names={names} avatarMe={avatarMe} avatarThem={avatarThem} today={today}/>
        {state && <span className="couple-status" data-state={state}>
          {state === 'ready' ? '可以拆封' : state === 'sealed' ? '封存中' : item.openedEarly ? '提前拆封' : '已拆封'}
        </span>}
        {sealed ? <>
          <p>{item.unlockDate ? item.unlockDate + ' 开启' : '此信未设置拆封日期，需主动确认才能打开。'}</p>
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
              if (window.confirm('删除这封尚未拆开的信？')) void run(async () => {
                 await change(current => ({ ...current, entries: current.entries.filter(row => row.id !== item.id) }));
                 setEarlyId(undefined);
                 setActiveRecordId(undefined);
               });
            }}>删除</button>
          </div>}
        </> : <>
          {kind === 'timeline' && item.timelineTag && <span className="couple-status">{item.timelineTag}{item.time && ' · ' + item.time}</span>}
          {!!item.images?.length && <div className="couple-timeline-photos">{item.images.map((value, index) => <TokenImg key={index} value={value} alt={`回忆照片 ${index + 1}`} />)}</div>}
          {item.image && kind !== 'gift' && <TokenImg value={item.image} alt={item.title} className="couple-record-image" />}
          <div className={'couple-detail-body couple-detail-body-' + kind}><p>{item.mailMode === 'postman' && !item.reply
            ? '写下自己的答案后，就能看到对方怎么回答。' : item.body}</p></div>
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
                void run(() => save({ ...item, stickerPositions }, item));
              }}>{sticker}</button>)}
          </div>}
          {item.reply && <p className="couple-reply">{names[item.side === 'me' ? 'them' : 'me']}回信 · {item.reply}</p>}
          {item.steps?.filter(step => step.text.trim()).map((step, index) => <label key={index}>
            <input type="checkbox" checked={step.done} disabled={working} onChange={event => {
              const done = event.target.checked;
              void run(() => save({ ...item, steps: item.steps?.filter(value => value.text.trim()).map((value, i) => i === index ? { ...value, done } : value) }, item));
            }} /> {step.text}
          </label>)}
          <div className="couple-actions">
            {item.mailMode !== 'postman' && <button disabled={working} onClick={() => { draftSource.current = item; setDraft(item); }}>编辑</button>}
            {(kind === 'wish' || kind === 'hollow') && <button disabled={working} onClick={() => void run(() => save({ ...item, done: !item.done }, item))}>
              {item.done ? '重新打开' : kind === 'wish' ? '标记完成' : '标记已解决'}
            </button>}
            {kind === 'wish' && <button disabled={working} onClick={() => void run(() => save({ ...item, pinned: !item.pinned }, item))}>{item.pinned ? '取消置顶' : '置顶'}</button>}
            {(kind === 'mail' || kind === 'diary' || kind === 'capsule') && !(item.mailMode === 'postman' && item.reply) && <button disabled={working || busy} onClick={() => {
              if (item.side === 'them') {
                setReplyDraft({ id: item.id, text: item.reply ?? '', source: item });
              } else if (kind === 'mail') deliverMail(item.id);
              else void run(async () => save({ ...item, reply: await generate(`请以角色身份回复这份${recordNames[kind]}。\n标题：${item.title}\n内容：${item.body}`) }, item));
            }}>{item.reply ? '重写回信' : item.mailMode === 'postman' ? '回答并揭晓' : '回信'}</button>}
            {(kind === 'mail' || kind === 'capsule') && share && (item.mailMode !== 'postman' || item.reply) && <button disabled={working} onClick={() => void run(() => share(`【${recordNames[kind]}】${item.title}\n${item.body}${item.reply ? `\n回信：${item.reply}` : ''}`, recordNames[kind]))}>分享到私聊</button>}
            <button disabled={working} onClick={() => {
              if (window.confirm('删除这条记录？')) void run(async () => {
                 await change(current => ({ ...current, entries: current.entries.filter(row => row.id !== item.id) }));
                 setReplyDraft(undefined);
                 setActiveRecordId(undefined);
               });
            }}>删除</button>
          </div>
        </>}
        {kind === 'mail' && deliveryStatus}
        {replyDraft?.id === item.id && <form className="couple-letter-reply-form" onSubmit={event => {
          event.preventDefault();
          const reply = replyDraft.text.trim();
          if (!reply) return;
          void run(async () => { await save({ ...replyDraft.source, reply }, replyDraft.source); setReplyDraft(undefined); });
        }}>
          <span>REPLY / {names.me}</span>
          <label>写给 {names.them}
            <textarea required maxLength={10000} value={replyDraft.text}
              onChange={event => setReplyDraft({ ...replyDraft, text: event.target.value })}
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
