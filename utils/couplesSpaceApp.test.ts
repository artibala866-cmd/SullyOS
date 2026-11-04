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

const findButton = (label: string) => Array.from(element.querySelectorAll('button')).find(item => item.textContent?.trim() === label);
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
  await waitFor(() => expect(element.querySelector('select')).not.toBeNull());
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
    expect(element.textContent).toContain('两个人的专属空间');
    await click('直接建立羁绊');
    await waitFor(() => expect(findButton('愿望清单')).toBeDefined());
    expect((await readBond(['partner-a'])).status).toBe('open');
    expect(await readBond(['partner-b'])).toBeUndefined();
    await click('同频阳台');
    await click('浇水');
    await waitFor(() => expect(element.textContent).toContain('12 / 100'));
    expect((await readBond(['partner-a'])).plant.xp).toBe(12);
    await act(async () => root.unmount());
    root = createRoot(element);
    await render();
    await click('同频阳台');
    expect(element.textContent).toContain('12 / 100');
  });

  it('lets a character decline a binding invitation and keeps the space locked', async () => {
    generateBondText.mockResolvedValue('{"accept":false,"reply":"再给我一点时间吧。"}');
    await render();
    await click('发送绑定申请');
    await waitFor(() => expect(element.textContent).toContain('婉拒了上一次邀请'));
    expect((await readBond(['partner-a'])).status).toBe('declined');
    expect(findButton('愿望清单')).toBeUndefined();
    await waitFor(() => expect(openApp).toHaveBeenCalledWith('chat'));
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
    await click('时间胶囊');
    expect(element.textContent).not.toContain(note.body);
    expect(findButton('分享到私聊')).toBeUndefined();
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
    let bond = createBond(['partner-a']);
    bond = careForPlant(bond, 'water', 'me', start);
    expect(() => careForPlant(bond, 'water', 'them', start + 1000)).toThrow();
    expect(plantStage(bond.plant, start + 3 * DAY)).toBe('枯萎');
    const card = shopCards[0];
    bond = playCard(exchangeCard(reward(bond, 'test', card.price), card, 'me'), card, 'me');
    expect(couplesChatContext(bond)).toContain('昵称卡');
    expect(couplesChatContext({ ...bond, disabledCards: true })).toBe('');
  });
});
