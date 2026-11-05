import { describe, expect, it, vi } from 'vitest';
vi.mock('./db', () => ({ DB: {} }));
import { DAY, type Bond, canWaterPlant, careForPlant, collectPlantDroplets, harvestPlant, replantBond, rolePointStats, plantCareWait, plantStage, capsuleStatus, reward, exchangeCard, playCard, isRecentPlantWatering, PLANT_WATER_NOTICE_MS, pickHollowPaper, type Card, type Entry } from './couplesSpace';

const NOW = new Date(2026, 10, 5, 12).getTime();
function bond(): Bond {
  return {
    id: 'bond-test', members: ['user'], relation: 'love', status: 'open', start: '2026-11-05',
    entries: [], plant: { xp: 0, watered: NOW - DAY, careCount: 0 }, touches: 0,
    hidden: [], cards: [], bags: { me: {}, them: {} },
    points: { me: 0, them: 0, shared: 0 }, played: [], claims: [],
  };
}

describe('couples garden cooldowns and activity state', () => {
  it('lets a seed be watered once, records real activity, then blocks repeat watering for four hours', () => {
    const first = careForPlant(bond(), 'water', 'me', NOW);
    expect(first.plant.xp).toBe(12);
    expect(first.plant.cycleWaters).toBe(1);
    expect(first.plant.watered).toBe(NOW);
    expect(first.plant.lastSide).toBe('me');
    expect(first.plant.lastCaredAt).toBe(NOW);
    expect(canWaterPlant(first.plant, NOW + 60_000)).toBe(false);
    expect(plantCareWait(first.plant, 'water', NOW + 60_000)).toBe(4 * 3_600_000 - 60_000);
    expect(() => careForPlant(first, 'water', 'me', NOW + 3_600_000)).toThrow();
    const next = careForPlant(first, 'water', 'them', NOW + 4 * 3_600_000);
    expect(next.plant.xp).toBe(24);
    expect(next.plant.lastSide).toBe('them');
    expect(next.plant.lastCaredAt).toBe(NOW + 4 * 3_600_000);
  });

  it('collects a partner’s drops once and harvests one correctly attributed gift', () => {
    const watered = careForPlant({ ...bond(), plant: { ...bond().plant, xp: 84 } }, 'water', 'them', NOW);
    expect(watered.plant.droplets).toBe(1);
    expect(watered.plant.partnerCare).toBe(1);
    const bloom = collectPlantDroplets(watered);
    expect(bloom.plant.xp).toBe(100);
    expect(collectPlantDroplets(bloom)).toBe(bloom);
    const harvested = harvestPlant(bloom, 'them', '小满', '送你一束春天', NOW);
    expect(harvested.flowers).toMatchObject([{ from: 'them', story: '送你一束春天' }]);
    expect(harvested.entries).toMatchObject([{ kind: 'gift', side: 'them', body: '送你一束春天' }]);
    expect(harvested.plant).toMatchObject({ xp: 0, droplets: 0, partnerCare: 0 });
    expect(() => harvestPlant(harvested, 'me', '知夏', undefined, NOW)).toThrow();
  });

  it('changes the planting cycle and preserves collected gifts, care history and scores', () => {
    const original = { ...bond(), flowers: [{ id: 'flower', name: '雏菊', from: 'them' as const, date: '2026-11-05' }] };
    const first = careForPlant(original, 'water', 'them', NOW);
    const replanted = replantBond(first, NOW);
    expect(replanted.plant.cycleId).not.toBe(first.plant.cycleId);
    expect(replanted.plant).toMatchObject({ xp: 0, droplets: 0, careCount: 1 });
    expect(replanted.flowers).toEqual(original.flowers);
    expect(replanted.points).toEqual(first.points);
  });

  it('tracks only newly earned and spent role points without rewriting a legacy balance', () => {
    const legacy = { ...bond(), points: { me: 0, them: 70, shared: 0 } };
    expect(rolePointStats(legacy)).toEqual({ earned: 0, spent: 0, refunded: 0 });
    const earned = reward(legacy, 'conversation:test', 20, 'them');
    expect(reward(earned, 'conversation:test', 20, 'them')).toBe(earned);
    const card: Card = { id: 'qa', name: '测试', price: 35, icon: '♡', effect: '测试', charUse: true };
    const bought = exchangeCard(earned, card, 'them');
    expect(bought.points.them).toBe(55);
    expect(rolePointStats(bought)).toEqual({ earned: 20, spent: 35, refunded: 0 });
  });

  it('tracks fertilizer separately and never attributes it to a watering record', () => {
    const first = careForPlant(bond(), 'fertilize', 'me', NOW);
    expect(first.plant.xp).toBe(22);
    expect(first.plant.lastCaredAt).toBe(NOW);
    expect(first.plant.lastSide).toBeUndefined();
    expect(first.plant.watered).toBe(NOW - DAY);
    expect(plantCareWait(first.plant, 'fertilize', NOW + 12 * 3_600_000)).toBe(12 * 3_600_000);
    expect(() => careForPlant(first, 'fertilize', 'me', NOW + DAY - 1)).toThrow();
    expect(careForPlant(first, 'fertilize', 'me', NOW + DAY).plant.xp).toBe(44);
  });

  it('requires replanting when unwatered for three days, without API activity', () => {
    const neglected = bond();
    neglected.plant.watered = NOW - 3 * DAY;
    expect(plantStage(neglected.plant, NOW)).toBe('枯萎');
    expect(plantCareWait(neglected.plant, 'water', NOW)).toBe(Infinity);
    expect(plantCareWait(neglected.plant, 'fertilize', NOW)).toBe(Infinity);
    expect(() => careForPlant(neglected, 'water', 'me', NOW)).toThrow('重新播种');
  });

  it('keeps atomic earned points and claim rewards idempotent', () => {
    const cared = careForPlant(bond(), 'water', 'me', NOW);
    expect(cared.points.me).toBe(8);
    expect(cared.points.shared).toBe(10);
    const once = reward(cared, 'care:2026-11-05', 25);
    expect(reward(once, 'care:2026-11-05', 25)).toEqual(once);
  });
});

describe('time-capsule privacy', () => {
  const entry = { id: 'capsule', kind: 'capsule' as const, title: '未来信', date: '2026-10-20', body: 'private',
    side: 'me' as const };
  it('does not expose old capsules with no unlock date', () => {
    expect(capsuleStatus(entry, '2026-11-05')).toBe('sealed');
  });
  it('releases explicitly dated capsules only on or after the intended day', () => {
    expect(capsuleStatus({ ...entry, unlockDate: '2026-12-01' }, '2026-11-05')).toBe('sealed');
    expect(capsuleStatus({ ...entry, unlockDate: '2026-12-01' }, '2026-12-01')).toBe('ready');
    expect(capsuleStatus({ ...entry, opened: true, unlockDate: '2026-12-01' }, '2026-11-05')).toBe('opened');
  });
});

describe('couples shop transactions', () => {
  const card: Card = { id: 'hug', name: '拥抱卡', icon: '♡', effect: '拥抱', price: 40, charUse: true };
  it('blocks invalid custom prices at the transaction boundary', () => {
    const account = { ...bond(), points: { me: 100, them: 0, shared: 0 } };
    expect(() => exchangeCard(account, { ...card, price: -100 }, 'me')).toThrow('价格无效');
    expect(() => exchangeCard(account, { ...card, price: Number.NaN }, 'me')).toThrow('价格无效');
    expect(() => exchangeCard(account, { ...card, price: 10001 }, 'me')).toThrow('价格无效');
  });
  it('checks stock, debits exactly once and identifies each play for delivery rollback', () => {
    const account = { ...bond(), points: { me: 100, them: 0, shared: 0 } };
    const bought = exchangeCard(account, card, 'me');
    expect(bought.points.me).toBe(60);
    expect(bought.bags.me[card.id]).toBe(1);
    const played = playCard(bought, card, 'me', '今天也想抱你', NOW);
    expect(played.bags.me[card.id]).toBe(0);
    expect(played.played).toHaveLength(1);
    expect(played.played[0].id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(() => playCard(played, card, 'me', '', NOW)).toThrow('不可打出');
  });
});

describe('watering notice is temporary', () => {
  it('shows only after a genuine watering and disappears after 12 seconds', () => {
    const fresh = careForPlant(bond(), 'water', 'me', NOW);
    expect(isRecentPlantWatering(fresh.plant, NOW)).toBe(true);
    expect(isRecentPlantWatering(fresh.plant, NOW + PLANT_WATER_NOTICE_MS - 1)).toBe(true);
    expect(isRecentPlantWatering(fresh.plant, NOW + PLANT_WATER_NOTICE_MS)).toBe(false);
    expect(isRecentPlantWatering(fresh.plant, NOW - 1)).toBe(false);
    expect(isRecentPlantWatering({ ...fresh.plant, lastSide: undefined }, NOW)).toBe(false);
  });
});

describe('tree hollow shake-to-draw paper', () => {
  const note = (id: string, side: 'me' | 'them', done = false): Entry => ({
    id, kind: 'hollow', title: '密封纸条', body: '只在打开时阅读',
    date: '2026-11-05', side, done,
  });
  it('shows no invented message when the hollow is empty', () => {
    expect(pickHollowPaper([])).toBeUndefined();
  });
  it('prefers unread character notes without immediately repeating the previous paper', () => {
    const all = [note('me', 'me'), note('a', 'them'), note('b', 'them')];
    expect(pickHollowPaper(all, undefined, 0)?.id).toBe('a');
    expect(pickHollowPaper(all, 'a', 0)?.id).toBe('b');
    expect(pickHollowPaper(all, 'b', 0.95)?.id).toBe('a');
  });
  it('falls back to personal notes and never mixes in unrelated records', () => {
    const only = [note('old', 'them', true), note('me', 'me')];
    expect(pickHollowPaper(only, undefined, 0.999)?.id).toBe('me');
    expect(pickHollowPaper([{...only[0],kind:'mail'}])).toBeUndefined();
    expect(pickHollowPaper(only, 'me', 0)?.id).toBe('old');
  });
});
