import React, { useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, CreditCard, SpinnerGap, Trash } from '@phosphor-icons/react';
import type { CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../../types';
import {
  CHARACTER_PHONE_WALLET_CHANGED,
  calculatePhoneNetAssets, clearCharacterPhoneWallet, initializeCharacterPhoneWallet,
  readCharacterPhoneWallet, syncCharacterPhoneWalletMemos, syncCharacterPhoneWalletPayments,
  type CharacterPhoneWallet as WalletState,
  type PhoneWalletAccount, type PhoneWalletTransaction,
} from '../../utils/characterPhoneWallet';
import { CHARACTER_MEMOS_CHANGED } from '../../utils/characterPhoneMemos';
import { PHONE_PAY_RECEIPTS_CHANGED, readPhonePayReceipts } from '../../utils/characterPhonePayments';

type Api = { baseUrl: string; apiKey: string; model: string };
const money = (cents: number) => '¥ ' + (cents / 100).toLocaleString('zh-CN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const signed = (cents: number) => (cents > 0 ? '+' : cents < 0 ? '−' : '') + money(Math.abs(cents));
const accountKind = (kind: PhoneWalletAccount['kind']) => ({
  cash: '零钱 / 流动账户', savings: '储蓄账户', investment: '投资账户', credit: '信用负债',
})[kind];
const formattedTime = (time: number) => new Date(time).toLocaleString('zh-CN', {
  month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',
});

/** Float-inspired assets page; state is always Char-owned, not User's real wallet. */
export default function CharacterPhoneWallet({
  characterId, char, userProfile, groups, realtimeConfig, api,
}: {
  characterId: string; char: CharacterProfile; userProfile: UserProfile;
  groups: GroupProfile[]; realtimeConfig?: RealtimeConfig; api: Api;
}) {
  const [wallet, setWallet] = useState<WalletState | null>(() => readCharacterPhoneWallet(characterId));
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [receipts,setReceipts]=useState(()=>readPhonePayReceipts(characterId));
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    const refresh = () => {
      syncCharacterPhoneWalletMemos(characterId);
      setWallet(syncCharacterPhoneWalletPayments(characterId) || readCharacterPhoneWallet(characterId));
      setReceipts(readPhonePayReceipts(characterId));
    };
    refresh();
    const onWallet = (event: Event) => {
      if ((event as CustomEvent<{characterId:string}>).detail?.characterId === characterId)
        setWallet(readCharacterPhoneWallet(characterId));
    };
    const onMemo = (event: Event) => {
      if ((event as CustomEvent<{characterId:string}>).detail?.characterId === characterId)
        refresh();
    };
    window.addEventListener(CHARACTER_PHONE_WALLET_CHANGED,onWallet);
    window.addEventListener(CHARACTER_MEMOS_CHANGED,onMemo);
    window.addEventListener(PHONE_PAY_RECEIPTS_CHANGED,refresh);
    return () => {
      window.removeEventListener(CHARACTER_PHONE_WALLET_CHANGED,onWallet);
      window.removeEventListener(CHARACTER_MEMOS_CHANGED,onMemo);
      window.removeEventListener(PHONE_PAY_RECEIPTS_CHANGED,refresh);
    };
  }, [characterId]);

  const accounts = wallet?.accounts || [];
  const selected = accounts.find(a=>a.id===selectedAccountId) || accounts[0] || null;
  const transactions = useMemo(() =>
    (wallet?.transactions || []).filter(t=>!selected || t.accountId===selected.id)
      .sort((a,b)=>b.occurredAt-a.occurredAt),
    [wallet,selected?.id]);
  const activeTransaction = selectedTransactionId
    ? wallet?.transactions.find(t=>t.id===selectedTransactionId) : null;
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  const todayDelta = (wallet?.transactions || [])
    .filter(t=>t.occurredAt>=todayStart.getTime())
    .reduce((sum,t)=>sum+t.amountCents,0);

  const refreshWallet = async () => {
    if (running) return;
    setRunning(true);setError('');setNotice('');
    try {
      if (!wallet) {
        const created = await initializeCharacterPhoneWallet({
          char, user:userProfile, groups, realtimeConfig, api,
        });
        setWallet(created);
        setNotice('已建立角色自己的虚构资产档案');
      } else {
        syncCharacterPhoneWalletMemos(characterId);
        const updated = syncCharacterPhoneWalletPayments(characterId) || readCharacterPhoneWallet(characterId) || wallet;
        setWallet(updated);
        setNotice(updated.transactions.length> wallet.transactions.length
          ? '已同步新保存的角色记账记录'
          : '已核对账目，没有新增的角色记账或微信支付记录');
      }
    } catch (e) {setError(e instanceof Error?e.message:String(e));}
    finally {setRunning(false);}
  };

  return <div className="min-h-full bg-[#f2f2f2] pb-8 text-[#222]">
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm font-semibold tracking-[.12em]">资产 · ASSETS</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="刷新资产" disabled={running}
          onClick={()=>void refreshWallet()} className="rounded-full bg-white p-2 text-[#444] disabled:opacity-40">
          {running?<SpinnerGap size={20} className="animate-spin"/>:<ArrowClockwise size={20}/>}
        </button>
        <button type="button" aria-label="清空资产档案" disabled={running||!wallet}
          onClick={()=>setConfirmClear(true)} className="rounded-full bg-white p-2 text-[#777] disabled:opacity-40">
          <Trash size={19}/>
        </button>
      </div>
    </div>
    {error && <div role="alert" className="mx-4 mb-3 rounded-xl bg-white p-3 text-sm text-[#444]">{error}</div>}
    {notice && <p role="status" className="mx-5 mb-3 text-xs text-[#777]">{notice}</p>}
    <section className="mx-4 mb-4 rounded-[20px] border border-[#e7e7e7] bg-white px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">微信支付 · 账单</h3><span className="text-[11px] text-[#999]">{receipts.length} 笔</span></div>
      <p className="mt-1 text-[11px] leading-5 text-[#999]">Char 的手机模拟交易。确认的转账须有独立来源，不能凭空生成 User 向 Char 转账。</p>
      {!receipts.length&&<p className="py-5 text-center text-xs text-[#aaa]">还没有支付流水；刷新微信消息时可能出现符合角色生活的虚构消费。</p>}
      {receipts.slice(0,20).map(receipt=><div key={receipt.id} className="flex items-center gap-3 border-t border-[#f0f0f0] py-3 text-xs first:mt-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eee] text-[15px]">{receipt.amountCents<0?'−':'+'}</span>
        <div className="min-w-0 flex-1"><strong className="block truncate text-[#444]">{receipt.title}</strong><span className="mt-1 block text-[10px] text-[#aaa]">{formattedTime(receipt.occurredAt)} · {receipt.category}</span></div>
        <span className="shrink-0 font-medium tabular-nums">{signed(receipt.amountCents)}</span>
      </div>)}
    </section>
    {!wallet && <section className="mx-4 space-y-4 rounded-2xl bg-white px-6 py-12 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eee]"><CreditCard size={29}/></div>
      <h3 className="text-lg font-semibold">{char.name}的资产</h3>
      <p className="text-sm leading-6 text-[#777]">暂时没有资产档案。首次建立时会参考角色设定和已有生活背景生成虚构账户与账目，不连接真实银行卡。</p>
      <button type="button" disabled={running} onClick={()=>void refreshWallet()}
        className="w-full rounded-xl bg-[#252525] py-3 text-sm text-white disabled:opacity-40">
        {running?'建立中…':'建立角色资产档案'}
      </button>
    </section>}
    {wallet && <>
      <section className="mx-4 rounded-[23px] bg-[#252525] px-6 pb-6 pt-7 text-white">
        <p className="text-xs tracking-[.16em] text-[#ccc]">TOTAL NET ASSETS</p>
        <p className="mt-2 break-all text-[32px] font-medium tabular-nums">{money(calculatePhoneNetAssets(wallet))}</p>
        <div className="mt-5 flex items-center justify-between border-t border-[#ffffff35] pt-4">
          <span className="text-xs text-[#c8c8c8]">今日账目变化</span>
          <span className="text-sm tabular-nums">{signed(todayDelta)}</span>
        </div>
        <div className="mt-2 text-[11px] text-[#aaa]">账户余额合计已扣除信用负债 · 人民币</div>
      </section>

      <div className="flex items-center justify-between px-5 pb-3 pt-7">
        <h3 className="font-semibold">我的账户</h3>
        <span className="text-xs text-[#999]">{accounts.length} 个账户</span>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-4">
        {accounts.map((account,i)=><button key={account.id} type="button"
          aria-pressed={selected?.id===account.id} onClick={()=>{setSelectedAccountId(account.id);setSelectedTransactionId(null);}}
          className={'relative min-h-[170px] w-[80%] max-w-[310px] shrink-0 snap-center overflow-hidden rounded-[21px] border p-5 text-left shadow-sm transition '+(selected?.id===account.id
            ? 'border-[#333] bg-[#3d3d3d] text-white' : 'border-[#ccc] bg-[#e2e2e2] text-[#333]')}>
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-semibold">{account.bankLabel}</span>
            <CreditCard size={25} weight="thin"/>
          </div>
          <p className="mt-1 text-[11px] opacity-70">{accountKind(account.kind)}</p>
          <p className="mt-5 font-mono text-sm tracking-widest opacity-85">•••• •••• •••• {account.maskedNumber}</p>
          <div className="mt-4 flex items-end justify-between gap-2">
            <span className="truncate text-xs opacity-80">{account.title}</span>
            <span className="shrink-0 text-lg font-medium tabular-nums">{money(account.balanceCents)}</span>
          </div>
          <span className="absolute -right-3 -top-8 select-none text-[120px] font-light opacity-[.045]">{i+1}</span>
        </button>)}
      </div>
      {selected && <section className="mx-4 mb-5 rounded-2xl bg-white p-5">
        <p className="text-xs text-[#999]">{accountKind(selected.kind)} · CURRENT BALANCE</p>
        <p className="mt-2 text-[27px] font-semibold tabular-nums">{money(selected.balanceCents)}</p>
        <p className="mt-2 text-xs text-[#888]">{selected.note || '角色手机账户'}</p>
      </section>}
      <div className="mx-5 mb-3 flex items-center justify-between">
        <h3 className="font-semibold">账户流水</h3>
        <span className="text-xs text-[#aaa]">{transactions.length} 条</span>
      </div>
      <div className="mx-4 overflow-hidden rounded-2xl bg-white">
        {!transactions.length && <p className="px-4 py-9 text-center text-sm text-[#999]">尚无可以确认的账户流水</p>}
        {transactions.map(t=><button type="button" key={t.id}
          className="flex w-full items-center gap-3 border-b border-[#eee] px-4 py-4 text-left last:border-none"
          onClick={()=>setSelectedTransactionId(t.id)}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0f0f0] text-lg font-semibold">
            {t.amountCents<0?'−':'+'}
          </span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t.title}</span>
            <span className="mt-1 block text-xs text-[#999]">{formattedTime(t.occurredAt)} · {t.category}</span>
          </span>
          <span className="text-sm font-medium tabular-nums">{signed(t.amountCents)}</span>
        </button>)}
      </div>
      <p className="mx-5 mt-5 text-xs leading-5 text-[#999]">这是 {char.name} 的虚构手机资产，不关联真实支付。初始流水属于角色快照；后续同步已保存的角色记账和微信模拟交易，未来仅在有明确来源记录时接入真实私聊转账或集市订单；不会仅凭日程推定付款。</p>
    </>}
    {activeTransaction && <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/40 p-2" role="dialog" aria-modal="true" aria-label="交易详情" onClick={()=>setSelectedTransactionId(null)}>
      <div className="w-full max-w-[420px] space-y-5 rounded-3xl bg-white p-6 pb-10" onClick={e=>e.stopPropagation()}>
        <div className="text-center"><p className="text-xs text-[#999]">{activeTransaction.title}</p>
          <p className="mt-3 text-[30px] font-medium tabular-nums">{signed(activeTransaction.amountCents)}</p>
          <p className="mt-2 text-xs text-[#888]">已记入虚构账本</p></div>
        <div className="space-y-3 border-t border-[#eee] pt-4 text-sm">
          <div className="flex justify-between gap-3"><span className="text-[#999]">交易时间</span><span>{formattedTime(activeTransaction.occurredAt)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-[#999]">所属账户</span><span>{accounts.find(a=>a.id===activeTransaction.accountId)?.title}</span></div>
          <div className="flex justify-between gap-3"><span className="text-[#999]">记录来源</span><span>{activeTransaction.origin==='memo'?'已保存的角色记账':activeTransaction.origin==='opening-snapshot'?'初始角色资产快照':activeTransaction.origin==='wechat-simulated'?'微信模拟交易':activeTransaction.origin==='private-confirmed'?'已确认私聊转账':'已确认集市交易'}</span></div>
          <p className="break-words border-t border-[#eee] pt-4 leading-6">{activeTransaction.detail}</p>
        </div>
        <button type="button" className="w-full rounded-xl bg-[#eee] py-3" onClick={()=>setSelectedTransactionId(null)}>返回</button>
      </div>
    </div>}
    {confirmClear && <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/40 p-2" role="dialog" aria-modal="true" aria-label="清空虚构资产" onClick={()=>setConfirmClear(false)}>
      <div className="w-full max-w-[420px] rounded-3xl bg-white p-6" onClick={e=>e.stopPropagation()}>
        <h3 className="text-lg font-semibold">清空角色资产快照？</h3>
        <p className="mt-2 text-sm leading-6 text-[#777]">仅清空此 Char 的钱包账户和流水快照，不删除原有备忘录、微信记录或生活事件。重新建立会生成一份新档案。</p>
        <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" className="rounded-xl bg-[#eee] py-3" onClick={()=>setConfirmClear(false)}>取消</button>
          <button type="button" className="rounded-xl bg-[#333] py-3 text-white" onClick={()=>{
            try {clearCharacterPhoneWallet(characterId);setWallet(null);setSelectedAccountId('');setSelectedTransactionId(null);setConfirmClear(false);}
            catch {setError('清空失败，请稍后重试');}
          }}>确认清空</button></div>
      </div>
    </div>}
  </div>;
}
