import { DB } from './db';

export type Relation = 'love' | 'family' | 'friend';
export type EntryKind = 'timeline' | 'anniversary' | 'diary' | 'wish' | 'gift' | 'mail' | 'capsule' | 'hollow';
export type Side = 'me' | 'them';
export type Entry = {
  id: string; kind: EntryKind; date: string; title: string; body: string;
  side: Side; done?: boolean; pinned?: boolean; steps?: { text: string; done: boolean }[];
  reply?: string; unlockDate?: string; opened?: boolean; image?: string; stickers?: string[]; stickerPositions?: { x: number; y: number }[];
};
export type Card = { id: string; name: string; icon: string; effect: string; price: number; charUse: boolean; turns?: number; voucher?: boolean };
export type PlayedCard = { card: Card; side: Side; at: number; note?: string; usedTurns?: number };
export type Bond = {
  id: string; members: string[]; relation: Relation; status: 'draft' | 'pending' | 'declined' | 'open';
  start: string; cover?: string; zoom?: number; position?: number; entries: Entry[];
  plant: { xp: number; watered: number; fertilized?: number; lastSide?: Side; careCount: number; cycleWaters?: number };
  touches: number; portrait?: string; touchLines?: Record<string, string>; touchProps?: string[]; touchCalibration?: Record<string, { x: number; y: number }>;
  plantAuto?: boolean; touchBgm?: string;
  diaryAuto?: boolean; diaryStyle?: string; diaryContext?: boolean; hollowAuto?: boolean;
  disabledCards?: boolean; autoCards?: boolean; lastSceneTurn?: number; noCooldown?: boolean; hidden: string[]; cards: Card[]; bags: Record<Side, Record<string, number>>;
  points: Record<Side | 'shared', number>; played: PlayedCard[]; claims: string[];
  pact?: { wish: string; spent: number; status: 'pending' | 'accepted' | 'declined' | 'done'; response?: string };
  gateMode?: 'open' | 'level' | 'pact';
  unlocks?: Record<string, { terms: string; response: string }>;
  flowers?: { id: string; name: string; from: Side; date: string }[];
  pairStats?: { intimacy: number; trust: number; tension: number };
};
type Spaces = Record<string, Bond>;
const KEY = 'couples_space_v1';
export const DAY = 86_400_000;
export const relationNames = { love: '恋爱', family: '亲情', friend: '友情' };
export const dayKey = (date = new Date()) => [
  date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'),
].join('-');
export function daysTogether(start: string) {
  const elapsed = Date.parse(dayKey()) - Date.parse(start);
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / DAY) + 1) : 0;
}
export const spaceKey = (members: string[]) => JSON.stringify([...members].sort());
export const createBond = (members: string[], relation: Relation = 'love'): Bond => ({
  id: crypto.randomUUID(), members, relation, status: members.length === 2 ? 'open' : 'draft',
  start: dayKey(), entries: [], plant: { xp: 0, watered: Date.now(), careCount: 0 }, touches: 0,
  hidden: [], cards: [], bags: { me: {}, them: {} }, points: { me: 0, them: 0, shared: 0 },
  played: [], claims: [],
});
export const readSpaces = async (): Promise<Spaces> => (await DB.getAssetRaw(KEY)) ?? {};
export const readBond = async (members: string[]) => (await readSpaces())[spaceKey(members)];
export async function writeBond(members: string[], update: (bond: Bond | undefined) => Bond | undefined) {
  const key = spaceKey(members);
  const spaces = await DB.updateAssetRaw<Spaces>(KEY, raw => {
    const next = { ...(raw as Spaces | null) };
    const bond = update(next[key]);
    if (bond) next[key] = bond;
    else delete next[key];
    return next;
  });
  return spaces[key];
}
export const createEntry = (kind: EntryKind, title: string, body: string, side: Side = 'me'): Entry =>
  ({ id: crypto.randomUUID(), kind, title, body, side, date: dayKey() });

export const bondXp = (bond: Bond) => bond.claims.filter(claim => !claim.startsWith('scene:')).length * 10 +
  bond.entries.length * 8 + bond.plant.careCount * 5 + bond.touches;
export const bondLevel = (bond: Bond) => 1 + Math.floor(bondXp(bond) / 100);
export const panelLevels: Partial<Record<EntryKind | 'shop' | 'achievements' | 'plant' | 'touch' | 'settings', number>> = {
  timeline: 1, anniversary: 1, diary: 1, wish: 2, gift: 2, mail: 2, plant: 2, touch: 3, shop: 3, capsule: 3, hollow: 4,
};
export function canWaterPlant(plant: Bond['plant'], now = Date.now()) {
  return plantStage(plant, now) !== '枯萎' && (!plant.cycleWaters || now - plant.watered >= 4 * 3_600_000);
}

export const plantStage = (plant: Bond['plant'], now = Date.now()) =>
  now - plant.watered >= 3 * DAY ? '枯萎' : plant.xp >= 100 ? '开花' : plant.xp >= 55 ? '茂盛' : plant.xp >= 20 ? '嫩芽' : '种子';

export function careForPlant(bond: Bond, action: 'water' | 'fertilize', side: Side, now = Date.now()): Bond {
  const { plant } = bond;
  if (plantStage(plant, now) === '枯萎') throw new Error('盆栽已经枯萎，请重新播种');
  const last = action === 'water' ? (plant.cycleWaters ? plant.watered : 0) : plant.fertilized ?? 0;
  if (now - last < (action === 'water' ? 4 * 3_600_000 : DAY)) throw new Error('刚照料过，过一会儿再来');
  return {
    ...bond,
    plant: {
      ...plant, xp: Math.min(100, plant.xp + (action === 'water' ? 12 : 22)),
      ...(action === 'water' ? { watered: now, lastSide: side, cycleWaters: (plant.cycleWaters ?? 0) + 1 } : { fertilized: now }),
      careCount: plant.careCount + 1,
    },
    points: { ...bond.points, [side]: bond.points[side] + 8, shared: bond.points.shared + 10 },
  };
}

export function canRolePlay(bond: Bond, cardId: string, now = Date.now()) {
  if (bond.disabledCards || bond.hidden.includes(cardId)) return false;
  if (bond.noCooldown) return true;
  return !bond.played.some(play => play.side === 'them' &&
    now - play.at < (play.card.id === cardId ? 6 : 1.5) * 3_600_000);
}

export const shopCards: Card[] = [
  { id: 'nickname', name: '昵称卡', icon: '✦', effect: '起一个只有我们会用的称呼', price: 35, charUse: true, turns: 3 },
  { id: 'hug', name: '抱抱卡', icon: '♡', effect: '来一个拥抱，说说为什么想抱住对方', price: 40, charUse: true },
  { id: 'sweet', name: '情话卡', icon: '✉', effect: '说一句和我们真实经历有关的心里话', price: 45, charUse: true },
  { id: 'photo', name: '照片卡', icon: '▧', effect: '约一张想和对方一起拍的照片', price: 65, charUse: true, voucher: true },
  { id: 'kiss', name: '亲亲卡', icon: '♥', effect: '询问对方是否愿意亲吻，尊重回应与关系定位', price: 60, charUse: true },
  { id: 'listen', name: '倾听卡', icon: '♫', effect: '给对方留出诉说的空间，认真听完', price: 30, charUse: true, turns: 2 },
  { id: 'peace', name: '和好卡', icon: '☘', effect: '说清不愉快的原因，邀请对方一起和好', price: 75, charUse: true },
  { id: 'pardon', name: '免死金牌', icon: '♜', effect: '请求一次原谅，并说明想怎样弥补', price: 100, charUse: true, voucher: true },
];

export function exchangeCard(bond: Bond, card: Card, side: Side): Bond {
  if (bond.disabledCards || bond.hidden.includes(card.id) || (side === 'them' && !card.charUse))
    throw new Error('这张卡当前不可兑换');
  if (bond.points[side] < card.price) throw new Error('积分不足');
  return {
    ...bond, points: { ...bond.points, [side]: bond.points[side] - card.price },
    bags: { ...bond.bags, [side]: { ...bond.bags[side], [card.id]: (bond.bags[side][card.id] ?? 0) + 1 } },
  };
}

export function playCard(bond: Bond, card: Card, side: Side, note?: string, now = Date.now()): Bond {
  if (bond.disabledCards || bond.hidden.includes(card.id) || !bond.bags[side][card.id] ||
      (side === 'them' && (!card.charUse || !canRolePlay(bond, card.id, now)))) throw new Error('这张卡当前不可打出');
  return {
    ...bond, bags: { ...bond.bags, [side]: { ...bond.bags[side], [card.id]: bond.bags[side][card.id] - 1 } },
    played: [...bond.played, { card, side, note, at: now }].slice(-100),
  };
}

export const reward = (bond: Bond, claim: string, amount: number, side: Side = 'me'): Bond =>
  bond.claims.includes(claim) ? bond : {
    ...bond, claims: [...bond.claims, claim],
    points: { ...bond.points, [side]: bond.points[side] + amount, shared: bond.points.shared + amount },
  };
