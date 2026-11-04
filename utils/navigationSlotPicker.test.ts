// @vitest-environment jsdom
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NavigationSlotPicker from '../components/settings/NavigationSlotPicker';
import { AppID } from '../types';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const click = async (name: string) => act(async () => {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(name));
  expect(button, name).toBeTruthy(); button!.click();
});
const search = async (text: string) => act(async () => {
  const input = host.querySelector('input')!; input.value = text; Simulate.change(input);
});
it('bounds DOM for 10,000 characters and searches/selects the actual stable ID', async () => {
  const onSelect = vi.fn();
  const characters = Array.from({ length: 10000 }, (_, index) => ({ id: `c${index}`, name: `角色 ${index}` }));
  await act(async () => root.render(React.createElement(NavigationSlotPicker, { slot: 0, characters, onSelect, onClose: vi.fn() })));
  await search('聊天'); await click('Message');
  expect(host.querySelectorAll('[role=listitem]').length).toBeLessThanOrEqual(12);
  await search('角色 9999'); expect(host.querySelector('[role=status]')?.textContent).toBe('1 个角色');
  await click('角色 9999'); expect(onSelect).toHaveBeenLastCalledWith({ appId: AppID.Chat, characterId: 'c9999', targetName: '角色 9999' });
});
it('opens 3D home for the selected character or directly to the character list', async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(React.createElement(NavigationSlotPicker, { slot: 1, characters: [{ id: 'c', name: 'Sully' }], onSelect, onClose: vi.fn() })));
  await search('小小窝'); await click('3D家园');
  await click('Sully');
  expect(onSelect).toHaveBeenLastCalledWith({ appId: AppID.Room, characterId: 'c', targetName: 'Sully' });
  await click('只打开3D家园列表');
  expect(onSelect).toHaveBeenLastCalledWith({ appId: AppID.Room });
});

it('exposes other App sections, then characters, and returns without accidentally saving', async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(React.createElement(NavigationSlotPicker, { slot: 0, characters: [{ id: 'c', name: 'Sully' }], onSelect, onClose: vi.fn() })));
  await search('查手机');
  expect(host.textContent).not.toContain('查手机');
  expect(onSelect).not.toHaveBeenCalled();
  await search('记忆宫殿'); await click('记忆宫殿'); await click('像素家园'); await click('Sully');
  expect(onSelect.mock.lastCall?.[0]).toMatchObject({ appId: AppID.MemoryPalace, entryId: 'pixelHome', characterId: 'c' });
});
it('offers actual saved content by stable ID and preserves root-only selection', async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(React.createElement(NavigationSlotPicker, { slot: 0, characters: [], resources: { [AppID.GroupChat]: [{ id: 'g2', name: '星星组' }, { id: 'g1', name: '星星组' }] }, onSelect, onClose: vi.fn() })));
  await search('群聊'); await click('群聊');
  expect(host.textContent).toContain('2 个内容');
  await click('星星组'); expect(onSelect.mock.lastCall?.[0]).toEqual({ appId: AppID.GroupChat, resourceId: 'g2', targetName: '星星组' });
  await click('只打开群聊列表'); expect(onSelect.mock.lastCall?.[0]).toEqual({ appId: AppID.GroupChat });
});
