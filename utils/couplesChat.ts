import { cardMatchesRelation, canRolePlay, canWaterPlant, careForPlant, createEntry, dayKey, exchangeCard, playCard, readBond, relationNames, reward, shopCards, writeBond, type Bond } from './couplesSpace';
import type { APIConfig, CharacterProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import { characterBlocksUser, userBlocksCharacter } from './chatBlock';
import { extractJson } from './safeApi';

const active = (bond: Bond) => bond.disabledCards ? [] : bond.played.filter(play => play.side === 'me' &&
  !bond.hidden.includes(play.card.id) && (play.usedTurns ?? 0) < (play.card.turns ?? 1));
const roleCards = (bond: Bond) => [...shopCards, ...bond.cards].filter(card => cardMatchesRelation(card, bond.relation) && card.charUse && canRolePlay(bond, card.id) &&
  (bond.bags.them[card.id] > 0 || bond.points.them >= card.price));

export function couplesChatContext(bond: Bond) {
  const effects = active(bond);
  const diaries = bond.diaryContext ? bond.entries.filter(row => row.kind === 'diary')
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-3) : [];
  const context = [
    ...effects.map(({ card, note }) => `用户对你打出了「${card.name}」：${card.effect}${note ? `。附言：${note}` : ''}。请自然回应，尊重双方界限。`),
    ...diaries.map(row => `${row.date} ${row.side === 'me' ? '用户' : '你'}的交换日记：${row.body.slice(0, 550)}`),
    ...(bond.pact?.status === 'accepted' ? [`你已同意的共同约定：${bond.pact.wish}`] : []),
  ];
  return context.length ? `【双方的${relationNames[bond.relation]}空间】\n${context.join('\n')}` : '';
}

export async function settleCouplesChat(
  char: CharacterProfile, user: UserProfile, api: APIConfig, snapshot: Bond,
  lastUser: Message, reply: string, signal: AbortSignal,
  effectsDelivered: boolean,
) {
  const ids = [char.id];
  const ready = (current: Bond | undefined) => current?.id === snapshot.id && current.status === 'open';
  const effects = effectsDelivered ? new Set(active(snapshot).map(play => play.at)) : new Set<number>();
  const updated = await writeBond(ids, current => {
    if (!current || !ready(current) || (current.lastSceneTurn ?? 0) >= lastUser.id) return current;
    const settled = {
      ...current, lastSceneTurn: lastUser.id,
      played: current.played.map(play => play.side === 'me' && effects.has(play.at) ? { ...play, usedTurns: (play.usedTurns ?? 0) + 1 } : play),
    };
    return reward(reward(settled, `conversation:me:${dayKey()}`, 20), `conversation:them:${dayKey()}`, 20, 'them');
  });
  if (!updated || !ready(updated) || signal.aborted) return;
  const hasDiary = (bond: Bond) => bond.entries.some(row => row.kind === 'diary' && row.side === 'them' && row.date === dayKey());
  const diary = updated.diaryAuto && !hasDiary(updated);
  const cards = updated.autoCards ? roleCards(updated) : [];
  const shouldVisitHollow = updated.hollowAuto && !updated.entries.some(row => row.kind === 'hollow' && row.date === dayKey());
  const shouldCare = updated.plantAuto && canWaterPlant(updated.plant);
  if (!diary && !cards.length && !shouldVisitHollow && !shouldCare) return;
  // Reserve an observation once per delivered user turn across tabs and retries.
  const claim = `scene:${lastUser.id}`;
  let reserved = false;
  await writeBond(ids, current => {
    if (!current || !ready(current) || current.claims.includes(claim)) return current;
    reserved = true;
    return { ...current, claims: [...current.claims.filter(value => !value.startsWith('scene:')), claim] };
  });
  if (!reserved || signal.aborted) return;
  const fresh = await DB.getCharacter(char.id);
  const latest = await readBond(ids);
  if (!fresh || !latest || !ready(latest) || signal.aborted ||
    characterBlocksUser(fresh.chatBlock) || userBlocksCharacter(fresh.chatBlock)) return;
  const { generateBondText } = await import('./couplesGeneration');
  const result = extractJson(await generateBondText(fresh, user, api, latest, [
    '延续刚刚真实发生的私聊，只输出 JSON 对象。没有合适内容的字段留空，不编造事实。',
    `本轮用户：${lastUser.content.slice(0, 900)}\n角色：${reply.slice(0, 900)}`,
    diary && latest.diaryAuto ? `diary：写一段今天的角色日记，风格：${latest.diaryStyle || '角色原有风格'}。` : '',
    shouldVisitHollow && latest.hollowAuto ? 'hollow：有一件确实不适合当面说的具体心事才填。' : '',
    shouldCare && latest.plantAuto ? 'water：只有角色此刻有理由和空闲照料两人的盆栽时填 true，否则填 false。' : '',
    latest.autoCards && cards.length ? `card：只有当前话题适合才选一个 ID，否则留空。note：角色用自己的口吻写打出该卡的内容，表达卡片效果。可用卡：${cards.map(item => `${item.id}=${item.name}（${item.effect}）`).join('、')}。` : '',
  ].filter(Boolean).join('\n'), signal));
  if (!result || signal.aborted) return;
  const stillAllowed = await DB.getCharacter(char.id);
  if (!stillAllowed || characterBlocksUser(stillAllowed.chatBlock) || userBlocksCharacter(stillAllowed.chatBlock)) return;
  const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 2000) : '';
  const cardId = text(result.card);
  const note = text(result.note);
  const diaryText = text(result.diary);
  const hollow = text(result.hollow);
  let sentCard: string | undefined;
  await writeBond(ids, current => {
    if (!current || !ready(current) || current.lastSceneTurn !== lastUser.id || signal.aborted) return current;
    const entries = [...current.entries];
    if (diary && current.diaryAuto && diaryText && !hasDiary(current))
      entries.push(createEntry('diary', '今日记事', diaryText, 'them'));
    if (current.hollowAuto && hollow && !entries.some(row => row.kind === 'hollow' && row.date === dayKey()))
      entries.push(createEntry('hollow', '未说出口的话', hollow, 'them'));
    const record = { ...current, entries };
    const next = shouldCare && current.plantAuto && result.water === true && canWaterPlant(current.plant)
      ? careForPlant(record, 'water', 'them') : record;
    const card = current.autoCards && note && cards.some(item => item.id === cardId) ? roleCards(current).find(item => item.id === cardId) : undefined;
    if (!card) return next;
    sentCard = card.name;
    return playCard(next.bags.them[card.id] ? next : exchangeCard(next, card, 'them'), card, 'them', note);
  });
  if (sentCard && !signal.aborted) await DB.saveMessageOnce(`couples-play:${snapshot.id}:${lastUser.id}`, {
    charId: char.id, role: 'assistant', type: 'text', content: `【${sentCard}】${note}`,
    metadata: { couplesSpace: { label: '角色出牌' } },
  });
}
