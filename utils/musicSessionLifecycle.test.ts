import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DB } from './db';

const prefix = 'session-lifecycle-';
const incoming = (charId: string) => ({
  charId, role: 'assistant' as const, type: 'system' as const, content: '一起听吗',
  metadata: { musicListenInvite: true, inviter: 'char', status: 'pending', invitedAt: Date.now() },
});

describe('一起听完整生命周期与重启恢复', () => {
  it('角色邀请→接受→数据库会话开始→暂停/切歌不结束→结束→再次邀请', async () => {
    const charId = prefix + 'from-char';
    const invited = await DB.createMusicListeningInvite(incoming(charId));
    expect(invited.status).toBe('created');
    expect(await DB.getMusicListeningSession(charId)).toBeNull();

    const accepted = await DB.resolveMusicListeningInvite(charId, 'char', {
      charId, role: 'user', type: 'system', content: '接受',
      metadata: { accepted: true },
    }, invited.messageId);
    expect(accepted.resolved).toBe(true);
    const live = await DB.getMusicListeningSession(charId);
    expect(live).toMatchObject({active:true});
    expect(live?.sessionId).toBeTruthy();
    expect((await DB.listActiveMusicListeningSessions()).some(s => s.charId === charId)).toBe(true);

    // Pausing and switching tracks only alter the player; neither writes a
    // listening-session transition. Reading a fresh provider's DB view gives
    // the same session token rather than inventing a new session.
    const restored = await DB.getMusicListeningSession(charId);
    expect(restored).toEqual(live);
    const stillLive = await DB.transitionMusicListeningSession(charId, 'join');
    expect(stillLive).toMatchObject({active:true, changed:false, sessionId:live!.sessionId});

    const ended = await DB.transitionMusicListeningSession(charId, 'end', live!.sessionId);
    expect(ended).toMatchObject({active:false,changed:true});
    expect((await DB.listActiveMusicListeningSessions()).some(s => s.charId === charId)).toBe(false);
    expect((await DB.getMusicListeningSession(charId))?.active).toBe(false);

    const renewed = await DB.createMusicListeningInvite(incoming(charId));
    expect(renewed.status).toBe('created');
    expect(renewed.messageId).not.toBe(invited.messageId);
    const again = await DB.resolveMusicListeningInvite(charId, 'char', {
      charId, role:'user', type:'system', content:'重新接受', metadata:{accepted:true},
    }, renewed.messageId);
    expect(again.resolved).toBe(true);
    const newSession = await DB.getMusicListeningSession(charId);
    expect(newSession?.active).toBe(true);
    expect(newSession?.sessionId).not.toBe(live!.sessionId);
  });

  it('模拟两个标签页同时加入只生成一个会话；旧标签页不能结束新会话', async () => {
    const charId = prefix + 'cross-tab';
    const [a,b] = await Promise.all([
      DB.transitionMusicListeningSession(charId,'join'),
      DB.transitionMusicListeningSession(charId,'join'),
    ]);
    expect(a?.sessionId).toBe(b?.sessionId);
    expect([a?.changed,b?.changed].sort()).toEqual([false,true]);
    const ended = await DB.transitionMusicListeningSession(charId,'end',a!.sessionId);
    expect(ended?.active).toBe(false);
    const newSession = await DB.transitionMusicListeningSession(charId,'join');
    expect(newSession?.active).toBe(true);
    expect(newSession?.sessionId).not.toBe(a?.sessionId);
    const staleTab = await DB.transitionMusicListeningSession(charId,'end',a!.sessionId);
    expect(staleTab).toMatchObject({active:true,changed:false,sessionId:newSession!.sessionId});
    expect((await DB.getMusicListeningSession(charId))?.active).toBe(true);
  });

  it('第二个标签页持有过期界面时也无法重复邀请已在一起听的角色', async () => {
    const charId = prefix + 'active-reinvite-guard';
    const live = await DB.transitionMusicListeningSession(charId, 'join');
    expect(live?.active).toBe(true);
    const blocked = await DB.createMusicListeningInvite(incoming(charId));
    expect(blocked.status).toBe('already_listening');
    expect((await DB.getMessagesByCharId(charId, true)).filter(m => m.metadata?.musicListenInvite)).toHaveLength(0);
    await DB.transitionMusicListeningSession(charId, 'end', live!.sessionId);
    const invited = await DB.createMusicListeningInvite(incoming(charId));
    expect(invited.status).toBe('created');
  });

  it('用户拒绝邀请不写会话；重启不从旧 localStorage 缓存恢复假在线', async () => {
    const charId = prefix + 'rejected';
    const invited = await DB.createMusicListeningInvite(incoming(charId));
    await DB.resolveMusicListeningInvite(charId,'char',{
      charId, role:'user', type:'system',content:'拒绝',metadata:{accepted:false},
    },invited.messageId);
    expect(await DB.getMusicListeningSession(charId)).toBeNull();
    const provider = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url),'utf8');
    expect(provider).toContain("useState<string[]>([])");
    expect(provider).toContain('DB.listActiveMusicListeningSessions()');
    expect(provider).toContain('MUSIC_LISTEN_SESSION_CHANGED_KEY');
    expect(provider).not.toContain('return Array.isArray(saved.partners)');
    expect(provider).toContain('const previousSong = previousSongRef.current');
    expect(provider).toContain('换歌不代表一起听结束');
  });

  it('接受记录已提交但另一标签刚结束时仍广播回应，不重放已经结束的歌曲', () => {
    const provider = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url),'utf8');
    expect(provider).toContain("sessionAlreadyEnded: accepted && !joined");
    expect(provider).toContain("return notify(accepted && !joined ? 'stale' : 'resolved')");
    expect(provider).toContain("if (accepted && joined && settled.track) resumeInviteTrack(settled.track)");
    expect(provider).toContain("announceMusicInviteDbChanged(charId)");
  });

  it('旧标签页的慢速恢复不能覆盖本标签页已经提交的结束', async () => {
    const provider = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url),'utf8');
    expect(provider).toContain('perCharRevisionAtStart');
    expect(provider).toContain('sessionReadRevisions.current.get(id)');
    expect(provider).toContain('const expectedId = sessionIdsRef.current.get(charId)');
    expect(provider).toContain("DB.transitionMusicListeningSession(charId, 'end', expectedId)");
    expect(provider).toContain('announceMusicListenSessionChanged(charId)');
  });
});
