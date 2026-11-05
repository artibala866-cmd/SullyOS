import React, { useRef, useState } from 'react';
import { cardMatchesRelation, exchangeCard, playCard, reward, rolePointStats, shopCards, dayKey, relationNames, type Bond, type Card, type Side } from '../../utils/couplesSpace';
import type { ChangeBond, Generate } from './records';
import { extractJson } from '../../utils/safeApi';
import { useLocalDateKey } from '../../hooks/useLocalDateKey';

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

export function BondShop({ bond, partner, change, generate, share, busy, notify }: {
  bond: Bond; partner: string; change: ChangeBond; generate: Generate; share: (content: string, label: string, deliveryId?: string) => Promise<void>; busy: boolean;
  notify?: (message: string) => void;
}) {
  const [tab, setTab] = useState<keyof typeof tabs>('shop');
  const today = useLocalDateKey();
  const [manage, setManage] = useState(false);
  const [draft, setDraft] = useState<Card>();
  const [wish, setWish] = useState('');
  const [working, setWorking] = useState(false);
  const operationRef = useRef(false);
  const [error, setError] = useState('');
  const cards = [...shopCards, ...bond.cards];
  const [shelf, setShelf] = useState<'general' | 'relation' | 'custom'>('general');
  const visibleCards = (shelf === 'custom' ? bond.cards : shopCards.filter(card => shelf === 'general' ? !card.relation : card.relation === bond.relation))
    .filter(card => manage || !bond.hidden.includes(card.id));
  const run = async (task: () => Promise<void>) => {
    if (operationRef.current || busy) return;
    operationRef.current = true;
    setError('');
    setWorking(true);
    try { await task(); } catch (e) {
      const message = e instanceof Error ? e.message : '操作失败';
      setError(message);
      notify?.(message);
    }
    finally { operationRef.current = false; setWorking(false); }
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
        ...(them ? { rolePointStats: { ...rolePointStats(current), refunded: rolePointStats(current).refunded + them * original.price } } : {}),
        played: current.played.filter(play => play.card.id !== card.id), hidden: current.hidden.filter(id => id !== card.id),
      };
    });
  };

  const [activeIndex, setActiveIndex] = useState(0);
  const [bagOwner, setBagOwner] = useState<Side>('me');
  const [bagIndex, setBagIndex] = useState(0);
  const [cardMotion, setCardMotion] = useState<'none' | 'issuing'>('none');
  const [stampedId, setStampedId] = useState<string | null>(null);
  const swipeX = useRef<number | null>(null);
  const activeCard = visibleCards[Math.min(activeIndex, Math.max(visibleCards.length - 1, 0))];
  const bagCards = cards.filter(card => (bond.bags[bagOwner][card.id] ?? 0) > 0);
  const activeBagCard = bagCards[Math.min(bagIndex, Math.max(0, bagCards.length - 1))];
  const shopMove = (delta: number) => setActiveIndex(current =>
    Math.max(0, Math.min(visibleCards.length - 1, current + delta)));
  const bagMove = (delta: number) => setBagIndex(current =>
    Math.max(0, Math.min(bagCards.length - 1, current + delta)));

  // Delay the ledger change until the ticket has visibly moved into the slot.
  // The existing exchangeCard transaction is still the only inventory/point writer.
  const issueCard = (card: Card) => void run(async () => {
    setCardMotion('issuing');
    try {
      await new Promise<void>(resolve => window.setTimeout(resolve, 520));
      await change(current => {
        const actual = [...shopCards, ...current.cards].find(item => item.id === card.id);
        if (!actual || !cardMatchesRelation(actual, current.relation))
          throw new Error('这张卡在当前关系中不可兑换');
        return exchangeCard(current, actual, 'me');
      });
      setBagOwner('me');
      setBagIndex(0);
      setTab('bag');
      notify?.('已收入卡包');
    } finally { setCardMotion('none'); }
  });

  const playOwnedCard = (card: Card) => {
    const note = window.prompt('出牌留言（可留空）', '');
    if (note === null) return;
    void run(async () => {
      let playId: string | undefined;
      await change(current => {
        const currentCard = [...shopCards, ...current.cards].find(item => item.id === card.id);
        if (!currentCard) throw new Error('卡片已删除');
        const updated = playCard(current, currentCard, 'me', note.trim());
        playId = updated.played.at(-1)?.id;
        return updated;
      });
      try {
        await share('【' + card.name + '】' + (note.trim() || card.effect), '我的出牌', 'couples-play:' + playId);
        setStampedId(card.id);
        window.setTimeout(() => setStampedId(current => current === card.id ? null : current), 1100);
      } catch (error) {
        let refunded = false;
        try {
          await change(current => {
            if (!playId || !current.played.some(play => play.id === playId)) return current;
            refunded = true;
            return { ...current,
              played: current.played.filter(play => play.id !== playId),
              bags: { ...current.bags, me: {
                ...current.bags.me, [card.id]: (current.bags.me[card.id] ?? 0) + 1,
              } },
            };
          });
        } catch {
          throw new Error('消息发送失败，卡片返还状态未确认，请检查卡包后重试');
        }
        throw new Error(refunded ? '消息未发出，卡片已退回卡包。请检查私聊状态。' :
          '消息发送失败，卡片状态已变化，请检查卡包');
      }
    });
  };

  return <div className="bond-ticket-room" data-shop-view={tab}>
    <section className="bond-ticket-top" aria-label="羁绊积分">
      <div className="bond-ticket-top-title"><span>两个人的票券所</span><h2>羁绊商店</h2></div>
      <div className="bond-ticket-ledger">
        <div className="bond-ticket-ledger-main"><span>我的积分</span><strong>{bond.points.me}</strong></div>
        <div className="bond-ticket-ledger-other">
          <span>共同 <b>{bond.points.shared}</b></span>
          <span>{partner} <b>{bond.points.them}</b></span>
        </div>
      </div>
    </section>
    <nav className="bond-ticket-tabs" aria-label="羁绊商店区域">
      {Object.entries(tabs).map(([key, label]) =>
        <button key={key} type="button" disabled={working || busy} aria-pressed={tab === key}
          onClick={() => { setTab(key as keyof typeof tabs); setDraft(undefined); setActiveIndex(0); setBagIndex(0); }}>
          <span className="bond-ticket-tab-mark" aria-hidden="true">{({shop: '⌑', bag: '▣', tasks: '✓', grand: '✧'} as Record<string,string>)[key]}</span>
          {label}
        </button>)}
    </nav>
    {error && <p role="alert" className="couple-error bond-ticket-alert">{error}</p>}

    {tab === 'shop' && <section className="bond-ticket-counter">
      <div className="bond-ticket-controls">
        <nav className="bond-ticket-shelves" aria-label="卡券分类">
          {([['general','通用'],['relation',relationNames[bond.relation]],['custom','自订']] as const).map(([id,label])=>
            <button type="button" key={id} disabled={working || busy} aria-pressed={shelf === id}
              onClick={() => { setShelf(id); setActiveIndex(0); }}>{label}</button>)}
        </nav>
        <div className="bond-ticket-utilities">
          <button type="button" disabled={working || busy} aria-label="制作自订卡" onClick={() => setDraft({ id: crypto.randomUUID(), icon: '✧', name: '', effect: '', price: 30, charUse: false })}>＋</button>
          <button type="button" disabled={working || busy} aria-label="管理卡券" aria-pressed={manage} onClick={() => setManage(current=>!current)}>⋯</button>
        </div>
      </div>
      {manage && <div className="bond-ticket-manage-note"><span>卡券整理</span>
        <button type="button" disabled={working || busy || !bond.hidden.length} onClick={() => apply(current => ({ ...current, hidden: [] }))}>全部放回</button>
      </div>}
          {draft && <form className="couple-card couple-shop-editor" onSubmit={event => {
            event.preventDefault();
            const card = { ...draft, name: draft.name.trim(), effect: draft.effect.trim() };
            if (!card.name || !card.effect || !Number.isSafeInteger(card.price) || card.price < 1) return;
            void run(async () => {
              await change(current => {
                const oldCard = current.cards.find(item => item.id === card.id);
                const inventory = (current.bags.me[card.id] ?? 0) + (current.bags.them[card.id] ?? 0);
                // A price change with held stock would allow profit on deletion refunds.
                if (oldCard && oldCard.price !== card.price && inventory > 0)
                  throw new Error('双方卡包仍有这张卡，使用或删除库存后才能修改价格');
                if (!Number.isSafeInteger(card.price) || card.price < 1 || card.price > 10_000)
                  throw new Error('卡片价格需要在 1～10000 积分之间');
                return { ...current, cards: [...current.cards.filter(item => item.id !== card.id), card] };
              });
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
    
      {activeCard ? <div className="bond-ticket-showcase" onTouchStart={event => { swipeX.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={event => { const x=swipeX.current; swipeX.current=null;
          if(x===null || working || busy) return;
          const dx=(event.changedTouches[0]?.clientX ?? x)-x;
          if(Math.abs(dx)>42) shopMove(dx<0?1:-1); }}>
        <div className="bond-ticket-counter-trim" aria-hidden="true"><span /><span /><span /><span /><span /></div>
        <div className="bond-ticket-stack" data-motion={cardMotion}>
          <div className="bond-ticket-stack-back bond-ticket-stack-back-two" aria-hidden="true" />
          <div className="bond-ticket-stack-back bond-ticket-stack-back-one" aria-hidden="true" />
          <article key={activeCard.id} className="bond-ticket-pass" aria-label={activeCard.name + '，' + activeCard.price + '积分'}>
            <div className="bond-ticket-pass-head">
              <span className="bond-ticket-series">NO. {String(activeIndex+1).padStart(2,'0')} <i> / {String(visibleCards.length).padStart(2,'0')}</i></span>
              <span className="bond-ticket-pass-icon" aria-hidden="true">{activeCard.icon || '✧'}</span>
            </div>
            <div className="bond-ticket-pass-center">
              <h3>{activeCard.name}</h3>
              <p>{activeCard.effect}</p>
            </div>
            <div className="bond-ticket-perforation" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
            <div className="bond-ticket-pass-foot">
              <div className="bond-ticket-pass-terms"><span>{activeCard.charUse ? '双人通用' : '仅我可用'}</span><strong>{activeCard.price}<small> PTS</small></strong></div>
              {manage ? <div className="bond-ticket-pass-actions">
                <button disabled={working || busy} onClick={() => apply(current => ({ ...current, hidden: current.hidden.includes(activeCard.id)
                  ? current.hidden.filter(id => id !== activeCard.id) : [...current.hidden, activeCard.id] }))}>
                  {bond.hidden.includes(activeCard.id) ? '放回' : '隐藏'}</button>
                {bond.cards.some(c => c.id === activeCard.id) && <>
                  <button disabled={working || busy} onClick={() => setDraft(activeCard)}>编辑</button>
                  <button disabled={working || busy} onClick={() => removeCard(activeCard)}>删除</button>
                </>}
              </div> : <button className="bond-ticket-buy" type="button"
                disabled={working || busy || bond.disabledCards || bond.points.me < activeCard.price} onClick={() => issueCard(activeCard)}>
                {bond.disabledCards ? '已停用' : bond.points.me < activeCard.price ? '积分不足' : '兑换这张券'} <span aria-hidden="true">↗</span>
              </button>}
            </div>
          </article>
        </div>
        <div className="bond-ticket-slot" aria-hidden="true"><span /></div>
        <div className="bond-ticket-navigator">
          <button type="button" aria-label="上一张卡券" disabled={working || busy || activeIndex<=0} onClick={() => shopMove(-1)}>‹</button>
          <span>{String(activeIndex+1).padStart(2,'0')} <i>/</i> {String(visibleCards.length).padStart(2,'0')}</span>
          <button type="button" aria-label="下一张卡券" disabled={working || busy || activeIndex>=visibleCards.length-1} onClick={() => shopMove(1)}>›</button>
        </div>
      </div> : <div className="bond-ticket-empty">
        <div className="bond-ticket-empty-cut" aria-hidden="true">✧</div>
        <strong>这里还没有票券</strong>
        <button type="button" disabled={working || busy} onClick={() => setDraft({ id: crypto.randomUUID(), icon: '✧', name: '', effect: '', price: 30, charUse: false })}>制作一张</button>
      </div>}
    </section>}

    {tab === 'bag' && <section className="bond-ticket-wallet">
      <div className="bond-ticket-wallet-top">
        <div><small>收纳夹</small><h3>我的卡包</h3></div>
        <nav className="bond-ticket-wallet-switch" aria-label="查看谁的卡包">
          <button type="button" aria-pressed={bagOwner==='me'} onClick={() => { setBagOwner('me');setBagIndex(0); }}>我的</button>
          <button type="button" aria-pressed={bagOwner==='them'} onClick={() => { setBagOwner('them');setBagIndex(0); }}>{partner}</button>
        </nav>
      </div>
      <div className="bond-ticket-wallet-pocket">
        <div className="bond-ticket-wallet-stitched" aria-hidden="true"/>
        {activeBagCard ? <div className="bond-ticket-wallet-contents">
          <div className="bond-ticket-wallet-pass" key={activeBagCard.id} data-stamped={stampedId===activeBagCard.id}>
            <div className="bond-ticket-wallet-pass-head"><span>PRIVATE PASS</span><span>{activeBagCard.icon || '✧'}</span></div>
            <strong>{activeBagCard.name}</strong><p>{activeBagCard.effect}</p>
            <div className="bond-ticket-wallet-pass-rule" aria-hidden="true" />
            <div className="bond-ticket-wallet-pass-foot"><span>库存 × {bond.bags[bagOwner][activeBagCard.id]}</span>
              {bagOwner==='me' && <button type="button" disabled={working || busy || bond.disabledCards || bond.hidden.includes(activeBagCard.id)} onClick={() => playOwnedCard(activeBagCard)}>使用卡券 ↗</button>}
            </div>
            <div className="bond-ticket-wallet-stamp" aria-hidden="true">USED</div>
          </div>
          <div className="bond-ticket-wallet-paging">
            <button type="button" disabled={bagIndex<=0} onClick={() => bagMove(-1)} aria-label="上一张已拥有的票券">‹</button>
            <span>{bagIndex+1} / {bagCards.length}</span>
            <button type="button" disabled={bagIndex>=bagCards.length-1} onClick={() => bagMove(1)} aria-label="下一张已拥有的票券">›</button>
          </div>
          <div className="bond-ticket-wallet-thumbs">
            {bagCards.map((card,i)=><button key={card.id} type="button" aria-pressed={i===bagIndex} onClick={()=>setBagIndex(i)} title={card.name}>
              <span>{card.icon || '✧'}</span><small>{card.name}</small></button>)}
          </div>
        </div> : <div className="bond-ticket-wallet-empty"><span aria-hidden="true">⌑</span><p>还没有收藏的票券</p>
          <button type="button" onClick={() => { setTab('shop');setActiveIndex(0); }}>去选一张 ↗</button></div>}
      </div>
      {bagOwner==='them' && <details className="bond-ticket-details">
        <summary>角色积分流水</summary><p>赚到 {rolePointStats(bond).earned} · 兑换支出 {rolePointStats(bond).spent} · 退回 {rolePointStats(bond).refunded}</p>
        <small>流水自本版本起累计，历史余额见上方。</small>
      </details>}
      <details className="bond-ticket-details"><summary>出牌记录 <span>{bond.played.length}</span></summary>
        {bond.played.slice(-10).reverse().map((play,index)=><p key={index}>{play.side==='me'?'我':partner} · {play.card.name}{play.note ? ' · '+play.note : ''}</p>)}
      </details>
    </section>}

    {tab === 'tasks' && <section className="bond-ticket-tasks">
      <header className="bond-ticket-section-head"><small>盖章领取</small><h3>今日任务票</h3></header>
      {[
        {id:'care:'+today,text:'今天照料盆栽',ready:bond.plant.careCount > 0 && [bond.plant.lastCaredAt??0,bond.plant.cycleWaters?bond.plant.watered:0,bond.plant.fertilized??0].some(t=>t>0&&dayKey(new Date(t))===today),amount:25},
        {id:'moment:'+today,text:'记录今天的牵绊时光',ready:bond.entries.some(item=>item.kind==='timeline'&&item.side==='me'&&item.date===today),amount:35},
        {id:'first-wish',text:'完成第一个共同愿望',ready:bond.entries.some(item=>item.kind==='wish'&&item.done),amount:100},
        {id:'first-letter',text:'交换第一封时光信',ready:bond.entries.some(item=>item.kind==='mail'&&item.reply),amount:60},
      ].map((task,index)=><article className="bond-ticket-task" key={task.id}>
        <div className="bond-ticket-task-count">0{index+1}</div>
        <div className="bond-ticket-task-copy"><strong>{task.text}</strong><small>+{task.amount} PTS</small></div>
        <button type="button" disabled={working||busy||!task.ready||bond.claims.includes(task.id)}
          aria-label={'领取'+task.text+'奖励'} onClick={()=>apply(current=>reward(current,task.id,task.amount))}>
          {bond.claims.includes(task.id)?'已盖章':task.ready?'盖章领取':'未完成'}</button>
      </article>)}
    </section>}

    {tab === 'grand' && <section className="bond-ticket-grand">
      <div className="bond-ticket-seal" aria-hidden="true">✧</div>
      <span className="bond-ticket-grand-series">ONLY FOR US</span>
      <h3>终极大奖</h3>
      <p className="bond-ticket-grand-count"><strong>{bond.points.shared}</strong> / 3000</p>
      <div className="bond-ticket-grand-progress"><i style={{width:(Math.min(bond.points.shared/3000,1)*100)+'%'}} /></div>
      {bond.pact && <div className="bond-ticket-grand-pact"><strong>{bond.pact.wish}</strong><span>{({pending:'待回应',accepted:'已接受',declined:'已婉拒',done:'已兑现'})[bond.pact.status]}</span>
        {bond.pact.response && <p>{bond.pact.response}</p>}</div>}
      {bond.pact?.status==='pending' ? <button disabled={working||busy} onClick={()=>void run(decidePact)}>请 {partner} 回应</button>
        : bond.pact?.status==='accepted' ? <button disabled={working} onClick={()=>apply(current=>current.pact?.status==='accepted'?
          {...current,pact:{...current.pact,status:'done'}}:current)}>标记已兑现</button>
        : <div className="bond-ticket-grand-create"><label>许下一个心愿
            <textarea value={wish} maxLength={500} onChange={event=>setWish(event.target.value)} />
          </label>
          <button disabled={working||busy||bond.points.shared<3000||!wish.trim()} onClick={()=>{
            if(window.confirm('用全部共同积分兑换这个愿望？')) apply(current=>{
              if(current.points.shared<3000||current.pact?.status==='pending'||current.pact?.status==='accepted') throw new Error('当前不可兑换');
              return {...current,points:{...current.points,shared:0},pact:{wish:wish.trim(),spent:current.points.shared,status:'pending'}};
            });
          }}>兑换大奖 ↗</button></div>}
      <details className="bond-ticket-grand-rules"><summary>兑换规则</summary><p>累计 3000 共同积分后可使用全部积分兑换愿望。若对方婉拒，将退回本次所花积分的一半。</p></details>
    </section>}

    <details className="bond-ticket-options">
      <summary>出牌设置 <span>{bond.disabledCards?'已关闭':bond.autoCards?'自动':'手动'} ↗</span></summary>
      <div className="bond-ticket-option-body">
        <label><input type="checkbox" disabled={working} checked={!bond.disabledCards} onChange={event=>{
          const disabledCards=!event.target.checked;apply(current=>({...current,disabledCards}));}}/> 启用羁绊卡</label>
        <label><input type="checkbox" disabled={working} checked={!!bond.noCooldown} onChange={event=>{
          const noCooldown=event.target.checked;apply(current=>({...current,noCooldown}));}}/> 解除角色出牌冷却</label>
        <label><input type="checkbox" disabled={working||bond.disabledCards} checked={!!bond.autoCards} onChange={event=>{
          const autoCards=event.target.checked;apply(current=>({...current,autoCards}));}}/> 允许角色在私聊后自行兑换和出牌</label>
        {!bond.noCooldown&&<small>角色出牌间隔 90 分钟，同一卡间隔 6 小时。</small>}
      </div>
    </details>
  </div>;
}
