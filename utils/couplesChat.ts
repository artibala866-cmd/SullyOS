import { cardMatchesRelation, canRolePlay, canWaterPlant, careForPlant, harvestPlant, plantStage, createEntry, dayKey, exchangeCard, playCard, deliverBondMessage, readBond, readSpaces, relationNames, reward, shopCards, writeBond, type Bond } from './couplesSpace';
import type { APIConfig, CharacterProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import { characterBlocksUser, userBlocksCharacter } from './chatBlock';
import { extractJson } from './safeApi';

const active = (bond: Bond) => bond.disabledCards ? [] : bond.played.filter(play => play.side === 'me' &&
  cardMatchesRelation(play.card, bond.relation) && !bond.hidden.includes(play.card.id) && (play.usedTurns ?? 0) < (play.card.turns ?? 1));
const roleCards = (bond: Bond) => [...shopCards, ...bond.cards].filter(card => cardMatchesRelation(card, bond.relation) && card.charUse && canRolePlay(bond, card.id) &&
  (bond.bags.them[card.id] > 0 || bond.points.them >= card.price));

export function couplesChatContext(bond: Bond) {
  if (bond.status !== 'open') return '';
  const effects = active(bond);
  const diaries = bond.diaryContext ? bond.entries.filter(row => row.kind === 'diary')
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-3) : [];
  const context = [
    ...effects.map(({ card, note }) => `用户对你打出了「${card.name}」：${card.effect}${note ? `。附言：${note}` : ''}。请自然回应，尊重双方界限。`),
    ...diaries.map(row => `${row.date} ${row.side === 'me' ? '用户' : '你'}的交换日记：${row.body.slice(0, 550)}`),
    ...(bond.hollowAuto ? bond.entries.filter(row => row.kind === 'hollow' && row.side === 'them' && !row.done).slice(-2)
      .map(row => `你曾在树洞里写下的心事（这是你的私下感受，别假定对方看过）：${row.body.slice(0, 400)}`) : []),
    ...(bond.pact?.status === 'accepted' ? [`你已同意的共同约定：${bond.pact.wish}`] : []),
  ];
  return context.length ? `【双方的${relationNames[bond.relation]}空间】\n${context.join('\n')}` : '';
}

export async function pairedCouplesChatContext(charId: string) {
  const spaces = await readSpaces();
  const pairs = Object.values(spaces).filter(bond => bond.status === 'open' && bond.members.length === 2 &&
    bond.members.includes(charId)).slice(0, 4);
  const snippets = (await Promise.all(pairs.map(async bond => {
    const partnerId = bond.members.find(id => id !== charId);
    const partner = partnerId ? await DB.getCharacter(partnerId) : undefined;
    if (!partner) return '';
    const entries = bond.entries.filter(row => row.kind === 'timeline' || row.kind === 'anniversary' || row.kind === 'wish' || row.kind === 'gift')
      .slice(-3).map(row => `${row.date} ${row.title}：${row.body.slice(0, 200)}`).join('；');
    return `与 ${partner.name} 的${relationNames[bond.relation]}空间${entries ? '：' + entries : ''}`;
  }))).filter(Boolean);
  return snippets.length ? '【你与其他角色的羁绊】以下是角色空间中的记录，可能含演绎。只在当前话题相关时使用，不当作你和用户的共同经历：\n' + snippets.join('\n') : '';
}

export async function settleCouplesChat(
  char: CharacterProfile, user: UserProfile, api: APIConfig, snapshot: Bond,
  lastUser: Message, reply: string, signal: AbortSignal,
  effectsDelivered: boolean,
) {
  if (signal.aborted) return;
  const ids = [char.id];
  const ready = (current: Bond | undefined) => current?.id === snapshot.id && current.status === 'open';
  const effectKey = (play: Bond['played'][number]) => play.id ?? `${play.card.id}:${play.at}`;
  const effects = effectsDelivered ? new Set(active(snapshot).map(effectKey)) : new Set<string>();
  const updated = await writeBond(ids, current => {
    if (signal.aborted || !current || !ready(current) || (current.lastSceneTurn ?? 0) >= lastUser.id) return current;
    const settled = {
      ...current, lastSceneTurn: lastUser.id,
      played: current.played.map(play => play.side === 'me' && effects.has(effectKey(play)) ? { ...play, usedTurns: (play.usedTurns ?? 0) + 1 } : play),
    };
    return reward(reward(settled, `conversation:me:${dayKey()}`, 20), `conversation:them:${dayKey()}`, 20, 'them');
  });
  if (!updated || !ready(updated) || updated.lastSceneTurn !== lastUser.id || signal.aborted) return;
  const hasDiary = (bond: Bond) => bond.entries.some(row => row.kind === 'diary' && row.side === 'them' && row.date === dayKey());
  const diary = updated.diaryAuto && !hasDiary(updated);
  const cards = updated.autoCards ? roleCards(updated) : [];
  const shouldVisitHollow = updated.hollowAuto && !updated.entries.some(row => row.kind === 'hollow' && row.side === 'them' && row.date === dayKey());
  const shouldCare = updated.plantAuto && canWaterPlant(updated.plant);
  const shouldHarvest = updated.plantAuto && plantStage(updated.plant) === '开花';
  if (!diary && !cards.length && !shouldVisitHollow && !shouldCare && !shouldHarvest) return;
  // Reserve an observation once per delivered user turn across tabs and retries.
  const claim = `scene:${lastUser.id}`;
  let reserved = false;
  await writeBond(ids, current => {
    if (!current || !ready(current) || current.lastSceneTurn !== lastUser.id || current.claims.includes(claim)) return current;
    reserved = true;
    return { ...current, claims: [...current.claims.filter(value => !value.startsWith('scene:')), claim] };
  });
  if (!reserved || signal.aborted) return;
  const fresh = await DB.getCharacter(char.id);
  const latest = await readBond(ids);
  if (!fresh || !latest || !ready(latest) || latest.lastSceneTurn !== lastUser.id || signal.aborted ||
    characterBlocksUser(fresh.chatBlock) || userBlocksCharacter(fresh.chatBlock)) return;
  const writeDiary = diary && latest.diaryAuto && !hasDiary(latest);
  const visitHollow = shouldVisitHollow && latest.hollowAuto &&
    !latest.entries.some(row => row.kind === 'hollow' && row.side === 'them' && row.date === dayKey());
  const sameCycle = latest.plant.cycleId === updated.plant.cycleId;
  const water = shouldCare && latest.plantAuto && sameCycle && canWaterPlant(latest.plant);
  const harvest = shouldHarvest && latest.plantAuto && sameCycle && plantStage(latest.plant) === '开花';
  const offeredCards = latest.autoCards ? roleCards(latest).filter(card => cards.some(previous => previous.id === card.id)) : [];
  const actions = [
    writeDiary ? `diary：写一段今天的角色日记，风格：${latest.diaryStyle || '角色原有风格'}。` : '',
    visitHollow ? 'hollow：有一件确实不适合当面说的具体心事才填。' : '',
    water ? 'water：只有角色此刻有理由和空闲照料两人的盆栽时填 true，否则填 false。' : '',
    harvest ? 'harvest：只有此刻适合送花才为 true，flowerScene：写一小段亲手送出这盆已开花的盆栽的小剧场。' : '',
    offeredCards.length ? `card：只有当前话题适合才选一个 ID，否则留空。note：角色用自己的口吻写打出该卡的内容，表达卡片效果。可用卡：${offeredCards.map(item => `${item.id}=${item.name}（${item.effect}）`).join('、')}。` : '',
  ].filter(Boolean);
  if (!actions.length || signal.aborted) return;
  const { generateBondText } = await import('./couplesGeneration');
  if (signal.aborted) return;
  const result = extractJson(await generateBondText(fresh, user, api, latest, [
    '延续刚刚真实发生的私聊，只输出 JSON 对象。没有合适内容的字段留空，不编造事实。',
    `本轮用户：${lastUser.content.slice(0, 900)}\n角色：${reply.slice(0, 900)}`,
    ...actions,
  ].join('\n'), signal));
  if (!result || signal.aborted) return;
  const stillAllowed = await DB.getCharacter(char.id);
  if (!stillAllowed || characterBlocksUser(stillAllowed.chatBlock) || userBlocksCharacter(stillAllowed.chatBlock)) return;
  const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 2000) : '';
  const cardId = text(result.card);
  const note = text(result.note);
  const diaryText = text(result.diary);
  const hollow = text(result.hollow);
  await writeBond(ids, current => {
    if (!current || !ready(current) || current.lastSceneTurn !== lastUser.id || current.relation !== latest.relation || signal.aborted) return current;
    const entries = [...current.entries];
    if (writeDiary && current.diaryAuto && diaryText && !hasDiary(current))
      entries.push(createEntry('diary', '今日记事', diaryText, 'them'));
    if (visitHollow && current.hollowAuto && hollow && !entries.some(row => row.kind === 'hollow' && row.side === 'them' && row.date === dayKey()))
      entries.push(createEntry('hollow', '未说出口的话', hollow, 'them'));
    const record = { ...current, entries };
    const samePlant = current.plant.cycleId === latest.plant.cycleId;
    const cared = water && samePlant && current.plantAuto && result.water === true && canWaterPlant(current.plant)
      ? careForPlant(record, 'water', 'them') : record;
    return harvest && samePlant && current.plantAuto && result.harvest === true &&
      current.plant.watered === latest.plant.watered && plantStage(cared.plant) === '开花'
      ? harvestPlant(cared, 'them', user.name, text(result.flowerScene)) : cared;
  });
  const card = note && offeredCards.find(item => item.id === cardId);
  if (!card || signal.aborted) return;
  await deliverBondMessage(latest, `couples-play:${snapshot.id}:${lastUser.id}`, {
    charId: char.id, role: 'assistant', type: 'text', content: `【${card.name}】${note}`,
    metadata: { couplesSpace: { label: '角色出牌' } },
  }, current => !!current && !characterBlocksUser(current.chatBlock) && !userBlocksCharacter(current.chatBlock), current => {
    if (signal.aborted || current.lastSceneTurn !== lastUser.id || current.relation !== latest.relation || !current.autoCards) return;
    const available = roleCards(current).find(item => item.id === card.id);
    if (!available || JSON.stringify(available) !== JSON.stringify(card)) return;
    return playCard(current.bags.them[card.id] ? current : exchangeCard(current, card, 'them'), card, 'them', note);
  });
}
