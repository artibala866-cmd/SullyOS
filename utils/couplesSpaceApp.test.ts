// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CouplesSpaceApp from '../apps/CouplesSpaceApp';
import { capsuleDate, capsuleStatus, careForPlant, createBond, createEntry, DAY, exchangeCard, playCard, plantStage, readBond, reward, shopCards, writeBond } from './couplesSpace';
import { couplesChatContext } from './couplesChat';
import { DB } from './db';
import type { CharacterProfile } from '../types';

const { openApp, setActiveCharacterId, generateBondText } = vi.hoisted(() => ({
  openApp: vi.fn(), setActiveCharacterId: vi.fn(), generateBondText: vi.fn(),
}));
vi.mock('../context/OSContext', () => ({
  useOS: () => ({
    activeCharacterId: 'partner-a', characters: [
      { id: 'partner-a', name: '知夏', avatar: '' },
      { id: 'partner-b', name: '晓白', avatar: '' },
    ], userProfile: { name: '小满', avatar: '', bio: '' },
    openApp, setActiveCharacterId, apiConfig: {}, closeApp: vi.fn(), addToast: vi.fn(),
  }),
}));
vi.mock('../hooks/useLocalBackHandler', () => ({ useLocalBackHandler: () => {} }));
vi.mock('./couplesGeneration', () => ({
  generateBondText,
  generateBondArtwork: vi.fn(),
  readPairDigest: vi.fn(),
}));

let element: HTMLDivElement;
let root: Root;

const findButton = (label: string) => Array.from(element.querySelectorAll('button')).find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label || item.querySelector('strong')?.textContent?.trim() === label);
async function click(label: string) {
  const target = findButton(label);
  expect(target, label).toBeDefined();
  await act(async () => target!.click());
}
async function waitFor(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
}

async function render() {
  await act(async () => root.render(React.createElement(CouplesSpaceApp)));
  await waitFor(() => expect(element.querySelector('.couple-picker-confirm')).not.toBeNull());
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  element = document.createElement('div');
  document.body.appendChild(element);
  root = createRoot(element);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  HTMLElement.prototype.scrollTo = vi.fn();
  generateBondText.mockReset();
  openApp.mockClear();
  await DB.saveCharacter({ id: 'partner-a', name: '知夏', avatar: '' } as CharacterProfile);
  await writeBond(['partner-a'], () => undefined);
  await writeBond(['partner-b'], () => undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.restoreAllMocks();
});

describe('情侣空间', () => {
  it('starts locked, binds directly, and reopens with the same partner’s data', async () => {
    await render();
    await click('选择此角色');
    await click('直接建立羁绊');
    await waitFor(() => expect(element.querySelector('.couple-ios-hero')).not.toBeNull());
    await click('心意');
    expect((await readBond(['partner-a'])).status).toBe('open');
    expect(await readBond(['partner-b'])).toBeUndefined();
    await click('同频阳台');
    await click('浇水');
    await waitFor(() => expect(element.textContent).toContain('12 / 100'));
    expect((await readBond(['partner-a'])).plant.xp).toBe(12);
    await act(async () => root.unmount());
    root = createRoot(element);
    await render();
    await click('进入专属空间');
    await click('心意');
    await click('同频阳台');
    expect(element.textContent).toContain('12 / 100');
  });

  it('lets a character decline a binding invitation and keeps the space locked', async () => {
    generateBondText.mockResolvedValue('{"accept":false,"reply":"再给我一点时间吧。"}');
    await render();
    await click('选择此角色');
    await click('发送绑定申请');
    await waitFor(() => expect(element.textContent).toContain('婉拒了上一次邀请'));
    expect((await readBond(['partner-a'])).status).toBe('declined');
    expect(findButton('愿望清单')).toBeUndefined();
    await waitFor(() => expect(openApp).toHaveBeenCalledWith('chat'));
  });

  it('closes without deleting records, isolates other roles, and restores under a new generation', async () => {
    const note = createEntry('diary', '旧日记', '仍然保存');
    const initial = await writeBond(['partner-a'], () => ({
      ...createBond(['partner-a']), status: 'open', diaryContext: true, entries: [note], cover: '/cover.png',
    }));
    const other = await writeBond(['partner-b'], () => ({ ...createBond(['partner-b']), status: 'open' }));
    await render();
    await click('进入专属空间');
    expect(element.querySelector('.couple-ios-cover')).not.toBeNull();
    await click('空间设置');
    await click('解除绑定');
    await click('保留空间');
    expect((await readBond(['partner-a'])).status).toBe('open');
    await click('解除绑定');
    await click('确认解除');
    await waitFor(() => expect(element.textContent).toContain('空间已关闭'));
    const closed = await readBond(['partner-a']);
    expect(closed.id).not.toBe(initial.id);
    expect(closed.entries).toEqual([note]);
    expect(couplesChatContext(closed)).toBe('');
    expect(await readBond(['partner-b'])).toEqual(other);
    await click('重新开启');
    await waitFor(() => expect(element.querySelector('.couple-ios-hero')).not.toBeNull());
    const restored = await readBond(['partner-a']);
    expect(restored.id).not.toBe(closed.id);
    expect(restored.entries).toEqual([note]);
    expect(restored.cover).toBe('/cover.png');
  });

  it('withdraws a pending invitation and ignores a late acceptance', async () => {
    let finish!: (value: string) => void;
    generateBondText.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    await render();
    await click('选择此角色');
    await click('发送绑定申请');
    await waitFor(() => expect(generateBondText).toHaveBeenCalled());
    await click('撤回绑定邀请');
    await waitFor(() => expect(findButton('撤回绑定邀请')).toBeUndefined());
    await act(async () => finish('{"accept":true,"reply":"晚到的回复"}'));
    expect(await readBond(['partner-a'])).toBeUndefined();
    expect(openApp).not.toHaveBeenCalled();
  });

  it('keeps pair keys independent and serializes concurrent point claims', async () => {
    const ids = ['partner-a', 'partner-b'];
    await writeBond(ids, () => createBond(ids, 'friend'));
    await Promise.all([
      writeBond(ids, current => reward(current!, 'once', 40)),
      writeBond([...ids].reverse(), current => reward(current!, 'once', 40)),
    ]);
    expect((await readBond(ids)).points.shared).toBe(40);
    expect((await readBond([...ids].reverse())).relation).toBe('friend');
    expect(await readBond(['partner-a'])).toBeUndefined();
  });

  it('keeps a sealed capsule private until it is opened, then shares it as a capsule', async () => {
    const note = createEntry('capsule', '一起去看海', '封存中的正文');
    await writeBond(['partner-a'], () => ({
      ...createBond(['partner-a']), status: 'open',
      entries: [{ ...note, unlockDate: capsuleDate(1) }],
    }));
    await render();
    await click('进入专属空间');
    await click('时间胶囊');
    expect(element.textContent).not.toContain(note.body);
    expect(findButton('分享到私聊')).toBeUndefined();
    await click('封存中的时间胶囊');
    expect(element.textContent).not.toContain(note.body);
    await click('提前拆封');
    await click('确认提前拆封');
    await waitFor(() => expect(element.textContent).toContain(note.body));
    await click('分享到私聊');
    await waitFor(() => expect(openApp).toHaveBeenCalledWith('chat'));
    const message = (await DB.getRecentMessagesByCharId('partner-a', 20)).find(item => item.content.includes(note.body));
    expect(message?.metadata.couplesSpace.label).toBe('时间胶囊');
    expect((await readBond(['partner-a'])).entries[0].openedEarly).toBe(true);
  });

  it('clamps the calendar shortcut and detects capsules due today', () => {
    expect(capsuleDate(1, new Date(2026, 0, 31))).toBe('2026-02-28');
    const note = { ...createEntry('capsule', '信', '正文'), unlockDate: '2026-02-28' };
    expect(capsuleStatus(note, '2026-02-27')).toBe('sealed');
    expect(capsuleStatus(note, '2026-02-28')).toBe('ready');
    expect(capsuleStatus({ ...note, opened: true }, '2026-02-28')).toBe('opened');
  });

  it('makes relationship-specific cards available only in the matching shop', () => {
    const card = shopCards.find(item => item.id === 'praise')!;
    const bond = reward(createBond(['partner-a'], 'family'), 'start', card.price);
    expect(exchangeCard(bond, card, 'me').bags.me[card.id]).toBe(1);
    expect(() => exchangeCard({ ...bond, relation: 'friend' }, card, 'me')).toThrow();
  });

  it('enforces the plant decay window and makes disabled cards invisible in chat', () => {
    const start = Date.now();
    let bond = { ...createBond(['partner-a']), status: 'open' as const } as ReturnType<typeof createBond>;
    bond = careForPlant(bond, 'water', 'me', start);
    expect(() => careForPlant(bond, 'water', 'them', start + 1000)).toThrow();
    expect(plantStage(bond.plant, start + 3 * DAY)).toBe('枯萎');
    const card = shopCards[0];
    bond = playCard(exchangeCard(reward(bond, 'test', card.price), card, 'me'), card, 'me');
    expect(couplesChatContext(bond)).toContain('昵称卡');
    expect(couplesChatContext({ ...bond, disabledCards: true })).toBe('');
  });
});
