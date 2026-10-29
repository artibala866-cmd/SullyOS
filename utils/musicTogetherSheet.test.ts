// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { MusicTogetherSheet, type MusicTogetherPerson } from '../apps/music/MusicTogetherSheet';

let host: HTMLDivElement;
let opener: HTMLButtonElement;
let root: Root;

const people: MusicTogetherPerson[] = [
  { id: 'a', name: '周树生', incoming: true, trackName: 'My Jinji', active: false },
  { id: 'b', name: '陈众木', incoming: false, active: true },
  { id: 'c', name: '很长很长很长很长很长的角色名称', incoming: false, active: false, outgoing: 'pending' },
];
const handlers = () => ({
  onClose: vi.fn(), onAnswer: vi.fn(), onInvite: vi.fn(), onCancel: vi.fn(), onEnd: vi.fn(),
});

const render = async (props: React.ComponentProps<typeof MusicTogetherSheet>) => {
  await act(async () => { root.render(React.createElement(MusicTogetherSheet, props)); });
};
const press = async (button: Element | null) => {
  expect(button).not.toBeNull();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};
const byLabel = (label: string) =>
  host.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  opener = document.createElement('button');
  opener.textContent = '打开一起听';
  document.body.appendChild(opener);
  opener.focus();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  opener.remove();
  vi.unstubAllGlobals();
});

describe('一起听独立弹层真实点击与键盘回归', () => {
  it('初始焦点在关闭按钮，Tab 在弹层内循环，不能落到背后的页面', async () => {
    const h = handlers();
    await render({ people, ...h });
    const close = byLabel('关闭一起听面板')!;
    expect(document.activeElement).toBe(close);
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('section button'));
    const last = buttons[buttons.length - 1];
    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    // A programmatic focus on the music page must be redirected into the dialog.
    opener.focus();
    expect(document.activeElement).toBe(close);
  });

  it('Esc 和遮罩分别可关闭，关闭后焦点返回打开入口', async () => {
    const h = handlers();
    await render({ people, ...h });
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(h.onClose).toHaveBeenCalledOnce();
    await press(host.querySelector('[aria-hidden="true"].absolute'));
    expect(h.onClose).toHaveBeenCalledTimes(2);
    await act(async () => root.render(React.createElement(React.Fragment)));
    expect(document.activeElement).toBe(opener);
  });

  it('用户点击接受不自动关窗；重复角色可撤回，进行中可结束', async () => {
    const h = handlers();
    await render({ people, ...h });
    await press(byLabel('接受 周树生 的一起听邀请'));
    expect(h.onAnswer).toHaveBeenCalledWith('a', true);
    await press(byLabel('拒绝 周树生 的一起听邀请'));
    expect(h.onAnswer).toHaveBeenCalledWith('a', false);
    await press(byLabel('结束与 陈众木 的一起听'));
    expect(h.onEnd).toHaveBeenCalledWith('b');
    await press(byLabel('撤回与 很长很长很长很长很长的角色名称 的一起听'));
    expect(h.onCancel).toHaveBeenCalledWith('c');
    expect(h.onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('320px 及短屏布局使用可滚动内容、可触控按钮和底部安全区域', async () => {
    const h = handlers();
    await render({ people, ...h });
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const list = dialog.querySelector<HTMLElement>('.overflow-y-auto')!;
    expect(dialog.style.maxHeight).toContain('72dvh');
    // jsdom intentionally drops CSS env() values from CSSStyleDeclaration.
    // Assert the real WebView style declaration in source, not jsdom's parser.
    const source = readFileSync(new URL('../apps/music/MusicTogetherSheet.tsx', import.meta.url), 'utf8');
    expect(source).toContain("paddingBottom: 'env(safe-area-inset-bottom, 0px)'");
    expect(list.className).toContain('min-h-0');
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const b of buttons.slice(1)) expect(b.className).toContain('min-h-11');
  });
});
