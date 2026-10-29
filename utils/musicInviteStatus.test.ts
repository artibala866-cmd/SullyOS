import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findPendingMusicInvite, hasPendingMusicInvite } from './musicInviteStatus';

describe('一起听邀请状态', () => {
  const fromUser = { id: 1, metadata: { musicListenInvite: true } };
  const fromChar = { id: 2, metadata: { musicListenInvite: true, inviter: 'char' } };

  it('分别识别用户与角色尚未回应的邀请', () => {
    const history = [fromUser, fromChar];
    expect(findPendingMusicInvite(history, 'user')?.id).toBe(1);
    expect(findPendingMusicInvite(history, 'char')?.id).toBe(2);
  });

  it('带歌邀请仍使用同一条关联消息', () => {
    const song = { id: 123, source: 'tencent', platformId: '123', name: 'QQ 歌曲' };
    const invite = { id: 7, metadata: { musicListenInvite: true, musicListenTrack: song, invitedAt: 100 } };
    expect(findPendingMusicInvite([invite], 'user')?.metadata.musicListenTrack).toEqual(song);
    expect(findPendingMusicInvite([
      invite, { id: 8, metadata: { musicListenInviteResponseTo: 7, accepted: true } },
    ], 'user')).toBeUndefined();
  });

  it('接受与拒绝都不应留下待回应邀请', () => {
    expect(findPendingMusicInvite([
      fromUser,
      { id: 3, metadata: { musicListenInviteResponseTo: 1, accepted: true } },
    ], 'user')).toBeUndefined();
    expect(findPendingMusicInvite([
      fromChar,
      { id: 4, metadata: { musicListenInviteResponseTo: 2, accepted: false } },
    ], 'char')).toBeUndefined();
  });

  it('两个邀请方向共享同一串行锁，避免读库/写库之间并发叠卡', () => {
    const context = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url), 'utf8');
    expect(context).toContain('const creatingCharInvites = invitingCharIds;');
    expect(context).toContain("if (hasPendingMusicInvite(messages)) return;");
    expect(context).toContain("if (findPendingMusicInvite(history, 'char'))");
  });

  it('任一方的待回应邀请都会阻止再创建反向邀请', () => {
    const charPending = { id: 20, metadata: { musicListenInvite: true, inviter: 'char' } };
    const userPending = { id: 21, metadata: { musicListenInvite: true } };
    expect(hasPendingMusicInvite([charPending])).toBe(true);
    expect(hasPendingMusicInvite([userPending])).toBe(true);
    // 解决角色邀请后才能新建 User 邀请，反之亦然。
    expect(hasPendingMusicInvite([
      charPending, { id: 22, metadata: { musicListenInviteResponseTo: 20, accepted: false } },
    ])).toBe(false);
    expect(hasPendingMusicInvite([
      userPending, { id: 23, metadata: { musicListenInviteResponseTo: 21, cancelled: true } },
    ])).toBe(false);
  });

  it('不同角色的邀请历史不得混在同一聊天会话的判定中', () => {
    const a = { id: 31, metadata: { musicListenInvite: true, inviter: 'char' } };
    const b = { id: 32, metadata: { musicListenInvite: true } };
    expect(hasPendingMusicInvite([a])).toBe(true);
    expect(findPendingMusicInvite([b], 'char')).toBeUndefined();
  });

  it('旧消息直接写入接受、拒绝、结束或撤回状态时也不能重新当作待答复', () => {
    for (const status of ['accepted', 'rejected', 'ended', 'cancelled', 'withdrawn']) {
      const user = { id: 40, metadata: { musicListenInvite: true, status } };
      const char = { id: 41, metadata: { musicListenInvite: true, inviter: 'char', status } };
      expect(hasPendingMusicInvite([user, char])).toBe(false);
      expect(findPendingMusicInvite([user], 'user')).toBeUndefined();
      expect(findPendingMusicInvite([char], 'char')).toBeUndefined();
    }
    expect(hasPendingMusicInvite([{ id: 50, metadata: { musicListenInvite: true, status: 'pending' } }])).toBe(true);
    expect(hasPendingMusicInvite([{ id: 51, metadata: { musicListenInvite: true } }])).toBe(true);
  });

  it('撤回后可重新邀请，指定消息不能误撤其他邀请', () => {
    const history = [
      fromUser,
      { id: 3, metadata: { musicListenInviteResponseTo: 1, cancelled: true } },
      { id: 4, metadata: { musicListenInvite: true } },
    ];
    expect(findPendingMusicInvite(history, 'user')?.id).toBe(4);
    expect(findPendingMusicInvite(history, 'user', 1)).toBeUndefined();
    expect(findPendingMusicInvite(history, 'user', 4)?.id).toBe(4);
  });
});
