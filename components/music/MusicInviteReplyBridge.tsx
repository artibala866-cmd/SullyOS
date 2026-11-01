/**
 * Music invitations are explicit, immediate interactions. Their response uses
 * the existing private-chat AI and MUSIC_ACTION postprocessing, never AMSG2,
 * real-person sleep pacing, or the optional send-then-auto-reply preference.
 * This bridge lives under MusicProvider so it stays mounted in MusicApp.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { useChatAI } from '../../hooks/useChatAI';
import { loadMusicHooks } from '../../context/MusicContext';
import { DB } from '../../utils/db';
import { ChatPrompts } from '../../utils/chatPrompts';
import { isChatReplyActive } from '../../utils/chatReplyLock';
import { findPendingUserTurn } from '../../utils/chatContinuation';
import { isPrivateChatBlocked } from '../../utils/chatBlock';
import { resolveDialogueApi } from '../../utils/characterApi';
import {
    findPendingMusicInvite, MUSIC_INVITE_DB_CHANGED_KEY, musicInviteChangedCharId, explicitMusicInviteDecision,
} from '../../utils/musicInviteStatus';
import type { Emoji, EmojiCategory } from '../../types';

type Invite = { charId: string; messageId: number; enqueuedAt?: number };
const RECOVERY_WINDOW_MS = 2 * 60_000;
const ATTEMPT_KEY = 'sully_music_invite_immediate_attempt_v1:';
const inviteKey = (item: Invite) => item.charId + ':' + item.messageId;

export default function MusicInviteReplyBridge(): React.ReactElement | null {
    const {
        characters, userProfile, apiConfig, groups, realtimeConfig,
        memoryPalaceConfig, addToast, showError, updateCharacter, updateUserProfile,
    } = useOS();
    const [queue, setQueue] = useState<Invite[]>([]);
    const [library, setLibrary] = useState<{ emojis: Emoji[]; categories: EmojiCategory[] } | null>(null);
    const [retry, setRetry] = useState(0);
    const current = queue[0];
    const char = characters.find(c => c.id === current?.charId);
    const visibleLibrary = useMemo(() => char && library
        ? ChatPrompts.filterVisibleEmojis(library.emojis, library.categories, char.id)
        : { emojis: [] as Emoji[], categories: [] as EmojiCategory[] },
    [char?.id, library]);

    const { triggerAI } = useChatAI({
        char, userProfile, apiConfig, groups,
        emojis: visibleLibrary.emojis, categories: visibleLibrary.categories,
        addToast, showError, realtimeConfig, memoryPalaceConfig,
        updateCharacter, updateUserProfile,
        // Actual messages are stored by the original postprocessor and
        // surfaced by OSContext's global reply-arrived listener.
        setMessages: () => {},
    });

    const enqueue = useCallback((item: Invite) => {
        if (!item.charId || !Number.isSafeInteger(item.messageId) || item.messageId <= 0) return;
        setQueue(prev => prev.some(p => inviteKey(p) === inviteKey(item)) ? prev : [...prev, { ...item, enqueuedAt: Date.now() }]);
    }, []);
    const refresh = useCallback(async (charId: string) => {
        if (!charId) return;
        const history = await DB.getMessagesByCharId(charId, true);
        const pending = findPendingMusicInvite(history, 'user');
        const stamp = pending?.metadata?.invitedAt;
        if (pending?.id && typeof stamp === 'number' && Date.now() - stamp < RECOVERY_WINDOW_MS &&
            Date.now() >= stamp) enqueue({ charId, messageId: pending.id });
    }, [enqueue]);

    useEffect(() => {
        let live = true;
        void Promise.all([DB.getEmojis(), DB.getEmojiCategories()]).then(([emojis, categories]) => {
            if (live) setLibrary({ emojis, categories });
        }).catch(() => {
            // Emoji library errors cannot block a music invitation.
            if (live) setLibrary({ emojis: [], categories: [] });
        });
        return () => { live = false; };
    }, []);

    useEffect(() => {
        const created = (event: Event) => {
            const info = (event as CustomEvent<Invite>).detail;
            if (info?.charId && info.messageId) enqueue(info);
        };
        const storage = (event: StorageEvent) => {
            if (event.key !== MUSIC_INVITE_DB_CHANGED_KEY) return;
            const id = musicInviteChangedCharId(event.newValue);
            if (id) void refresh(id).catch(() => {});
        };
        window.addEventListener('music-listen-invite-created', created);
        window.addEventListener('storage', storage);
        // Recover a fresh invitation after an app reload, not an old unanswered
        // invite from days ago; no unrelated chat event can enter this queue.
        for (const c of characters) void refresh(c.id).catch(() => {});
        return () => {
            window.removeEventListener('music-listen-invite-created', created);
            window.removeEventListener('storage', storage);
        };
    }, [enqueue, refresh, characters.map(c => c.id).join('|')]);

    useEffect(() => {
        if (!current) return;
        let stopped = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const finish = () => {
            if (!stopped) setQueue(prev => prev.filter(p => inviteKey(p) !== inviteKey(current)));
        };
        const defer = () => {
            if (!stopped) retryTimer = setTimeout(() => setRetry(n => n + 1), 1200);
        };
        const run = async () => {
            if (Date.now() - (current.enqueuedAt ?? Date.now()) >= RECOVERY_WINDOW_MS) { finish(); return; }
            if (!char || char.id !== current.charId) { finish(); return; }
            if (!library) { defer(); return; }
            if (isPrivateChatBlocked(char.chatBlock)) { finish(); return; }
            const api = resolveDialogueApi(apiConfig, char);
            if (!api.baseUrl || !api.model) { finish(); return; }
            if (isChatReplyActive(current.charId)) { defer(); return; }
            let history = await DB.getMessagesByCharId(current.charId, true);
            if (stopped) return;
            const invitation = findPendingMusicInvite(history, 'user', current.messageId);
            if (!invitation) { finish(); return; }
            // A newer user text belongs to its own response path, never a
            // music-invite auto reply to unrelated conversation content.
            // A scheduled AMSG bubble arriving AFTER the invitation is not
            // a response to it. Respect the same canonical unanswered-turn
            // boundary as ordinary Chat, instead of letting AMSG swallow music.
            if (findPendingUserTurn(history)?.id !== current.messageId) { finish(); return; }

            const generate = async () => {
                if (stopped) return;
                if (isChatReplyActive(current.charId)) { defer(); return; }
                // Recheck the actual DB AFTER acquiring the cross-tab lock:
                // withdrawals and another tab's replies must win.
                history = await DB.getMessagesByCharId(current.charId, true);
                if (!findPendingMusicInvite(history, 'user', current.messageId) ||
                    findPendingUserTurn(history)?.id !== current.messageId) { finish(); return; }
                const key = ATTEMPT_KEY + inviteKey(current);
                try {
                    if (localStorage.getItem(key)) { finish(); return; }
                    localStorage.setItem(key, String(Date.now()));
                } catch { /* One mounted bridge still serializes this tab. */ }
                let busy = false;
                try {
                    // A scheduled proactive bubble may have arrived after the
                    // invitation. Do not send that assistant tail into the
                    // normal continuation adapter: it would inject a fake
                    // "please keep talking" user turn instead of answering
                    // this actual music invitation.
                    const invitationIndex = history.findIndex(m => m.id === current.messageId);
                    if (invitationIndex < 0) { finish(); return; }
                    const lastBeforeReply = history.reduce((max, m) => Math.max(max, m.id || 0), 0);
                    const outcome = await triggerAI(history.slice(0, invitationIndex + 1).slice(-200),
                        undefined, { immediateMusicInvite: true });
                    busy = outcome === 'busy';
                    if (busy) {
                        // Another private reply won the lease after our first
                        // check. That is NOT an attempted music response.
                        try { localStorage.removeItem(key); } catch {}
                    } else {
                        // Some models say "点同意了" without returning MUSIC_ACTION.
                        // Only this actual invitation's NEW explicit assistant answer
                        // may fall back to the same atomic MusicProvider action.
                        // Never infer from earlier chat / proactive messages / vague "好".
                        const after = await DB.getMessagesByCharId(current.charId, true);
                        if (findPendingMusicInvite(after, 'user', current.messageId)) {
                            const newAnswers = after.filter(m =>
                                m.id > lastBeforeReply && m.role === 'assistant' && m.type === 'text' &&
                                m.metadata?.source !== 'active_msg_2' && !m.metadata?.activeMsg2);
                            const decision = newAnswers.map(m => explicitMusicInviteDecision(m.content))
                                .find(value => value !== null);
                            const hooks = decision ? loadMusicHooks() : null;
                            if (decision === 'accept' && hooks) {
                                await hooks.joinListeningTogether(current.charId);
                            } else if (decision === 'reject' && hooks?.rejectListeningInvite) {
                                await hooks.rejectListeningInvite(current.charId);
                            }
                        }
                    }
                } finally {
                    if (busy) defer();
                    else finish();
                }
            };
            const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
            if (locks?.request) await locks.request('sully-music-invite:' + inviteKey(current),
                { mode: 'exclusive' }, generate);
            else await generate();
        };
        void run().catch(error => {
            console.warn('[MusicTogether] 即时邀请回复失败', error);
            finish();
        });
        return () => { stopped = true; if (retryTimer) clearTimeout(retryTimer); };
    }, [current?.charId, current?.messageId, char?.id, library, retry]);

    return null;
}
