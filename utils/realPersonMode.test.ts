import { describe, expect, it, vi } from 'vitest';
import { canRealPersonContact, shouldAutoReplyToUser, isRealPersonModeEnabled, setRealPersonModeEnabled, REAL_PERSON_AUTONOMY_INSTRUCTION } from './realPersonMode';

describe('真人感与主动消息的唯一触发权限', () => {
  const role = (enabled: boolean) => ({ activeMsg2Config: { enabled } }) as any;
  it('旧存档保持原版开启默认值及显式关闭优先', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => { store.set(key, val); },
    });
    try {
      expect(isRealPersonModeEnabled()).toBe(true);
      setRealPersonModeEnabled(true);
      expect(isRealPersonModeEnabled()).toBe(true);
      setRealPersonModeEnabled(false);
      expect(isRealPersonModeEnabled()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('真人感自己接话无需主动消息 2.0，关闭后旧普通自动回复不能绕过授权', () => {
    expect(shouldAutoReplyToUser(true, false)).toBe(true);
    expect(shouldAutoReplyToUser(true, true)).toBe(true);
    expect(shouldAutoReplyToUser(false, true)).toBe(false);
    expect(shouldAutoReplyToUser(false, false)).toBe(false);
    expect(canRealPersonContact(role(false), true)).toBe(false);
  });
  it('两者都开启才能启动自主联系', () => {
    expect(canRealPersonContact(role(true), true)).toBe(true);
    expect(canRealPersonContact(role(true), false)).toBe(false);
    expect(canRealPersonContact(role(false), true)).toBe(false);
    expect(canRealPersonContact(null, true)).toBe(false);
  });
  it('自主联系没有证据时沉默，不把空泛问候当成任务', () => {
    expect(REAL_PERSON_AUTONOMY_INSTRUCTION).toContain('[[SILENT]]');
    expect(REAL_PERSON_AUTONOMY_INSTRUCTION).toContain('时间到了不是聊天理由');
    expect(REAL_PERSON_AUTONOMY_INSTRUCTION).toContain('不要凭空捏造生活事件');
    expect(REAL_PERSON_AUTONOMY_INSTRUCTION).not.toContain('拿不准就说');
  });
});
