import { describe, expect, it, vi } from 'vitest';
vi.mock('./db', () => ({ DB: {} }));
import { DAY, type Bond, canWaterPlant, careForPlant, plantCareWait, plantStage, capsuleStatus, reward, exchangeCard, playCard, type Card } from './couplesSpace';

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
