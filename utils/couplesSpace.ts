import { DB } from './db';
import { getLocalDateKey } from './localDate';

export type Relation = 'love' | 'family' | 'friend';
export type EntryKind = 'timeline' | 'anniversary' | 'diary' | 'wish' | 'gift' | 'mail' | 'capsule' | 'hollow';
export type Side = 'me' | 'them';
export type Entry = {
  id: string; kind: EntryKind; date: string; title: string; body: string;
  side: Side; done?: boolean; pinned?: boolean; steps?: { text: string; done: boolean }[];
  reply?: string; unlockDate?: string; opened?: boolean; openedEarly?: boolean; image?: string; stickers?: string[]; stickerPositions?: { x: number; y: number }[];
};
export type Card = { id: string; name: string; icon: string; effect: string; price: number; charUse: boolean; turns?: number; voucher?: boolean; relation?: Relation };
export type PlayedCard = { id?: string; card: Card; side: Side; at: number; note?: string; usedTurns?: number };
export type Bond = {
  id: string; members: string[]; relation: Relation; status: 'draft' | 'pending' | 'declined' | 'open' | 'closed';
  start: string; cover?: string; zoom?: number; position?: number; entries: Entry[];
  plant: { xp: number; watered: number; fertilized?: number; lastCaredAt?: number; lastSide?: Side; careCount: number; cycleWaters?: number };
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
export const dayKey = getLocalDateKey;
export type CapsuleStatus = 'sealed' | 'ready' | 'opened';
export function capsuleStatus(entry: Entry, today = dayKey()): CapsuleStatus {
  if (entry.opened) return 'opened';
  // Legacy capsules without an opening date must never reveal their text automatically.
  if (!entry.unlockDate) return 'sealed';
  return entry.unlockDate <= today ? 'ready' : 'sealed';
}
export function capsuleDate(months: number, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(now.getDate(), lastDay));
  return dayKey(date);
}
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
/** Change the binding generation so that old requests cannot write into a restored space. */
export function setBondOpen(bond: Bond, open: boolean): Bond {
  if (bond.members.length !== 1 || bond.status !== (open ? 'closed' : 'open')) return bond;
  return { ...bond, id: crypto.randomUUID(), status: open ? 'open' : 'closed' };
}

export const createEntry = (kind: EntryKind, title: string, body: string, side: Side = 'me'): Entry =>
  ({ id: crypto.randomUUID(), kind, title, body, side, date: dayKey() });

export const bondXp = (bond: Bond) => bond.claims.filter(claim => !claim.startsWith('scene:')).length * 10 +
  bond.entries.length * 8 + bond.plant.careCount * 5 + bond.touches;
export const bondLevel = (bond: Bond) => 1 + Math.floor(bondXp(bond) / 100);
export const panelLevels: Partial<Record<EntryKind | 'shop' | 'achievements' | 'plant' | 'touch' | 'settings', number>> = {
  timeline: 1, anniversary: 1, diary: 1, wish: 2, gift: 2, mail: 2, plant: 2, touch: 3, shop: 3, capsule: 3, hollow: 4,
};
export type PlantCareAction = 'water' | 'fertilize';
/** Remaining cooldown (ms); Infinity when replanting is required. */
export function plantCareWait(plant: Bond['plant'], action: PlantCareAction, now = Date.now()): number {
  if (plantStage(plant, now) === '枯萎') return Infinity;
  if (action === 'water' && !plant.cycleWaters) return 0;
  const last = action === 'water' ? plant.watered : (plant.fertilized ?? 0);
  const cooldown = action === 'water' ? 4 * 3_600_000 : DAY;
  return Math.max(0, cooldown - (now - last));
}

export function canWaterPlant(plant: Bond['plant'], now = Date.now()) {
  return plantCareWait(plant, 'water', now) === 0;
}

export const plantStage = (plant: Bond['plant'], now = Date.now()) =>
  now - plant.watered >= 3 * DAY ? '枯萎' : plant.xp >= 100 ? '开花' : plant.xp >= 55 ? '茂盛' : plant.xp >= 20 ? '嫩芽' : '种子';

export function careForPlant(bond: Bond, action: 'water' | 'fertilize', side: Side, now = Date.now()): Bond {
  const { plant } = bond;
  if (plantStage(plant, now) === '枯萎') throw new Error('盆栽已经枯萎，请重新播种');
  if (plantCareWait(plant, action, now) > 0) throw new Error('刚照料过，过一会儿再来');
  return {
    ...bond,
    plant: {
      ...plant, xp: Math.min(100, plant.xp + (action === 'water' ? 12 : 22)),
      ...(action === 'water' ? { watered: now, lastSide: side, cycleWaters: (plant.cycleWaters ?? 0) + 1 } : { fertilized: now }),
      lastCaredAt: now,
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
  { id: 'truth', name: '真心话卡', icon: '◇', effect: '认真回答对方提出的一个问题，可以说明自己的边界', price: 45, charUse: true },
  { id: 'daytogether', name: '一整天卡', icon: '☀', effect: '和对方商量并规划一个相处日，明确还没发生', price: 95, charUse: true },
  { id: 'myturn', name: '今天我说了算', icon: '✦', effect: '接下来由对方提出想一起做的事，商量彼此都能接受的安排', price: 75, charUse: true, turns: 3 },
  { id: 'nolecture', name: '免唠叨卡', icon: '○', effect: '这几轮先接住对方的感受，避免说教和比较', price: 45, charUse: true, turns: 3 },
  { id: 'oldstory', name: '往事卡', icon: '▤', effect: '分享角色设定或已有记忆里的一件往事，没有依据时坦诚说不记得', price: 50, charUse: true },
  { id: 'secret', name: '秘密交换卡', icon: '✉', effect: '邀请交换一件愿意分享的心事，可以选择保留', price: 60, charUse: true },
  { id: 'missyou', name: '想你卡', icon: '♡', effect: '用真实记忆或刚发生的事说清楚什么时候想起对方', price: 45, charUse: true, relation: 'love' },
  { id: 'confess', name: '藏心话卡', icon: '✉', effect: '分享一件之前没说出口、愿意现在谈的心事', price: 50, charUse: true, relation: 'love' },
  { id: 'clingy', name: '黏人日卡', icon: '♥', effect: '接下来几轮，在双方愿意的范围内给对方多一点陪伴', price: 60, charUse: true, turns: 3, relation: 'love' },
  { id: 'futuretalk', name: '未来卡', icon: '✧', effect: '认真谈一次彼此期待的未来，区分愿望和已决定的安排', price: 70, charUse: true, relation: 'love' },
  { id: 'spoil', name: '宠溺卡', icon: '♡', effect: '接下来几轮用角色自己的方式表达偏爱与照顾', price: 70, charUse: true, turns: 3, relation: 'love' },
  { id: 'checkin', name: '报平安卡', icon: '⌂', effect: '结合现有场景报平安，地点或近况没有依据时不要编造', price: 35, charUse: true, relation: 'family' },
  { id: 'praise', name: '夸夸卡', icon: '✦', effect: '具体说一件让你替对方高兴的事', price: 35, charUse: true, relation: 'family' },
  { id: 'oldphoto', name: '老照片卡', icon: '▧', effect: '讲一张旧照片背后的记忆，资料里没有照片就聊能确认的旧事', price: 55, charUse: true, relation: 'family' },
  { id: 'dontworry', name: '别扛卡', icon: '☘', effect: '接下来几轮可以坦白自己的压力，和对方商量怎么分担', price: 55, charUse: true, turns: 3, relation: 'family' },
  { id: 'reunion', name: '团圆卡', icon: '⌂', effect: '和家人商量一次聚会，时间地点由双方确认', price: 80, charUse: true, relation: 'family' },
  { id: 'iwaswrong', name: '我错了卡', icon: '◇', effect: '如果曾误会对方，具体承认这件事并道歉', price: 60, charUse: true, relation: 'family' },
  { id: 'heirloom', name: '家传卡', icon: '▤', effect: '分享角色设定里的一道菜、一个故事或一件家传物品', price: 65, charUse: true, relation: 'family' },
  { id: 'gossip', name: '八卦卡', icon: '✉', effect: '聊一件双方愿意分享的趣事，避免编造别人的隐私', price: 35, charUse: true, relation: 'friend' },
  { id: 'coverme', name: '打掩护卡', icon: '◇', effect: '问朋友希望得到什么支持，再商量能怎么帮忙', price: 55, charUse: true, relation: 'friend' },
  { id: 'wingman', name: '助攻卡', icon: '✦', effect: '帮朋友准备一次难以开口的交流，尊重对方的决定', price: 55, charUse: true, relation: 'friend' },
  { id: 'hardtruth', name: '毒舌卡', icon: '♜', effect: '以朋友间的直率说出真话，具体谈事并尊重界限', price: 45, charUse: true, relation: 'friend' },
  { id: 'roast', name: '互损卡', icon: '◇', effect: '用双方能接受的朋友式玩笑接话，看到不适就停', price: 45, charUse: true, turns: 2, relation: 'friend' },
  { id: 'roadtrip', name: '说走就走卡', icon: '☀', effect: '把常提的旅行整理成可讨论的计划，不直接出发或预订', price: 75, charUse: true, relation: 'friend' },
  { id: 'ridedie', name: '死党卡', icon: '☘', effect: '结合你们的真实互动，说说这段友情为什么重要', price: 60, charUse: true, relation: 'friend' },
];

export const cardMatchesRelation = (card: Card, relation: Relation) => !card.relation || card.relation === relation;

export function exchangeCard(bond: Bond, card: Card, side: Side): Bond {
  if (!Number.isSafeInteger(card.price) || card.price < 1 || card.price > 10_000)
    throw new Error('卡片价格无效');
  if (!cardMatchesRelation(card, bond.relation) || bond.disabledCards || bond.hidden.includes(card.id) || (side === 'them' && !card.charUse))
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
    played: [...bond.played, { id: crypto.randomUUID(), card, side, note, at: now }].slice(-100),
  };
}

export const reward = (bond: Bond, claim: string, amount: number, side: Side = 'me'): Bond =>
  bond.claims.includes(claim) ? bond : {
    ...bond, claims: [...bond.claims, claim],
    points: { ...bond.points, [side]: bond.points[side] + amount, shared: bond.points.shared + amount },
  };
