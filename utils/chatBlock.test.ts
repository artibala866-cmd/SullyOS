import { describe, it, expect } from 'vitest';
import { changeChatBlock, configureCharacterBlocking, isPrivateChatBlocked, userBlocksCharacter, characterBlocksUser, allowsCharacterToBlock, isRejectedPrivateMessage, privateChatBlockDirection, privateChatDeliveryFailure, userBlockedCharacterAt } from './chatBlock';
describe('original two-way private chat blocking framework', () => {
  it('legacy character starts open', () => {
    expect(isPrivateChatBlocked()).toBe(false);
    expect(allowsCharacterToBlock()).toBe(true);
  });
  it('user blocks independently; duplicate event ignored; unblock restores own side', () => {
    const blocked = changeChatBlock(undefined, 'user', true, { at: 100, source: 'manual' });
    expect(userBlocksCharacter(blocked)).toBe(true);
    expect(characterBlocksUser(blocked)).toBe(false);
    expect(changeChatBlock(blocked, 'user', true, { at: 101 })).toBe(blocked);
    const unblocked = changeChatBlock(blocked, 'user', false, { at: 102 });
    expect(isPrivateChatBlocked(unblocked)).toBe(false);
    expect(unblocked.history?.map(e => e.action)).toEqual(['block', 'unblock']);
  });
  it('character block remains after user releases her block', () => {
    const first = changeChatBlock(undefined, 'user', true, { at: 1 });
    const both = changeChatBlock(first, 'character', true, { at: 2, reason: '严重冲突' });
    const released = changeChatBlock(both, 'user', false, { at: 3 });
    expect(isPrivateChatBlocked(released)).toBe(true);
    expect(userBlocksCharacter(released)).toBe(false);
    expect(characterBlocksUser(released)).toBe(true);
    expect(released.history?.[1].reason).toBe('严重冲突');
    expect(released.lastForgivenessCheckAt).toBe(2);
  });
  it('disabling autonomy clears character block only and prevents new character blocks', () => {
    const both = changeChatBlock(changeChatBlock(undefined, 'user', true, { at: 1 }), 'character', true, { at: 2 });
    const restricted = configureCharacterBlocking(both, false, 3);
    expect(userBlocksCharacter(restricted)).toBe(true);
    expect(characterBlocksUser(restricted)).toBe(false);
    expect(changeChatBlock(restricted, 'character', true, { at: 4 })).toBe(restricted);
    expect(characterBlocksUser(changeChatBlock(configureCharacterBlocking(restricted, true), 'character', true, { at: 5 }))).toBe(true);
  });
  it('方向有别：角色拒收不等于用户主动封锁，已拒收消息永久不可见于角色上下文', () => {
    const userOnly = changeChatBlock(undefined, 'user', true, { at: 5 });
    const charOnly = changeChatBlock(undefined, 'character', true, { at: 6 });
    expect(privateChatBlockDirection(userOnly)).toBe('user');
    expect(privateChatBlockDirection(charOnly)).toBe('character');
    expect(privateChatBlockDirection(changeChatBlock(userOnly, 'character', true, { at: 7 }))).toBe('both');
    expect(privateChatBlockDirection()).toBe('none');
    expect(isRejectedPrivateMessage({ role: 'user', metadata: { chatBlockRejected: true } } as any)).toBe(true);
    expect(isRejectedPrivateMessage({ role: 'user', metadata: {} } as any)).toBe(false);
    expect(isRejectedPrivateMessage({ role: 'assistant', metadata: { chatBlockRejected: true } } as any)).toBe(false);
  });
  it('用户拉黑 Char：用户消息正常，Char 回复发送失败；角色拉黑用户时方向相反', () => {
    const userBlocked = changeChatBlock(undefined, 'user', true, { at: 100 });
    expect(userBlockedCharacterAt(userBlocked, 120)).toBe(true);
    expect(privateChatDeliveryFailure({role:'user', metadata: {}} as any)).toBeNull();
    expect(privateChatDeliveryFailure({role:'assistant', metadata:{chatBlockSendFailed:true}} as any)).toBe('char-send-failed');
    expect(privateChatDeliveryFailure({role:'user', metadata:{chatBlockSendFailed:true}} as any)).toBeNull();
    expect(privateChatDeliveryFailure({role:'user', metadata:{chatBlockRejected:true}} as any)).toBe('user-rejected');
    expect(privateChatDeliveryFailure({role:'assistant', metadata:{chatBlockRejected:true}} as any)).toBeNull();
    const unblocked = changeChatBlock(userBlocked, 'user', false, { at: 200 });
    expect(userBlockedCharacterAt(unblocked, 120)).toBe(true);
    expect(userBlockedCharacterAt(unblocked, 220)).toBe(false);
    expect(privateChatDeliveryFailure({role:'assistant', metadata:{chatBlockSendFailed:true}} as any)).toBe('char-send-failed');
  });
  it('events bounded; relationship history persists through unlocks', () => {
    let state = undefined as ReturnType<typeof changeChatBlock> | undefined;
    for (let i = 1; i <= 100; i++) state = changeChatBlock(state, 'user', i % 2 === 1, { at: i });
    expect(state!.history).toHaveLength(40);
    expect(state!.history![0].at).toBe(61);
  });
});
