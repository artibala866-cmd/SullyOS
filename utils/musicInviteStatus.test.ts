import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DB } from './db';
import { findPendingMusicInvite, hasPendingMusicInvite, persistMusicInviteWithdrawal, canJoinMusicWithoutPendingInvite, MUSIC_INVITE_DB_CHANGED_KEY, musicInviteChangedCharId } from './musicInviteStatus';

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
    expect(context).toContain('DB.createMusicListeningInvite({');
    expect(context).toContain('DB.resolveMusicListeningInvite(');
    const dbSource = readFileSync(new URL('./db.ts', import.meta.url), 'utf8');
    expect(dbSource).toContain("db.transaction([STORE_MESSAGES, STORE_ASSETS], 'readwrite')");
    expect(dbSource).toContain("store.index('charId').getAll(IDBKeyRange.only(invite.charId))");
    expect(dbSource).toContain("store.index('charId').getAll(IDBKeyRange.only(charId))");
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

describe('撤回邀请的真实持久化流程', () => {
  it('撤回已生效的邀请不再触发私聊自动回复倒计时', () => {
    const chat = readFileSync(new URL('../apps/Chat.tsx', import.meta.url), 'utf8');
    expect(chat).toContain("findPendingMusicInvite(recent, 'user', detail.messageId)");
    expect(findPendingMusicInvite([
      { id: 10, metadata: { musicListenInvite: true } },
      { id: 11, metadata: { musicListenInviteResponseTo: 10, cancelled: true } },
    ], 'user', 10)).toBeUndefined();
  });

  it('只撤回指定的用户待回应邀请，保存后不再视为待答复', async () => {
    const history: Array<{ id: number; metadata: Record<string, unknown> }> = [
      { id: 10, metadata: { musicListenInvite: true, status: 'pending' } },
    ];
    const write = async (item: { metadata: { musicListenInviteResponseTo: number; cancelled: true } }) => {
      history.push({ id: 11, metadata: item.metadata as any });
      return 11;
    };
    const read = async () => history;
    expect(await persistMusicInviteWithdrawal('a', 10, read, write)).toBe(10);
    expect(findPendingMusicInvite(history, 'user')).toBeUndefined();
    expect(await persistMusicInviteWithdrawal('a', 10, read, write)).toBeNull();
  });
  it('缓存的 pending 已过期时不重复写撤回，也不会误撤新邀请', async () => {
    const history = [
      { id: 1, metadata: { musicListenInvite: true } },
      { id: 2, metadata: { musicListenInviteResponseTo: 1, accepted: true } },
      { id: 3, metadata: { musicListenInvite: true } },
    ];
    const write = vi.fn(async () => 9);
    expect(await persistMusicInviteWithdrawal('a', 1, async () => history, write)).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(await persistMusicInviteWithdrawal('a', undefined, async () => history, write)).toBe(3);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { musicListenInviteResponseTo: 3, accepted: false, cancelled: true },
    }));
  });
  it('保存撤回失败必须抛错，供上层保留按钮并重试', async () => {
    const history = [{ id: 7, metadata: { musicListenInvite: true } }];
    const write = vi.fn(async () => { throw new Error('存储失败'); });
    await expect(persistMusicInviteWithdrawal('a', undefined, async () => history, write)).rejects.toThrow('存储失败');
    expect(findPendingMusicInvite(history, 'user')?.id).toBe(7);
  });
});

describe('IndexedDB 实际邀请与撤回交易', () => {
  it('保存邀请→确认撤回落库→再次邀请不会误判旧消息 pending', async () => {
    const charId = 'music-withdrawal-idb-test';
    const original = await DB.saveMessage({
      charId, role: 'user', type: 'system', content: '测试发起邀请',
      metadata: { musicListenInvite: true, status: 'pending', invitedAt: Date.now() },
    });
    expect(findPendingMusicInvite(await DB.getMessagesByCharId(charId, true), 'user')?.id).toBe(original);
    const withdrawn = await persistMusicInviteWithdrawal(
      charId, original, id => DB.getMessagesByCharId(id, true),
      response => DB.saveMessage(response),
    );
    expect(withdrawn).toBe(original);
    expect(findPendingMusicInvite(await DB.getMessagesByCharId(charId, true), 'user')).toBeUndefined();
    const retry = await DB.saveMessage({
      charId, role: 'user', type: 'system', content: '再次邀请',
      metadata: { musicListenInvite: true, status: 'pending', invitedAt: Date.now() },
    });
    expect(findPendingMusicInvite(await DB.getMessagesByCharId(charId, true), 'user')?.id).toBe(retry);
  });
});

describe('聊天卡片撤回反馈与跨页面事件检查', () => {
  it('撤回必须反馈保存成功、失败和过期结果，不能留着不可点击的卡片', () => {
    const provider = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url), 'utf8');
    const card = readFileSync(new URL('../components/chat/MessageItem.tsx', import.meta.url), 'utf8');
    expect(provider).toContain("'music-listen-invite-withdrawal-result'");
    expect(provider).toContain("report(false, 'not_found')");
    expect(provider).toContain("report(false, 'storage')");
    expect(provider).toContain('report(true)');
    expect(card).toContain("'music-listen-invite-withdrawal-result'");
    expect(card).toContain("inviteCancelling ? '撤回中…' : '撤回邀请'");
    expect(card).toContain('onClick={cancelMusicInvite}');
    expect(card).toContain("role=\"status\"");
    expect(card).toContain("clearTimeout(inviteCancelTimerRef.current)");
  });
});

describe('多标签页并发：IndexedDB 原子邀请交易', () => {
  const outgoing = (charId: string) => ({
    charId, role: 'user' as const, type: 'system' as const,
    content: '邀请一起听',
    metadata: { musicListenInvite: true, status: 'pending', invitedAt: Date.now() },
  });
  const incoming = (charId: string) => ({
    charId, role: 'assistant' as const, type: 'system' as const,
    content: '角色邀请',
    metadata: { musicListenInvite: true, inviter: 'char', status: 'pending', invitedAt: Date.now() },
  });
  const answer = (charId: string, accepted: boolean, cancelled = false) => ({
    charId, role: 'user' as const, type: 'system' as const,
    content: accepted ? '接受' : cancelled ? '撤回' : '拒绝',
    metadata: { accepted, ...(cancelled ? { cancelled: true } : {}) },
  });

  it('并发两次创建只能产生一条邀请，两端分享同一消息 ID', async () => {
    const id = 'atomic-same-direction-1';
    const [a, b] = await Promise.all([
      DB.createMusicListeningInvite(outgoing(id)),
      DB.createMusicListeningInvite(outgoing(id)),
    ]);
    expect([a.status, b.status].sort()).toEqual(['created', 'pending_self']);
    expect(a.messageId).toBe(b.messageId);
    const history = await DB.getMessagesByCharId(id, true);
    expect(history.filter(m => m.metadata?.musicListenInvite).length).toBe(1);
  });

  it('两个方向同时发邀请，只有一方创建成功', async () => {
    const id = 'atomic-opposite-directions-1';
    const [a, b] = await Promise.all([
      DB.createMusicListeningInvite(outgoing(id)),
      DB.createMusicListeningInvite(incoming(id)),
    ]);
    expect([a.status, b.status].sort()).toEqual(['created', 'pending_other']);
    expect(a.messageId).toBe(b.messageId);
    expect((await DB.getMessagesByCharId(id, true))
      .filter(m => m.metadata?.musicListenInvite).length).toBe(1);
  });

  it('两标签页同时撤回与接受，同一条邀请只能有一条最终回应', async () => {
    const id = 'atomic-withdraw-vs-accept-1';
    const created = await DB.createMusicListeningInvite(outgoing(id));
    const [withdraw, accepted] = await Promise.all([
      DB.resolveMusicListeningInvite(id, 'user', answer(id, false, true), created.messageId),
      DB.resolveMusicListeningInvite(id, 'user', {
        ...answer(id, true), role: 'assistant' as const,
      }, created.messageId),
    ]);
    expect([withdraw.resolved, accepted.resolved].sort()).toEqual([false, true]);
    const history = await DB.getMessagesByCharId(id, true);
    expect(history.filter(m => m.metadata?.musicListenInviteResponseTo === created.messageId)).toHaveLength(1);
    expect(findPendingMusicInvite(history, 'user')).toBeUndefined();
    const again = await DB.resolveMusicListeningInvite(id, 'user', answer(id, false, true), created.messageId);
    expect(again.resolved).toBe(false);
  });

  it('旧消息 ID 不能撤回新邀请，撤回成功后可再次创建', async () => {
    const id = 'atomic-stale-message-1';
    const first = await DB.createMusicListeningInvite(outgoing(id));
    expect((await DB.resolveMusicListeningInvite(id, 'user', answer(id, false, true), first.messageId)).resolved).toBe(true);
    const second = await DB.createMusicListeningInvite(outgoing(id));
    expect(second.status).toBe('created');
    expect(second.messageId).not.toBe(first.messageId);
    expect((await DB.resolveMusicListeningInvite(id, 'user', answer(id, false, true), first.messageId)).resolved).toBe(false);
    expect(findPendingMusicInvite(await DB.getMessagesByCharId(id, true), 'user')?.id).toBe(second.messageId);
  });

  it('角色邀请已被其他标签页拒绝后，过期的接受动作不能再加入或写重复回应', async () => {
    const id = 'atomic-reply-char-1';
    const created = await DB.createMusicListeningInvite(incoming(id));
    const reject = await DB.resolveMusicListeningInvite(id, 'char', answer(id, false), created.messageId);
    expect(reject.resolved).toBe(true);
    const staleAccept = await DB.resolveMusicListeningInvite(id, 'char', answer(id, true), created.messageId);
    expect(staleAccept.resolved).toBe(false);
    const history = await DB.getMessagesByCharId(id, true);
    expect(history.filter(m => m.metadata?.musicListenInviteResponseTo === created.messageId)).toHaveLength(1);
  });

  it('跨标签页的变更信号只携带角色 ID，不相信缓存的 pending 标记', () => {
    expect(musicInviteChangedCharId(JSON.stringify({charId:'char-123',at:1}))).toBe('char-123');
    expect(musicInviteChangedCharId('{broken')).toBeNull();
    expect(musicInviteChangedCharId(JSON.stringify({charId:42}))).toBeNull();
    const context = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../apps/MusicApp.tsx', import.meta.url), 'utf8');
    expect(context).toContain('MUSIC_INVITE_DB_CHANGED_KEY');
    expect(context).toContain('inviteReadRevision.current.get(charId) !== revision');
    expect(context).toContain("document.addEventListener('visibilitychange', onVisible)");
    expect(context).toContain('remotePartners');
    expect(app).toContain('MUSIC_INVITE_DB_CHANGED_KEY');
    expect(MUSIC_INVITE_DB_CHANGED_KEY).toBe('sully_music_invite_db_changed_v1');
  });
});

describe('撤回邀请不再留住自动回复倒计时', () => {
  it('只有关联的邀请撤回才取消计时；其他正常用户消息不受影响', () => {
    const chat = readFileSync(new URL('../apps/Chat.tsx', import.meta.url), 'utf8');
    expect(chat).toContain('pendingMusicInviteReplyRef.current');
    expect(chat).toContain('onMusicInviteResolved');
    expect(chat).toContain('pending.messageId !== detail.messageId');
    expect(chat).toContain('latest?.metadata?.musicListenInviteResponseTo === pending.messageId');
    expect(chat).toContain('autoReply.cancel()');
    expect(chat).toContain("if (latestPersisted.metadata?.musicListenInviteResponseTo) return;");
    expect(chat).toContain("!findPendingMusicInvite(fresh, 'user', latestPersisted.id)");
  });

  it('待回应记录已经被撤回时不能作为自动回复候选', () => {
    const last = [
      { id: 100, metadata: { musicListenInvite: true, status: 'pending' } },
      { id: 101, metadata: { musicListenInviteResponseTo: 100, cancelled: true } },
    ];
    expect(findPendingMusicInvite(last, 'user', 100)).toBeUndefined();
  });
});

describe('恢复页面与跨标签页撤回的交互防护', () => {
  it('没有本地缓存也能从 DB 还原待撤回邀请，已撤回不再恢复', async () => {
    const id = 'restore-pending-no-local-cache-test';
    const created = await DB.createMusicListeningInvite({
      charId: id, role: 'user', type: 'system', content: '无缓存的邀请',
      metadata: { musicListenInvite: true, status: 'pending' },
    });
    // This simulates a fresh tab whose sully_music_together_v1 lacks invites.
    expect(findPendingMusicInvite(await DB.getMessagesByCharId(id, true), 'user')?.id).toBe(created.messageId);
    const done = await DB.resolveMusicListeningInvite(id, 'user', {
      charId: id, role: 'user', type: 'system', content: '撤回',
      metadata: { accepted: false, cancelled: true },
    }, created.messageId);
    expect(done.resolved).toBe(true);
    expect(findPendingMusicInvite(await DB.getMessagesByCharId(id, true), 'user')).toBeUndefined();
    const app = readFileSync(new URL('../apps/MusicApp.tsx', import.meta.url), 'utf8');
    const context = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url), 'utf8');
    expect(app).toContain('refreshListeningInvite(c.id)');
    expect(context).toContain('refreshListeningInvite: refreshOutgoingInvite');
    expect(context).toContain('inviteReadRevision.current.get(charId) !== revision');
  });

  it('跨标签页删除邀请后，聊天自动回复计时会按 DB 判断撤回', () => {
    const chat = readFileSync(new URL('../apps/Chat.tsx', import.meta.url), 'utf8');
    expect(chat).toContain('checkRemoteMusicResolution');
    expect(chat).toContain("window.addEventListener('storage', onRemoteMusicChange)");
    expect(chat).toContain("window.removeEventListener('storage', onRemoteMusicChange)");
    expect(chat).toContain("document.addEventListener('visibilitychange', onMusicTabVisible)");
    expect(chat).toContain("findPendingMusicInvite(history, 'user', pending.messageId)");
    expect(chat).toContain('onMusicInviteResolved(new CustomEvent(');
    expect(chat).toContain('autoReply.cancel()');
  });
});

describe('双标签页会话与邀请缓存不互相覆盖', () => {
  it('邀请状态独立持久化，不再触发重新写入旧的伴听成员名单', () => {
    const context = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url), 'utf8');
    expect(context).toContain("localStorage.setItem('sully_music_listening_invites_view_v1'");
    expect(context).toContain("localStorage.setItem('sully_music_together_v1'");
    expect(context).toContain('}, [listeningTogetherWith, listeningStartedAt]);');
    expect(context).not.toContain('}, [listeningTogetherWith, listeningStartedAt, listeningInvites]);');
    expect(context).toContain('}, [listeningInvites]);');
    // New users use the separate cache; older installations still migrate
    // their previous combined field without discarding it.
    expect(context).toContain("localStorage.getItem('sully_music_together_v1') || '{}').invites");
  });
});

describe('已撤回邀请与 Char 自愿加入的异步竞态', () => {
  const invite = { id: 1, role: 'user', type: 'system', metadata: { musicListenInvite: true } };
  const cancel = { id: 2, role: 'user', type: 'system', metadata: { musicListenInviteResponseTo: 1, cancelled: true } };
  it('撤回与旧的接受结果先后交错时不能擅自加入', () => {
    expect(canJoinMusicWithoutPendingInvite([invite, cancel])).toBe(false);
    expect(canJoinMusicWithoutPendingInvite([invite])).toBe(false);
  });
  it('没有邀请时仍允许原 MUSIC_ACTION 自愿加入', () => {
    expect(canJoinMusicWithoutPendingInvite([])).toBe(true);
    expect(canJoinMusicWithoutPendingInvite([{ id: 9, role: 'user', type: 'text' }])).toBe(true);
  });
  it('取消后用户又正常发消息，可以开始新的自愿伴听，不受旧邀请永久阻断', () => {
    const newTurn = { id: 3, role: 'user', type: 'text' };
    expect(canJoinMusicWithoutPendingInvite([invite, cancel, newTurn])).toBe(true);
    // Additional system events are not a new human instruction.
    expect(canJoinMusicWithoutPendingInvite([invite, cancel, { id: 4, role: 'user', type: 'system' }])).toBe(false);
    const context = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url), 'utf8');
    expect(context).toContain('if (!canJoinMusicWithoutPendingInvite(history)) return false');
  });
});

describe('角色主动邀请：数据库原子回应与切换角色', () => {
  const incoming = (charId: string) => ({
    charId, role: 'assistant' as const, type: 'system' as const,
    content: '一起听吗？',
    metadata: { musicListenInvite: true, inviter: 'char', status: 'pending', invitedAt: Date.now() },
  });
  const reply = (charId: string, accepted: boolean) => ({
    charId, role: 'user' as const, type: 'system' as const,
    content: accepted ? '接受' : '拒绝', metadata: { accepted },
  });
  it('同一 Char 邀请接受和拒绝并发时只能提交一条结果', async () => {
    const id = 'music-char-race-accept-reject';
    const created = await DB.createMusicListeningInvite(incoming(id));
    expect(created.status).toBe('created');
    const [accepted, rejected] = await Promise.all([
      DB.resolveMusicListeningInvite(id, 'char', reply(id, true), created.messageId),
      DB.resolveMusicListeningInvite(id, 'char', reply(id, false), created.messageId),
    ]);
    expect([accepted.resolved, rejected.resolved].sort()).toEqual([false, true]);
    const history = await DB.getMessagesByCharId(id, true);
    expect(history.filter(m => m.metadata?.musicListenInviteResponseTo === created.messageId)).toHaveLength(1);
    expect(findPendingMusicInvite(history, 'char')).toBeUndefined();
  });
  it('角色切换时旧消息 ID 不可结算新角色或新一轮邀请', async () => {
    const firstId = 'music-char-switch-first';
    const secondId = 'music-char-switch-second';
    const first = await DB.createMusicListeningInvite(incoming(firstId));
    const second = await DB.createMusicListeningInvite(incoming(secondId));
    expect((await DB.resolveMusicListeningInvite(secondId, 'char', reply(secondId, true), first.messageId)).resolved).toBe(false);
    expect(findPendingMusicInvite(await DB.getMessagesByCharId(secondId, true), 'char')?.id).toBe(second.messageId);
    expect((await DB.resolveMusicListeningInvite(firstId, 'char', reply(firstId, false), first.messageId)).resolved).toBe(true);
    const fresh = await DB.createMusicListeningInvite(incoming(firstId));
    expect(fresh.status).toBe('created');
    expect((await DB.resolveMusicListeningInvite(firstId, 'char', reply(firstId, true), first.messageId)).resolved).toBe(false);
    expect(findPendingMusicInvite(await DB.getMessagesByCharId(firstId, true), 'char')?.id).toBe(fresh.messageId);
  });
  it('失败时不能乐观加入；聊天卡片接收保存结果并恢复重试', () => {
    const provider = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url), 'utf8');
    const card = readFileSync(new URL('../components/chat/MessageItem.tsx', import.meta.url), 'utf8');
    expect(provider).toContain('answerIncomingListeningInvite');
    expect(provider).toContain("return notify('failed')");
    expect(provider).toContain("return notify('stale')");
    expect(provider).toContain("return notify('resolved')");
    expect(card).toContain("'music-listen-invite-answer-result'");
    expect(card).toContain('inviteAnswerLockRef.current');
    expect(card).toContain("setInviteAnswerError('回应未保存，请重试')");
  });
});
