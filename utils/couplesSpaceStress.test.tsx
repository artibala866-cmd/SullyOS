// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { BondRecords } from '../apps/couplesSpace/records';
import { BondShop } from '../apps/couplesSpace/shop';
import { DAY, careForPlant, createBond, createEntry, exchangeCard, playCard, readBond, reward, shopCards, writeBond, type Bond, type Entry, type EntryKind } from './couplesSpace';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const ns = () => 'pressure-' + crypto.randomUUID();
const makeRows = (size: number): Entry[] => {
  const kinds: EntryKind[] = ['timeline', 'wish', 'mail', 'capsule', 'gift', 'anniversary', 'diary', 'hollow'];
  return Array.from({ length: size }, (_, i) => {
    const kind = kinds[i % kinds.length];
    return { ...createEntry(kind, kind + '-' + i, '长内容：' + '双方在不同时间记录心情、旅行、礼物和约定。'.repeat(40), i % 2 ? 'them' : 'me'),
      id: 'stress-' + i,
      date: '2026-10-' + String(i % 28 + 1).padStart(2, '0'),
      ...(kind === 'capsule' ? { unlockDate: i % 4 ? '2027-10-10' : '2026-01-01', opened: i % 20 === 0 } : {}),
      ...(kind === 'wish' ? { wishCategory: 'places' as const, steps: [{ text: '第一步', done: false }] } : {}),
    };
  });
};

describe('情侣空间极限状态回归（独立虚构数据）', () => {
  it('4,800 records across 8 features survive 60 competing writes and fresh DB reads; another bond remains untouched', async () => {
    const one = [ns()], two = [ns()];
    const entries = makeRows(4800);
    await writeBond(one, () => ({ ...createBond(one), entries, status: 'open' }));
    const second = await writeBond(two, () => ({ ...createBond(two), entries: [createEntry('wish', '不能串档', '属于另一个空间')] }));
    await Promise.all(Array.from({ length: 60 }, (_, i) => writeBond(one, old => reward(old!, 'stress-claim-' + i, 1))));
    const restored = await readBond(one);
    expect(restored.entries).toHaveLength(4800);
    expect(new Set(restored.entries.map(item => item.id)).size).toBe(4800);
    expect(restored.points.me).toBe(60);
    expect(restored.points.shared).toBe(60);
    expect(await readBond(two)).toEqual(second);
    await Promise.all(Array.from({ length: 12 }, (_, i) => writeBond(one, current => ({
      ...current!, entries: current!.entries.map(e => e.id === 'stress-' + i ? { ...e, title: 'edited-' + i } : e),
    }))));
    const again = await readBond(one);
    expect(again.entries).toHaveLength(4800);
    for (let i = 0; i < 12; i++) expect(again.entries[i].title).toBe('edited-' + i);
    await writeBond(one, () => undefined);
    await writeBond(two, () => undefined);
  }, 120000);

  it('400 simultaneous same-claim attempts, 75 purchases and 40 care attempts cannot double-award or overspend', async () => {
    const ids = [ns()];
    const price = shopCards.find(card => card.id === 'hug')!;
    let initial = createBond(ids);
    initial = { ...initial, status: 'open', points: { me: price.price * 23, them: 10, shared: 0 },
      plant: { xp: 0, watered: Date.now() - DAY, careCount: 0 } };
    await writeBond(ids, () => initial);
    await Promise.all(Array.from({ length: 400 }, () => writeBond(ids, current => reward(current!, 'only-once', 30))));
    expect((await readBond(ids)).points.me).toBe(price.price * 23 + 30);
    const results = await Promise.allSettled(Array.from({ length: 75 }, () =>
      writeBond(ids, current => exchangeCard(current!, price, 'me'))));
    const purchased = results.filter(result => result.status === 'fulfilled').length;
    expect(purchased).toBe(23);
    expect((await readBond(ids)).bags.me.hug).toBe(23);
    expect((await readBond(ids)).points.me).toBe(30);
    const now = Date.now();
    const cares = await Promise.allSettled(Array.from({ length: 40 }, () =>
      writeBond(ids, current => careForPlant(current!, 'water', 'me', now))));
    expect(cares.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await readBond(ids)).plant.careCount).toBe(1);
    const plays = await Promise.allSettled(Array.from({ length: 45 }, () =>
      writeBond(ids, current => playCard(current!, price, 'me', '高速连点'))));
    expect(plays.filter(result => result.status === 'fulfilled')).toHaveLength(23);
    expect((await readBond(ids)).bags.me.hug).toBe(0);
    expect((await readBond(ids)).played).toHaveLength(23);
    await writeBond(ids, () => undefined);
  }, 120000);

  it('mounts actual React film, starfield, capsule and ticket shop with 2,400 entries through repeated page switching', async () => {
    const many = makeRows(2400);
    const ids = [ns()];
    const initial = {
      ...createBond(ids), status: 'open' as const, entries: many,
      points: { me: 4000, them: 0, shared: 3100 },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    function App() {
      const [bond, setBond] = useState<Bond>(initial);
      const [tab, setTab] = useState<EntryKind | 'shop'>('timeline');
      const change = async (fn: (current: Bond) => Bond) => { setBond(current => fn(current)); };
      return <div>
        <nav>{(['timeline','wish','mail','capsule','gift','anniversary','diary','hollow','shop'] as const)
          .map(kind => <button key={kind} data-stress-tab={kind} onClick={() => setTab(kind)}>{kind}</button>)}</nav>
        {tab === 'shop'
          ? <BondShop bond={bond} partner='模拟角色' change={change} generate={async () => '{"accept":false,"reply":"稍后"}'}
              share={async () => {}} busy={false}/>
          : <BondRecords key={tab} kind={tab} bond={bond} names={{ me:'本人', them:'模拟角色' }}
              change={change} generate={async () => '测试文本'} busy={false}/>}
        <output data-stress-active={tab}>{tab}</output>
      </div>;
    }
    try {
      await act(async () => root.render(<App />));
      expect(host.querySelectorAll('.couple-cinema-v2-cell')).toHaveLength(300);
      for (let round = 0; round < 3; round++) {
        for (const kind of ['wish','capsule','mail','gift','anniversary','diary','hollow','timeline','shop'] as const) {
          await act(async () => host.querySelector<HTMLButtonElement>('[data-stress-tab="' + kind + '"]')!.click());
          expect(host.querySelector('[data-stress-active="' + kind + '"]')).toBeTruthy();
          if (kind === 'timeline') expect(host.querySelectorAll('.couple-cinema-v2-cell')).toHaveLength(300);
          if (kind === 'wish') expect(host.querySelectorAll('.wish-universe-star')).toHaveLength(5);
          if (kind === 'capsule') expect(host.querySelectorAll('.couple-capsule-shelves button').length).toBeGreaterThan(200);
          if (kind === 'mail') expect(host.querySelectorAll('.couple-mail-trays button').length).toBeGreaterThan(250);
        }
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }, 120000);
});
