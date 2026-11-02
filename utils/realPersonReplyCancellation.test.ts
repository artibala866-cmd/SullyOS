// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReplyRun, isReplyStopped } from './chatReplyCancellation';
import { setRealPersonModeEnabled } from './realPersonMode';
import { DB } from './db';
import { ActiveMsgClient } from './activeMsgClient';
import { getInstantChatPending, setInstantChatPending, stopUnauthorizedAutoInstantReplies } from './amsgInstantChat';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('real-person grant revocation', () => {
    it('off aborts every automatic character run but preserves a manual run', async () => {
        setRealPersonModeEnabled(true);
        const a = createReplyRun('auto-a', undefined, true);
        const b = createReplyRun('auto-b', undefined, true);
        const manual = createReplyRun('auto-a');
        const waiting = a.wait(new Promise(() => {}));
        setRealPersonModeEnabled(false);
        expect(a.signal.aborted).toBe(true);
        expect(b.signal.aborted).toBe(true);
        expect(manual.signal.aborted).toBe(false);
        await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
        setRealPersonModeEnabled(true);
        await expect(a.saveMessage({ charId: 'auto-a', role: 'assistant', type: 'text', content: 'late' }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(await DB.getRecentMessagesByCharId('auto-a', 10)).toEqual([]);
        await Promise.all([a.settle(), b.settle(), manual.settle()]);
    });

    it('post-reply work inherits its original grant after close and reopen', async () => {
        setRealPersonModeEnabled(true);
        const run = createReplyRun('background', undefined, true);
        await run.settle();
        setRealPersonModeEnabled(false);
        setRealPersonModeEnabled(true);
        const lateBackground = run.forkForBackground();
        expect(lateBackground.signal.aborted).toBe(true);
        const fresh = createReplyRun('background', undefined, true);
        expect(fresh.signal.aborted).toBe(false);
        await Promise.all([lateBackground.settle(), fresh.settle()]);
    });

    it('off cancels accepted cloud auto replies and tombstones late delivery, preserving manual ones', async () => {
        vi.spyOn(ActiveMsgClient, 'cancelTask').mockResolvedValue(undefined as any);
        vi.spyOn(ActiveMsgClient, 'writeClientStateValue').mockResolvedValue(undefined as any);
        setRealPersonModeEnabled(true);
        setInstantChatPending('cloud-auto', 'auto-close-uuid', Date.now(), '自动', 42);
        setInstantChatPending('cloud-manual', 'manual-keep-uuid', Date.now(), '手动');
        setRealPersonModeEnabled(false);
        expect(isReplyStopped('auto-close-uuid')).toBe(true);
        expect(getInstantChatPending('cloud-auto')).toBeNull();
        expect(getInstantChatPending('cloud-manual')?.uuid).toBe('manual-keep-uuid');
        expect(ActiveMsgClient.cancelTask).toHaveBeenCalledWith('auto-close-uuid');
        expect(ActiveMsgClient.cancelTask).not.toHaveBeenCalledWith('manual-keep-uuid');
        // Let the existing stop receipt reconciliation finish under these mocks.
        await new Promise(resolve => setTimeout(resolve, 30));
    });

    it('an old cloud grant cannot revive if another tab observes only the final on state', async () => {
        vi.spyOn(ActiveMsgClient, 'cancelTask').mockResolvedValue(undefined as any);
        vi.spyOn(ActiveMsgClient, 'writeClientStateValue').mockResolvedValue(undefined as any);
        setRealPersonModeEnabled(true);
        setInstantChatPending('cross-tab', 'old-grant-uuid', Date.now(), '角色', 43);
        const stale = localStorage.getItem('amsg2_instant_chat_pending')!;
        setRealPersonModeEnabled(false);
        setRealPersonModeEnabled(true);
        localStorage.setItem('amsg2_instant_chat_pending', stale);
        stopUnauthorizedAutoInstantReplies();
        expect(getInstantChatPending('cross-tab')).toBeNull();
        expect(isReplyStopped('old-grant-uuid')).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 30));
    });
});

it('cloud replies wait in the inbox while composing without blocking another character', async () => {
    const { setChatComposerActivity } = await import('./chatComposerActivity');
    const { flushInboxToChat } = await import('./activeMsgRuntime');
    const { ActiveMsgStore } = await import('./activeMsgStore');
    vi.spyOn(ActiveMsgClient, 'cancelTask').mockResolvedValue(undefined as any);
    vi.spyOn(ActiveMsgClient, 'listOutboxEntries').mockResolvedValue([] as any);
    vi.spyOn(ActiveMsgClient, 'ackOutboxMessages').mockResolvedValue(undefined as any);
    vi.spyOn(ActiveMsgClient, 'clearClientStateValue').mockResolvedValue(undefined as any);
    await ActiveMsgStore.consumeInboxMessages();
    setRealPersonModeEnabled(true);
    for (const id of ['cloud-composer', 'cloud-other']) await DB.saveCharacter({id,name:'测试角色'} as any);
    setInstantChatPending('cloud-composer', 'composer-uuid', Date.now(), '角色', 500);
    setChatComposerActivity('cloud-composer', {hasDraft:true,composing:false,keyboardVisible:false,activityAt:Date.now()});
    for (const [charId,uuid] of [['cloud-composer','composer-uuid'],['cloud-other','other-uuid']]) {
        await ActiveMsgStore.saveInboxMessage({messageId:uuid+'-1',charId,charName:'测试角色',body:'这一条是已有的回复',
            source:'instant',taskUuid:uuid,receivedAt:Date.now(),sentAt:Date.now(),
            metadata:{amsgInstantChat:true,amsgOutboxBackfill:true,messageIndex:1,totalMessages:1}} as any);
    }
    await flushInboxToChat('SW通知');
    expect(await DB.getRecentMessagesByCharId('cloud-composer',10)).toEqual([]);
    expect((await DB.getRecentMessagesByCharId('cloud-other',10)).some(m => m.role === 'assistant')).toBe(true);
    expect((await ActiveMsgStore.listInboxMessages()).map(m => m.charId)).toContain('cloud-composer');
    setChatComposerActivity('cloud-composer',null);
    await flushInboxToChat('输入结束','cloud-composer');
    expect((await DB.getRecentMessagesByCharId('cloud-composer',10)).filter(m => m.role === 'assistant')).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 50));
});
