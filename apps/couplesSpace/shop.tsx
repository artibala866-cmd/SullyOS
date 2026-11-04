import React, { useState } from 'react';
import { cardMatchesRelation, exchangeCard, playCard, reward, shopCards, dayKey, relationNames, type Bond, type Card, type Side } from '../../utils/couplesSpace';
import type { ChangeBond, Generate } from './records';
import { extractJson } from '../../utils/safeApi';

const tabs = { shop: '商店', bag: '卡包', tasks: '任务', grand: '大奖' };
export const bondAchievements = (bond: Bond, days: number) => [
  { title: '七日之约', count: days, goal: 7 },
  { title: '百日纪念', count: days, goal: 100 },
  { title: '一载春秋', count: days, goal: 365 },
  { title: '定格好日子', count: bond.entries.filter(row => row.kind === 'anniversary').length, goal: 3 },
  { title: '小小心愿', count: bond.entries.filter(row => row.kind === 'wish' && row.done).length, goal: 1 },
  { title: '愿望成真', count: bond.entries.filter(row => row.kind === 'wish' && row.done).length, goal: 5 },
  { title: '把心意收好', count: bond.entries.filter(row => row.kind === 'gift').length, goal: 10 },
  { title: '邮差来过', count: bond.entries.filter(row => row.kind === 'mail' && row.reply).length, goal: 5 },
  { title: '默契触碰', count: bond.touches, goal: 100 },
  { title: '隐藏成就', count: bond.plant.careCount, goal: 30, secret: '一起种春天' },
];

export function BondShop({ bond, partner, change, generate, share, busy }: {
  bond: Bond; partner: string; change: ChangeBond; generate: Generate; share: (content: string, label: string) => Promise<void>; busy: boolean;
}) {
  const [tab, setTab] = useState<keyof typeof tabs>('shop');
  const [manage, setManage] = useState(false);
  const [draft, setDraft] = useState<Card>();
  const [wish, setWish] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const cards = [...shopCards, ...bond.cards];
  const [shelf, setShelf] = useState<'general' | 'relation' | 'custom'>('general');
  const visibleCards = (shelf === 'custom' ? bond.cards : shopCards.filter(card => shelf === 'general' ? !card.relation : card.relation === bond.relation))
    .filter(card => manage || !bond.hidden.includes(card.id));
  const run = async (task: () => Promise<void>) => {
    setError('');
    setWorking(true);
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setWorking(false); }
  };
  const apply = (update: (current: Bond) => Bond) => void run(() => change(update));
  const decidePact = async () => {
    const pact = bond.pact;
    if (!pact || pact.status !== 'pending') return;
    const response = extractJson(await generate(`对方用全部共同积分兑换了一个愿望：${pact.wish}。按角色性格与当前关系独立选择接受或婉拒。只返回 JSON {"accept":true或false,"reply":"角色自己的回答"}。`));
    if (typeof response?.accept !== 'boolean' || typeof response?.reply !== 'string' || !response.reply.trim())
      throw new Error('未读到明确回应，可以重试');
    await change(current => {
      if (current.pact?.status !== 'pending' || current.pact.wish !== pact.wish || current.pact.spent !== pact.spent) return current;
      return {
        ...current, pact: { ...pact, status: response.accept ? 'accepted' : 'declined', response: response.reply.trim() },
        points: { ...current.points, shared: current.points.shared + (response.accept ? 0 : Math.floor(pact.spent / 2)) },
      };
    });
  };
  const removeCard = (card: Card) => {
    if (!window.confirm('删除自订卡？双方卡包中的库存会按卡价退回积分。')) return;
    apply(current => {
      const original = current.cards.find(item => item.id === card.id);
      if (!original) return current;
      const { [card.id]: me = 0, ...myBag } = current.bags.me;
      const { [card.id]: them = 0, ...theirBag } = current.bags.them;
      return {
        ...current, cards: current.cards.filter(item => item.id !== card.id), bags: { me: myBag, them: theirBag },
        points: { ...current.points, me: current.points.me + me * original.price, them: current.points.them + them * original.price },
        played: current.played.filter(play => play.card.id !== card.id), hidden: current.hidden.filter(id => id !== card.id),
      };
    });
  };
  return <>
    <div className="couple-score">
      <span><b>{bond.points.me}</b>我的积分</span>
      <span><b>{bond.points.shared}</b>共同积分</span>
      <span><b>{bond.points.them}</b>{partner}的积分</span>
    </div>
    <details className="couple-card couple-shop-settings">
      <summary>出牌设置 <small>{bond.disabledCards ? '已关闭' : bond.autoCards ? '允许角色出牌' : '手动出牌'}</small></summary>
      <label><input type="checkbox" disabled={working} checked={!bond.disabledCards} onChange={event => {
        const disabledCards = !event.target.checked;
        apply(current => ({ ...current, disabledCards }));
      }} /> 启用羁绊卡</label>
      <label><input type="checkbox" disabled={working} checked={!!bond.noCooldown} onChange={event => {
        const noCooldown = event.target.checked;
        apply(current => ({ ...current, noCooldown }));
      }} /> 解除角色出牌冷却</label>
      <label><input type="checkbox" disabled={working || bond.disabledCards} checked={!!bond.autoCards} onChange={event => {
        const autoCards = event.target.checked;
        apply(current => ({ ...current, autoCards }));
      }} /> 允许角色在私聊后自行兑换和出牌</label>
      {!bond.noCooldown && <small>角色出牌间隔 90 分钟，同一张卡间隔 6 小时。</small>}
    </details>
    <nav className="couple-segments" aria-label="商店页面">{Object.entries(tabs).map(([key, label]) =>
      <button key={key} aria-pressed={tab === key} onClick={() => { setTab(key as keyof typeof tabs); setDraft(undefined); }}>{label}</button>)}</nav>
    {error && <p role="alert" className="couple-error">{error}</p>}
    {tab === 'shop' && <>
      <div className="couple-actions">
        <button aria-pressed={manage} onClick={() => setManage(!manage)}>管理卡片</button>
        <button onClick={() => setDraft({ id: crypto.randomUUID(), icon: '✧', name: '', effect: '', price: 30, charUse: false })}>自订卡</button>
        {manage && <button disabled={working || !bond.hidden.length} onClick={() => apply(current => ({ ...current, hidden: [] }))}>全部放回</button>}
      </div>
      {draft && <form className="couple-card" onSubmit={event => {
        event.preventDefault();
        const card = { ...draft, name: draft.name.trim(), effect: draft.effect.trim() };
        if (!card.name || !card.effect || !Number.isSafeInteger(card.price) || card.price < 1) return;
        void run(async () => {
          await change(current => ({ ...current, cards: [...current.cards.filter(item => item.id !== card.id), card] }));
          setDraft(undefined);
        });
      }}>
        <label>图标<input maxLength={8} value={draft.icon} onChange={event => setDraft({ ...draft, icon: event.target.value })} /></label>
        <label>名称<input required maxLength={60} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>出牌效果<textarea required maxLength={500} value={draft.effect} onChange={event => setDraft({ ...draft, effect: event.target.value })} /></label>
        <label>积分价格<input type="number" min={1} max={10000} required value={draft.price || ''} onChange={event => setDraft({ ...draft, price: Number(event.target.value) })} /></label>
        <label>效果类型<select value={draft.voucher ? 'voucher' : draft.turns ? 'turns' : 'once'} onChange={event => setDraft({
          ...draft, voucher: event.target.value === 'voucher', turns: event.target.value === 'turns' ? 3 : undefined,
        })}><option value="once">当下回应</option><option value="turns">持续几轮</option><option value="voucher">兑换券</option></select></label>
        {draft.turns && <label>持续轮数<input type="number" min={1} max={20} value={draft.turns} onChange={event => setDraft({ ...draft, turns: Math.max(1, Number(event.target.value)) })} /></label>}
        <label><input type="checkbox" checked={draft.charUse} onChange={event => setDraft({ ...draft, charUse: event.target.checked })} /> 角色可用</label>
        <div className="couple-actions"><button disabled={working}>保存</button><button type="button" onClick={() => setDraft(undefined)}>取消</button></div>
      </form>}
      <nav className="couple-segments" aria-label="卡片分类">
        {([['general', '通用'], ['relation', relationNames[bond.relation]], ['custom', '自订']] as const).map(([id, title]) =>
          <button key={id} aria-pressed={shelf === id} onClick={() => setShelf(id)}>{title}</button>)}
      </nav>
      {!visibleCards.length && <p className="couple-muted">这个分类暂时没有可展示的卡片。</p>}
      {visibleCards.map(card => <article key={card.id} className="couple-card couple-shop-card">
        <h3>{card.icon} {card.name}</h3><p>{card.effect}</p><small>{card.price} 积分{card.charUse ? ' · 双方可用' : ' · 仅我可用'}</small>
        <div className="couple-actions">{manage ? <>
          <button disabled={working} onClick={() => apply(current => ({
            ...current, hidden: current.hidden.includes(card.id) ? current.hidden.filter(id => id !== card.id) : [...current.hidden, card.id],
          }))}>{bond.hidden.includes(card.id) ? '放回' : '隐藏'}</button>
          {bond.cards.some(custom => custom.id === card.id) && <>
            <button onClick={() => setDraft(card)}>编辑</button><button disabled={working} onClick={() => removeCard(card)}>删除</button>
          </>}
        </> : <button disabled={working || bond.disabledCards || bond.points.me < card.price} onClick={() => apply(current => {
          const currentCard = [...shopCards, ...current.cards].find(item => item.id === card.id);
          if (!currentCard || !cardMatchesRelation(currentCard, current.relation)) throw new Error('这张卡在当前关系中不可兑换');
          return exchangeCard(current, currentCard, 'me');
        })}>兑换</button>}</div>
      </article>)}
    </>}
    {tab === 'bag' && <>
      {(['me', 'them'] as Side[]).map(side => <section key={side} className="couple-card">
        <h3>{side === 'me' ? '我的卡包' : `${partner}的卡包`}</h3>
        {!Object.values(bond.bags[side]).some(Boolean) && <p className="couple-muted">卡包是空的。</p>}
        {cards.filter(card => bond.bags[side][card.id]).map(card => <div key={card.id} className="couple-split">
          <span>{card.icon} {card.name} × {bond.bags[side][card.id]}</span>
          {side === 'me' && <button disabled={working || bond.disabledCards || bond.hidden.includes(card.id)} onClick={() => {
            const note = window.prompt('出牌留言（可留空）', '');
            if (note === null) return;
            void run(async () => {
              await change(current => {
                const currentCard = [...shopCards, ...current.cards].find(item => item.id === card.id);
                if (!currentCard) throw new Error('卡片已删除');
                return playCard(current, currentCard, 'me', note.trim());
              });
              await share(`【${card.name}】${note.trim() || card.effect}`, '我的出牌');
            });
          }}>打出</button>}
        </div>)}
      </section>)}
      <section className="couple-card"><h3>出牌记录</h3>{bond.played.slice(-10).reverse().map((play, index) =>
        <p key={index}>{play.side === 'me' ? '我' : partner}打出「{play.card.name}」{play.note ? ` · ${play.note}` : ''}</p>)}</section>
    </>}
    {tab === 'tasks' && [
      { id: `care:${dayKey()}`, text: '今天照料盆栽', ready: dayKey(new Date(bond.plant.watered)) === dayKey() && bond.plant.careCount > 0, amount: 25 },
      { id: `diary:${dayKey()}`, text: '写下今天的日记', ready: bond.entries.some(item => item.kind === 'diary' && item.side === 'me' && item.date === dayKey()), amount: 35 },
      { id: 'first-wish', text: '完成第一个共同愿望', ready: bond.entries.some(item => item.kind === 'wish' && item.done), amount: 100 },
      { id: 'first-letter', text: '交换第一封时光信', ready: bond.entries.some(item => item.kind === 'mail' && item.reply), amount: 60 },
    ].map(task => <div className="couple-card couple-split" key={task.id}>
      <span>{task.text} · {task.amount} 积分</span>
      <button disabled={working || !task.ready || bond.claims.includes(task.id)} onClick={() => apply(current => reward(current, task.id, task.amount))}>
        {bond.claims.includes(task.id) ? '已领取' : '领取'}
      </button>
    </div>)}
    {tab === 'grand' && <section className="couple-card">
      <h3>终极大奖</h3><p>满 3000 共同积分后，可以用全部共同积分兑换一个愿望。对方婉拒会退回一半。</p>
      <progress max={3000} value={Math.min(bond.points.shared, 3000)} /> <small>{bond.points.shared} / 3000</small>
      {bond.pact && <p>{bond.pact.wish} · {({ pending: '待回应', accepted: '已接受', declined: '已婉拒', done: '已兑现' })[bond.pact.status]}{bond.pact.response && `\n${bond.pact.response}`}</p>}
      {bond.pact?.status === 'pending' ? <button disabled={working || busy} onClick={() => void run(decidePact)}>请 {partner} 回应</button>
        : bond.pact?.status === 'accepted' ? <button disabled={working} onClick={() => apply(current => current.pact?.status === 'accepted' ? {
          ...current, pact: { ...current.pact, status: 'done' },
        } : current)}>标记已兑现</button> : <>
          <label>愿望<textarea value={wish} maxLength={500} onChange={event => setWish(event.target.value)} /></label>
          <button disabled={working || bond.points.shared < 3000 || !wish.trim()} onClick={() => {
            if (window.confirm('用全部共同积分兑换这个愿望？')) apply(current => {
              if (current.points.shared < 3000 || current.pact?.status === 'pending' || current.pact?.status === 'accepted') throw new Error('当前不可兑换');
              return { ...current, points: { ...current.points, shared: 0 }, pact: { wish: wish.trim(), spent: current.points.shared, status: 'pending' } };
            });
          }}>兑换终极大奖</button>
        </>}
    </section>}
  </>;
}
