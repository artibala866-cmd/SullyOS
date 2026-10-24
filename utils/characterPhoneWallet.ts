import { readCharacterMemos } from './characterPhoneMemos';
import { buildCharacterPhoneContext } from './characterPhoneContext';
import type { CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../types';
import { extractContent, safeResponseJson } from './safeApi';

export type PhoneAccountKind = 'cash' | 'savings' | 'investment' | 'credit';
export type PhoneWalletAccount = {
  id: string;
  kind: PhoneAccountKind;
  title: string;
  bankLabel: string;
  /** Only fictional masked digits; never bank credentials or a real card number. */
  maskedNumber: string;
  balanceCents: number;
  note: string;
};
export type PhoneWalletTransaction = {
  id: string;
  accountId: string;
  title: string;
  category: string;
  detail: string;
  amountCents: number;
  occurredAt: number;
  origin: 'opening-snapshot' | 'memo';
  sourceId?: string;
};
export type CharacterPhoneWallet = {
  version: 1;
  characterId: string;
  currency: 'CNY';
  createdAt: number;
  updatedAt: number;
  accounts: PhoneWalletAccount[];
  transactions: PhoneWalletTransaction[];
  appliedMemoIds: string[];
};

export const CHARACTER_PHONE_WALLET_CHANGED = 'sully:character-phone-wallet-changed';
const walletKey = (characterId: string) => 'sully_character_phone_wallet_v1:' + characterId;
const requestLocks = new Set<string>();
const finiteCents = (n: unknown, limit = 100_000_000_00): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && Math.abs(n) <= limit;
const roundCents = (n: unknown, max = 100_000_000): number | null => {
  const value = typeof n === 'number' ? n : typeof n === 'string'
    ? Number(n.replace(/[¥￥,\s]/g, '')) : NaN;
  if (!Number.isFinite(value) || Math.abs(value) > max) return null;
  return Math.round(value * 100);
};
const clip = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export function readCharacterPhoneWallet(characterId: string): CharacterPhoneWallet | null {
  if (!characterId || typeof localStorage === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(walletKey(characterId)) || 'null');
    if (!raw || raw.version !== 1 || raw.characterId !== characterId ||
        raw.currency !== 'CNY' || !Array.isArray(raw.accounts) ||
        !Array.isArray(raw.transactions) || !Array.isArray(raw.appliedMemoIds)) return null;
    const accounts = raw.accounts.filter((a: PhoneWalletAccount) => a && typeof a.id === 'string' &&
      typeof a.title === 'string' && typeof a.bankLabel === 'string' &&
      typeof a.maskedNumber === 'string' && finiteCents(a.balanceCents) &&
      ['cash','savings','investment','credit'].includes(a.kind));
    if (!accounts.length || accounts.length !== raw.accounts.length) return null;
    const ids = new Set(accounts.map((a: PhoneWalletAccount) => a.id));
    const transactions = raw.transactions.filter((t: PhoneWalletTransaction) =>
      t && typeof t.id === 'string' && typeof t.accountId === 'string' &&
      ids.has(t.accountId) && typeof t.title === 'string' &&
      typeof t.detail === 'string' && typeof t.category === 'string' &&
      finiteCents(t.amountCents) && Number.isFinite(t.occurredAt));
    if (transactions.length !== raw.transactions.length) return null;
    return { ...raw, accounts, transactions,
      appliedMemoIds: raw.appliedMemoIds.filter((id: unknown): id is string => typeof id === 'string').slice(-500) };
  } catch { return null; }
}

function persist(wallet: CharacterPhoneWallet): CharacterPhoneWallet {
  localStorage.setItem(walletKey(wallet.characterId), JSON.stringify(wallet));
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_WALLET_CHANGED,
      { detail: { characterId: wallet.characterId } }));
  return wallet;
}

export function clearCharacterPhoneWallet(characterId: string): void {
  localStorage.removeItem(walletKey(characterId));
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_WALLET_CHANGED,
      { detail: { characterId } }));
}

/** Credit lines are debts, not spendable deposits. */
export function calculatePhoneNetAssets(wallet: CharacterPhoneWallet): number {
  return wallet.accounts.reduce((sum, a) =>
    sum + (a.kind === 'credit' ? -Math.abs(a.balanceCents) : a.balanceCents), 0);
}

/** Only expense memos with a structured explicit CNY amount can change balances.
 * This is an in-world phone ledger, not a real payment or bank transaction.
 * Never invent a payment based on a planned schedule or generic text.
 */
export function syncCharacterPhoneWalletMemos(characterId: string): CharacterPhoneWallet | null {
  const wallet = readCharacterPhoneWallet(characterId);
  if (!wallet) return null;
  const account = wallet.accounts.find(a => a.kind === 'cash') ||
    wallet.accounts.find(a => a.kind === 'savings');
  if (!account) return wallet;
  const applied = new Set(wallet.appliedMemoIds);
  const newTransactions: PhoneWalletTransaction[] = [];
  let change = 0;
  const newApplied: string[] = [];
  for (const memo of readCharacterMemos(characterId).slice().sort((a,b)=>a.createdAt-b.createdAt)) {
    if (applied.has(memo.id) || memo.category !== 'expense' || !memo.expense) continue;
    const currency = String(memo.expense.currency || '').trim().toUpperCase();
    if (!['CNY', 'RMB', '¥', '￥'].includes(currency)) continue;
    const cents = roundCents(memo.expense.amount);
    if (cents === null || cents <= 0 || cents > 10_000_000_00) continue;
    applied.add(memo.id);
    newApplied.push(memo.id);
    change -= cents;
    newTransactions.push({
      id: 'memo:' + memo.id, sourceId: memo.id, accountId: account.id,
      title: clip(memo.expense.label, 70) || '记账支出', category: '记账',
      detail: clip(memo.body, 260) || '角色手机中已经保存的支出记录',
      amountCents: -cents, occurredAt: memo.createdAt, origin: 'memo',
    });
  }
  if (!newApplied.length) return wallet;
  return persist({
    ...wallet,
    updatedAt: Date.now(),
    accounts: wallet.accounts.map(a => a.id === account.id
      ? { ...a, balanceCents: a.balanceCents + change } : a),
    transactions: [...newTransactions.reverse(), ...wallet.transactions].slice(0, 250),
    appliedMemoIds: [...wallet.appliedMemoIds, ...newApplied].slice(-500),
  });
}

type Api = { baseUrl: string; apiKey: string; model: string };
export async function initializeCharacterPhoneWallet(input: {
  char: CharacterProfile;
  user: UserProfile;
  groups: GroupProfile[];
  realtimeConfig?: RealtimeConfig;
  api: Api;
}): Promise<CharacterPhoneWallet> {
  const {char, user, groups, realtimeConfig, api} = input;
  if (!char.id || !api.baseUrl || !api.apiKey || !api.model) throw new Error('请先配置角色聊天 API');
  const existing = readCharacterPhoneWallet(char.id);
  if (existing) return syncCharacterPhoneWalletMemos(char.id) || existing;
  if (requestLocks.has(char.id)) throw new Error('资产正在生成，请稍后查看');
  requestLocks.add(char.id);
  try {
    const context = await buildCharacterPhoneContext(char, user, groups, realtimeConfig);
    const response = await fetch(api.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: {'Content-Type':'application/json',Authorization:'Bearer '+api.apiKey},
      body: JSON.stringify({ model:api.model, stream:false, temperature:0.5, messages:[
        { role:'system', content:`你负责建立虚构角色 ${char.name} 自己手机中【微信-我-钱包-资产】的首次资产快照。
这是角色扮演中的虚构账本，不是真实银行数据，不得用 User 的财产/银行账户代替 Char。
根据其工作、年龄、生活习惯、经济状况合理生成，不默认富有，不制造夸张巨款。
严格参考角色设定与实际私聊：${context.systemPrompt.slice(0,19000)}
产出1~4个账户，kind为cash/savings/investment/credit之一，现金/零钱账户优先有一个。
每个账户的id为cash/savings/investment/credit开头的唯一简短英文标识；balance为非负人民币数值（最多一亿元）；信用账户balance表示欠款；maskedNumber只能是4位随机虚构尾号，不能输出真实银行卡号。
可以产出0~6条以过去7天为背景的【初始化虚构快照】流水；账户id必须存在，amount为有正负号的人民币数值，createdAt为真实合法时间戳毫秒，不可晚于现在；同类活动不重复。注意与余额和经济状况相容，余额已经包括这些旧交易，不应再次加减。
绝不能捏造 User 的转账或支付、不得把日程计划说成已发生的支付。
只返回JSON：{"accounts":[{"id":"cash","kind":"cash","title":"零钱","bankLabel":"微信支付","maskedNumber":"1234","balance":128.5,"note":"常用支付"}],"activities":[{"accountId":"cash","title":"便利店","category":"生活","amount":-12.5,"createdAt":${Date.now()-3600000},"detail":"买饮料"}]}。` },
        {role:'user',content:'为 Char 建立符合原设的稳定虚构资产快照；不读取或使用 User 的真实钱包。'},
      ] }),
    });
    const json = await safeResponseJson(response);
    if (!response.ok) throw new Error(json?.error?.message || '资产 API 请求失败');
    const raw = extractContent(json).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.accounts)) throw new Error('资产账户格式错误');
    const now = Date.now();
    const accounts: PhoneWalletAccount[] = [];
    for (const item of parsed.accounts.slice(0, 4)) {
      if (!item || !['cash','savings','investment','credit'].includes(item.kind)) continue;
      const balanceCents = roundCents(item.balance);
      if (balanceCents === null || balanceCents < 0) continue;
      const id = clip(item.id, 48);
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(id) || accounts.some(a => a.id === id)) continue;
      accounts.push({
        id, kind: item.kind, balanceCents,
        title: clip(item.title, 45) || '账户',
        bankLabel: clip(item.bankLabel, 55) || '账户',
        maskedNumber: (String(item.maskedNumber || '').replace(/\D/g, '').slice(-4) || '0000').padStart(4,'0'),
        note: clip(item.note, 120),
      });
    }
    if (!accounts.length) throw new Error('资产 API 没有返回有效账户，本次未保存');
    const ids = new Set(accounts.map(a => a.id));
    const transactions: PhoneWalletTransaction[] = [];
    for (const item of (Array.isArray(parsed.activities) ? parsed.activities : []).slice(0, 12)) {
      if (!item || !ids.has(item.accountId)) continue;
      const cents = roundCents(item.amount, 5_000_000);
      const occurredAt = Number(item.createdAt);
      if (cents === null || !cents || !Number.isFinite(occurredAt) ||
          occurredAt > now || occurredAt < now - 7*86400_000) continue;
      transactions.push({
        id: crypto.randomUUID(), accountId:item.accountId,
        amountCents:cents, title:clip(item.title, 75)||'其他',
        category:clip(item.category, 55)||'日常',
        detail:clip(item.detail, 320)||'角色手机初始账目快照',
        occurredAt, origin:'opening-snapshot',
      });
    }
    // Another surface might have initialized it during this API call.
    const current = readCharacterPhoneWallet(char.id);
    if (current) return current;
    const wallet = persist({
      version:1, characterId:char.id, currency:'CNY', createdAt:now, updatedAt:now,
      accounts, transactions:transactions.sort((a,b)=>b.occurredAt-a.occurredAt),
      appliedMemoIds:[],
    });
    return syncCharacterPhoneWalletMemos(char.id) || wallet;
  } finally { requestLocks.delete(char.id); }
}
