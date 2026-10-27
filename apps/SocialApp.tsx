import { evaluateSparkTraffic, sparkTrafficKey, reserveSparkTrafficRun, getSparkTrafficLocalDay, type SparkTraffic } from '../utils/sparkTraffic';
import { chooseSparkStock } from '../utils/sparkStock';
import { planSparkCharacterBatches, selectSparkBatchCharacterResults, parseSparkPostPublishBatch, needsSparkInitialCommentCall } from '../utils/sparkApiBatch';
import { useLocalBackHandler } from '../hooks/useLocalBackHandler';
import { appendSparkDMUser, setSparkDMDelivery, recoverSparkInterruptedDMs, sparkDMHistoryThrough, appendSparkDMAnswer, takeSparkDMJobBatch, appendSparkDMBatchAnswer, sparkDMBatchHistory, type SparkDMThreads, type SparkPrivateMessage } from '../utils/sparkDMQueue';
import { loadCharacterContextMessages } from '../utils/chatContextRange';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { AppID, CharacterProfile, SocialPost, SocialComment, SubAccount, SocialAppProfile, XhsStockImage } from '../types';
import { buildSparkCommentHistory, buildSparkGenerationContext, resolveSparkAuthor, selectSparkParticipants, containsSparkPrivateQuote, getSparkAuthorAvatar, buildSparkGenerationRequestMessages } from '../utils/socialGeneration';
import { processImageToBlob } from '../utils/file';
import { putImageBlob } from '../utils/blobRef';
import Modal from '../components/os/Modal';
import { extractContent, safeResponseJson } from '../utils/safeApi';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../components/character/CharacterGroupFilter';
import { House, User, Package, Warning } from '@phosphor-icons/react';
import { canDeleteSocialPost, mergeSocialComments, prependUniqueSocialPosts, toggleSocialCommentLike, uniqueGeneratedSocialComments, updateSocialPost, parseSparkPublishTags, takeSparkCommentReplyBatch } from '../utils/socialFeedMerge';
import { createEmptySparkCommunityState, normalizeSparkCommunityState, mergeSparkCommunityStates, ensureSparkAccount, toggleSparkFollow, rankSparkFeed, appendSparkEvent, resolveSparkCharacterHandleId, migrateSparkDMKeys, resolveSparkDMAccount, syncSparkLegacyNotices, getSparkDMThreadKey, getSparkCanonicalAccountName, markSparkPostSeen, applySparkNpcLike, applySparkNpcFollow, setSparkAccountMuted } from '../utils/sparkCommunity';
import type { SparkCommunityState, SparkAccountType, SparkCommunityEvent } from '../utils/sparkCommunity';
import { trackEvent } from '../utils/analytics';
import TokenImg from '../components/os/TokenImg';

const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;

const apiErrorMessage = async (response: Response): Promise<string> => {
    let detail = '';
    try {
        const text = await response.text();
        try {
            const json = JSON.parse(text);
            detail = json?.error?.message || json?.message || json?.error || '';
        } catch {
            detail = text;
        }
    } catch { /* ignore unreadable error bodies */ }
    const compact = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    return `HTTP ${response.status}${compact ? `: ${compact}` : ''}`;
};

// Convert a twemoji codepoint string (eg "1f388", "1f3d6-fe0f") to the actual emoji character.
// Falls back to the input if conversion fails, or to ✨ if input itself looks broken.
const codepointToEmoji = (code: string): string => {
    if (!code) return '✨';
    // If it already contains non-hex (likely already a real emoji char), return as-is.
    if (!/^[0-9a-fA-F-]+$/.test(code)) return code;
    try {
        const points = code.split('-').map(c => parseInt(c, 16)).filter(n => Number.isFinite(n));
        if (points.length === 0) return '✨';
        return String.fromCodePoint(...points);
    } catch {
        return '✨';
    }
};

const STICKER_OPTIONS = [
    { code: '2728', label: 'sparkles' },
    { code: '1f388', label: 'balloon' },
    { code: '1f3a8', label: 'palette' },
    { code: '1f4f7', label: 'camera' },
    { code: '1f3b5', label: 'music' },
    { code: '1f3ae', label: 'game' },
    { code: '1f354', label: 'burger' },
    { code: '1f3d6-fe0f', label: 'beach' },
    { code: '1f4a4', label: 'sleep' },
    { code: '1f4a1', label: 'idea' },
];

// --- Constants & Styles ---
const BRAND_COLOR = '#555555'; // Premium Red

// Advanced Gradients for "Image" backgrounds
const POST_STYLES = [
    { name: 'Sunset', bg: 'linear-gradient(135deg, #b0b0b0 0%, #dbdbdb 99%, #dbdbdb 100%)', text: '#ffffff' },
    { name: 'Ocean', bg: 'linear-gradient(120deg, #e0e0e0 0%, #9f9f9f 100%)', text: '#ffffff' },
    { name: 'Peach', bg: 'linear-gradient(to top, #f4f4f4 0%, #d7d7d7 100%)', text: '#555555' },
    { name: 'Night', bg: 'linear-gradient(to top, #adadad 0%, #181818 100%)', text: '#ffffff' },
    { name: 'Love', bg: 'linear-gradient(to top, #636363 0%, #434343 100%)', text: '#ffffff' },
    { name: 'Fresh', bg: 'linear-gradient(120deg, #eaeaea 0%, #d0d0d0 100%)', text: '#444444' },
    { name: 'Lemon', bg: 'linear-gradient(135deg, #d2d2d2 0%, #b2b2b2 100%)', text: '#ffffff' },
    { name: 'Plum', bg: 'linear-gradient(135deg, #cdcdcd 0%, #bdbdbd 100%)', text: '#ffffff' },
];

const getRandomStyle = () => POST_STYLES[Math.floor(Math.random() * POST_STYLES.length)];

// --- Robust JSON Parser ---
const safeParseJSON = (input: string) => {
    const clean = input.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
        const parsed = JSON.parse(clean);
        if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
            const keys = Object.keys(parsed);
            if (keys.length === 1 && Array.isArray(parsed[keys[0]])) {
                return parsed[keys[0]];
            }
        }
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        try {
            const start = clean.indexOf('[');
            if (start === -1) return [];
            let end = clean.lastIndexOf('}');
            while (end > start) {
                const attempt = clean.substring(start, end + 1) + ']';
                try {
                    const result = JSON.parse(attempt);
                    if (Array.isArray(result)) return result;
                } catch (err) {}
                end = clean.lastIndexOf('}', end - 1);
            }
            return [];
        } catch (e2) {
            return [];
        }
    }
};

// --- Icons ---

const Icons = {
    Heart: ({ filled, onClick, className }: { filled?: boolean, onClick?: (e: any) => void, className?: string }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? BRAND_COLOR : "none"} stroke={filled ? BRAND_COLOR : "currentColor"} strokeWidth={2} className={`transition-transform active:scale-75 cursor-pointer ${className || "w-6 h-6"}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
        </svg>
    ),
    Star: ({ filled, onClick, className }: { filled?: boolean, onClick?: (e: any) => void, className?: string }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? "#c1c1c1" : "none"} stroke={filled ? "#c1c1c1" : "currentColor"} strokeWidth={2} className={`transition-transform active:scale-75 cursor-pointer ${className || "w-6 h-6"}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.563.563 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.563.563 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
        </svg>
    ),
    Share: ({ className, onClick }: { className?: string, onClick?: () => void }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className || "w-6 h-6"}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
        </svg>
    ),
    ChatBubble: ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className || "w-6 h-6"}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
        </svg>
    ),
    Back: ({ onClick, className }: { onClick?: () => void, className?: string }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={className || "w-6 h-6 cursor-pointer text-slate-800"}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
    ),
    Plus: ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={className || "w-6 h-6"}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
    ),
    Pencil: ({ className, onClick }: { className?: string, onClick?: () => void }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className || "w-4 h-4"}>
            <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
            <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
        </svg>
    )
};

// --- Main App ---

const SocialApp: React.FC = () => {
    const { closeApp, openApp, characters, worldbooks, updateCharacter, apiConfig, addToast, userProfile, groups, characterGroups } = useOS();
    const [feed, setFeed] = useState<SocialPost[]>([]);
    const [communityState, setCommunityState] = useState<SparkCommunityState>(() => {
        try { return normalizeSparkCommunityState(JSON.parse(localStorage.getItem('spark_community_state') || 'null')); }
        catch { return createEmptySparkCommunityState(); }
    });
    const communityRef = useRef(communityState);
    const communityWriteRef = useRef<Promise<void>>(Promise.resolve());
    const communityHydratedRef = useRef(false);
    const cachedCommunityAtStartRef = useRef<boolean>((() => {
        try { return localStorage.getItem('spark_community_state') !== null; }
        catch { return false; }
    })());
    const localAutonomyChangedRef = useRef(false);
    const writeCommunity = (next: SparkCommunityState) => {
        if (JSON.stringify(next.autonomy) !== JSON.stringify(communityRef.current.autonomy)) {
            localAutonomyChangedRef.current = true;
        }
        communityRef.current = next;
        setCommunityState(next);
        try { localStorage.setItem('spark_community_state', JSON.stringify(next)); } catch (error) { console.warn('Spark local community cache failed', error); }
        // Do not overwrite durable relationships until the initial DB community read finishes.
        if (!communityHydratedRef.current) return;
        const payload = JSON.stringify(next);
        const write = communityWriteRef.current.then(() => DB.saveAsset('spark_community_state', payload));
        communityWriteRef.current = write.catch(error => console.warn('Spark community save failed', error));
    };
    const sparkEvent = (type: SparkCommunityEvent['type'], actorAccountId: string, fields: Partial<Pick<SparkCommunityEvent, 'postId' | 'commentId' | 'targetAccountId'>> = {}) => {
        writeCommunity(appendSparkEvent(communityRef.current, {
            id: 'event-' + Date.now() + '-' + Math.random().toString(36).slice(2),
            type, actorAccountId, createdAt: Date.now(), ...fields,
        }));
    };
    const registerSparkPosts = (posts: SocialPost[]): SocialPost[] => {
        let state = communityRef.current;
        const registered = posts.map(post => {
            const type: SparkAccountType = post.authorType || (post.authorCharId ? 'character' : post.id.startsWith('user-post-') ? 'user' : 'stranger');
            const handles = post.authorCharId
                ? (characterHandles[post.authorCharId] || []) : [];
            const handleId = resolveSparkCharacterHandleId(post.authorCharId, post.authorId, post.authorName, handles);
            const currentName = getSparkCanonicalAccountName(post.authorName, post.authorId, handleId, handles, state.accounts);
            const result = ensureSparkAccount(state, {
                type, id: post.authorId,
                ownerCharId: type === 'character' ? post.authorCharId : undefined,
                handleId, displayName: currentName, avatar: post.authorAvatar,
            }, () => 'npc-' + Date.now() + '-' + Math.random().toString(36).slice(2), post.timestamp);
            state = result.state;
            const owner = type === 'character' ? characters.find(char => char.id === post.authorCharId) : undefined;
            const safeAvatar = owner && handleId ? getSparkAuthorAvatar(owner, post.authorName, characterHandles, handleId) : undefined;
            const authorAvatar = safeAvatar && owner && post.authorAvatar === owner.avatar ? safeAvatar : post.authorAvatar;
            const comments = (post.comments || []).map(comment => {
                const commentType: SparkAccountType = comment.authorType || (comment.authorCharId ? 'character' : comment.id.startsWith('cmt-user-') ? 'user' : 'stranger');
                const commentHandles = comment.authorCharId ? (characterHandles[comment.authorCharId] || []) : [];
                const commentHandleId = resolveSparkCharacterHandleId(comment.authorCharId, comment.authorId, comment.authorName, commentHandles);
                const currentCommentName = getSparkCanonicalAccountName(comment.authorName, comment.authorId, commentHandleId, commentHandles, state.accounts);
                const registeredComment = ensureSparkAccount(state, {
                    type: commentType, id: comment.authorId,
                    ownerCharId: commentType === 'character' ? comment.authorCharId : undefined,
                    handleId: commentHandleId, displayName: currentCommentName, avatar: comment.authorAvatar,
                }, () => 'npc-' + Date.now() + '-' + Math.random().toString(36).slice(2), comment.timestamp || post.timestamp);
                state = registeredComment.state;
                const commentOwner = commentType === 'character' ? characters.find(char => char.id === comment.authorCharId) : undefined;
                const safeCommentAvatar = commentOwner && commentHandleId ? getSparkAuthorAvatar(commentOwner, comment.authorName, characterHandles, commentHandleId) : undefined;
                const commentAvatar = safeCommentAvatar && commentOwner && comment.authorAvatar === commentOwner.avatar ? safeCommentAvatar : comment.authorAvatar;
                return { ...comment, authorId: registeredComment.account.id, authorType: registeredComment.account.type, authorName: currentCommentName, authorAvatar: commentAvatar };
            });
            return { ...post, authorId: result.account.id, authorType: result.account.type, authorName: currentName, authorAvatar, comments,
                source: post.source || (result.account.type === 'user' ? 'user' : 'legacy') } as SocialPost;
        });
        if (state !== communityRef.current) writeCommunity(state);
        return registered;
    };
    useEffect(() => {
        let active = true;
        void DB.getAsset('spark_community_state').then(raw => {
            if (!active) return;
            let restored: SparkCommunityState = communityRef.current;
            if (raw) {
                try {
                    restored = mergeSparkCommunityStates(
                        normalizeSparkCommunityState(JSON.parse(raw)), communityRef.current,
                        cachedCommunityAtStartRef.current || localAutonomyChangedRef.current,
                    );
                } catch (error) {
                    console.warn('Spark community recovery failed', error);
                }
            }
            communityHydratedRef.current = true;
            writeCommunity(restored);
        }).catch(error => {
            // Preserve the local cache and never overwrite an unreadable DB community snapshot.
            console.warn('Spark community restore failed; retaining local cache', error);
        });
        return () => { active = false; };
    }, []);
    type SparkNotice = { id: string; kind: 'likes' | 'follows' | 'comments'; actor: string; avatar?: string; content: string; postId?: string; time: number; read: boolean };
    const [notices, setNotices] = useState<SparkNotice[]>(() => {
        try { const saved = JSON.parse(localStorage.getItem('spark_notifications') || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
    });
    const [followerHistory, setFollowerHistory] = useState<{ id: string; count: number; time: number }[]>(() => {
        try { const saved = JSON.parse(localStorage.getItem('spark_follower_history') || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
    });
    const [expandedNoticeGroups, setExpandedNoticeGroups] = useState<string[]>([]);
    const noticeGroups = (kind: SparkNotice['kind']) => {
        const items = notices.filter(n => n.kind === kind &&
            !communityState.mutedAccountIds.includes(resolveSparkDMAccount(communityState.accounts, n.actor)?.id || '')
        ).sort((a, b) => b.time - a.time);
        const grouped = new Map<string, SparkNotice[]>();
        for (const item of items) {
            const key = kind === 'follows' ? 'new-followers' : kind === 'likes' ? 'post:' + (item.postId || item.id) : item.id;
            grouped.set(key, [...(grouped.get(key) || []), item]);
        }
        return [...grouped.entries()].map(([key, entries]) => ({ key, entries }));
    };
    const [noticeCategory, setNoticeCategory] = useState<'likes' | 'follows' | 'comments' | null>(null);
    const addNotices = (incoming: SparkNotice[]) => {
        if (!incoming.length) return;
        setNotices(prev => {
            const existing = new Set(prev.map(item => item.id));
            const next = [...incoming.filter(item => !existing.has(item.id)), ...prev].slice(0, 250);
            localStorage.setItem('spark_notifications', JSON.stringify(next));
            return next;
        });
    };
    const markNoticesRead = (kind: SparkNotice['kind']) => setNotices(prev => {
        const next = prev.map(item => item.kind === kind ? { ...item, read: true } : item);
        localStorage.setItem('spark_notifications', JSON.stringify(next));
        return next;
    });
    // Continue to render legacy notices, but mirror their precise IDs/read-state
    // into the existing community store for consistent later account/event reads.
    useEffect(() => {
        const next = syncSparkLegacyNotices(communityRef.current, notices);
        if (next !== communityRef.current) writeCommunity(next);
    }, [notices, communityState.accounts]);


    // Notifications represent named simulated interactions, never anonymous aggregate traffic.
    const [simulatedFollows, setSimulatedFollows] = useState<string[]>(() => {
        try { const saved = JSON.parse(localStorage.getItem('spark_simulated_follows') || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
    });
    const registerSimulatedInteraction = (actor: { id: string; name: string; avatar?: string }, post: SocialPost, kind: 'likes' | 'follows') => {
        if (post.authorType !== 'user') return;
        const noticeId = kind + ':' + actor.id + ':' + (kind === 'likes' ? post.id : 'user');
        if (kind === 'follows') {
            if (simulatedFollows.includes(actor.id)) return;
            setSimulatedFollows(prev => {
                if (prev.includes(actor.id)) return prev;
                const next = [...prev, actor.id];
                localStorage.setItem('spark_simulated_follows', JSON.stringify(next));
                return next;
            });
        }
        if (notices.some(item => item.id === noticeId)) return;
        if (kind === 'likes') updatePostInFeed(post.id, current => ({ ...current, likes: current.likes + 1 }));
        addNotices([{ id: noticeId, kind, actor: actor.name, avatar: actor.avatar,
            content: kind === 'likes' ? '赞了你的笔记《' + post.title + '》' : '关注了你',
            postId: kind === 'likes' ? post.id : undefined, time: Date.now(), read: false }]);
    };
    type SparkDM = SparkPrivateMessage;
    const [dmThreads, setDmThreads] = useState<SparkDMThreads>(() => {
        try { return recoverSparkInterruptedDMs(JSON.parse(localStorage.getItem('spark_dm_threads') || '{}')); }
        catch { return {}; }
    });
    const dmThreadsRef = useRef<SparkDMThreads>(dmThreads);
    const saveDMThreads = (next: SparkDMThreads) => {
        if (next === dmThreadsRef.current) return;
        dmThreadsRef.current = next;
        setDmThreads(next);
        try { localStorage.setItem('spark_dm_threads', JSON.stringify(next)); }
        catch (error) { console.warn('Spark DM persistence failed', error); }
    };
    const [npcPersonas, setNpcPersonas] = useState<Record<string, string>>(() => {
        try { return JSON.parse(localStorage.getItem('spark_npc_personas') || '{}'); } catch { return {}; }
    });
    const [dmUnread, setDmUnread] = useState<Record<string, number>>(() => {
        try { return JSON.parse(localStorage.getItem('spark_dm_unread') || '{}'); } catch { return {}; }
    });
    // Legacy DM maps are keyed by mutable public names. Copy only unambiguous
    // entries to immutable IDs, preserving unknown and conflicting conversations.
    useEffect(() => {
        const accounts = communityState.accounts;
        setDmThreads(prev => {
            const migrated = migrateSparkDMKeys(prev, accounts);
            if (migrated !== prev) {
                dmThreadsRef.current = migrated;
                localStorage.setItem('spark_dm_threads', JSON.stringify(migrated));
            }
            return migrated;
        });
        setNpcPersonas(prev => {
            const migrated = migrateSparkDMKeys(prev, accounts);
            if (migrated !== prev) localStorage.setItem('spark_npc_personas', JSON.stringify(migrated));
            return migrated;
        });
        setDmUnread(prev => {
            const migrated = migrateSparkDMKeys(prev, accounts);
            if (migrated !== prev) localStorage.setItem('spark_dm_unread', JSON.stringify(migrated));
            return migrated;
        });
    }, [communityState.accounts]);
    const [dmFilter, setDmFilter] = useState<'all' | 'following' | 'strangers'>('all');
    type SparkDMTarget = { handle: string; avatar: string; accountId?: string };
    const dmKey = (account: SparkDMTarget) =>
        getSparkDMThreadKey(account.accountId, account.handle, dmThreadsRef.current, communityRef.current.accounts);
    const openSparkDM = (account: SparkDMTarget) => {
        const registered = resolveSparkDMAccount(communityRef.current.accounts, account.handle, account.accountId);
        const target = { ...account, accountId: registered?.id || account.accountId };
        if (target.accountId && communityRef.current.mutedAccountIds.includes(target.accountId)) {
            addToast('该账号已屏蔽，解除屏蔽后才能私信', 'info');
            return;
        }
        setDmTarget(target);
        setDmVisibleLimit(80);
        const key = target.accountId && (dmUnread[target.accountId] !== undefined || dmThreads[target.accountId])
            ? target.accountId : dmKey(target);
        setDmUnread(prev => {
            const next = { ...prev, [key]: 0 };
            localStorage.setItem('spark_dm_unread', JSON.stringify(next));
            return next;
        });
    };
    const [dmTarget, setDmTarget] = useState<SparkDMTarget | null>(null);
    const [dmInput, setDmInput] = useState('');
    const [dmVisibleLimit, setDmVisibleLimit] = useState(80);
    const dmScrollRef = useRef<HTMLDivElement>(null);
    const dmInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!dmTarget) return;
        const viewport = window.visualViewport;
        const alignInput = () => {
            // On Android WebView the visual viewport changes as the keyboard appears.
            if (document.activeElement === dmInputRef.current && dmScrollRef.current) {
                dmScrollRef.current.scrollTop = dmScrollRef.current.scrollHeight;
            }
        };
        viewport?.addEventListener('resize', alignInput);
        return () => viewport?.removeEventListener('resize', alignInput);
    }, [dmTarget?.accountId, dmTarget?.handle]);
    const [dmBusy, setDmBusy] = useState(false);
    type SparkDMJob = { target: SparkDMTarget; key: string; id: string; accountId?: string };
    const dmQueueRef = useRef<SparkDMJob[]>([]);
    const dmBatchTimerRef = useRef<number | null>(null);
    const dmProcessingRef = useRef(false);
    const dmRequestRef = useRef<AbortController | null>(null);
    const processSparkDMQueue = async () => {
        if (dmProcessingRef.current || !mountedRef.current) return;
        if (dmBatchTimerRef.current !== null) {
            window.clearTimeout(dmBatchTimerRef.current);
            dmBatchTimerRef.current = null;
        }
        dmProcessingRef.current = true;
        setDmBusy(true);
        try {
            while (dmQueueRef.current.length && mountedRef.current) {
                // A short user burst to the same receiver costs ONE AI call.
                // Never mix separate characters/identities into a private prompt.
                const batch = takeSparkDMJobBatch(dmQueueRef.current);
                dmQueueRef.current = batch.remaining;
                const target = batch.jobs[0].target;
                const key = getSparkDMThreadKey(target.accountId, target.handle,
                    dmThreadsRef.current, communityRef.current.accounts);
                const ids = batch.jobs.map(item => item.id).filter(id =>
                    (dmThreadsRef.current[key] || []).some(m => m.id === id && m.delivery === 'pending'));
                if (!ids.length) continue;
                const controller = new AbortController();
                dmRequestRef.current = controller;
                const timeout = window.setTimeout(() => controller.abort(), 30000);
                try {
                    if (target.accountId && communityRef.current.mutedAccountIds.includes(target.accountId)) {
                        throw new Error('此账号已屏蔽');
                    }
                    if (!apiConfig.apiKey) throw new Error('请先配置 API Key');
                    const registered = communityRef.current.accounts.filter(a =>
                        target.accountId ? a.id === target.accountId :
                        a.displayName === target.handle || a.aliases.includes(target.handle));
                    const candidates = characters.filter(ch => (characterHandles[ch.id] || [])
                        .some(a => a.handle === target.handle));
                    const owners = [...new Set(registered.map(a => a.ownerCharId).filter(Boolean))];
                    if ((!target.accountId && candidates.length > 1) || registered.length > 1 || owners.length > 1) {
                        throw new Error('同名账号归属不明，无法安全生成私信');
                    }
                    const owner = owners.length === 1 ? characters.find(ch => ch.id === owners[0]) :
                        target.accountId ? undefined : candidates[0];
                    if (target.accountId && registered.length === 0) throw new Error('私信账号不存在');
                    const identity = owner ? await buildGenerationContext([owner]) :
                        '你是 Spark 虚拟社区中的独立普通网友。稳定人设：' +
                        (npcPersonas[key] || npcPersonas[target.handle] || '依据自己已有公开帖子形成性格和兴趣') +
                        '。只能知道自己的公开经历，不能知道别人的私聊或匿名身份。';
                    if (controller.signal.aborted) throw new Error('私信请求超时（30 秒），可点原消息重试');
                    const history = sparkDMBatchHistory(dmThreadsRef.current, key, ids);
                    if (!history.length) throw new Error('原消息已不存在');
                    const first = feedRef.current.filter(post =>
                        target.accountId ? post.authorId === target.accountId : post.authorName === target.handle,
                    ).sort((a, b) => a.timestamp - b.timestamp)[0];
                    const prompt = identity + '\n当前聊天账号：' + target.handle +
                        '\n该账号最早的公开帖子：' + (first ? first.title + '\n' + first.content : '暂无公开帖子') +
                        '\n只扮演此账号本人。用户接连发送的几条消息属于一次完整发言，请一起理解后自然回应一次，不要逐条机械重复回复。不得泄露其他人的隐私。';
                    const response = await fetch(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiConfig.apiKey },
                        body: JSON.stringify({ model: apiConfig.model,
                            messages: [{ role: 'system', content: prompt },
                                ...history.map(item => ({ role: item.role, content: item.content }))],
                            temperature: 0.9, max_tokens: 650 }),
                        signal: controller.signal,
                        __sullyMeta: { appId: 'social', appName: 'Spark', purpose: 'Spark 合并私信回复' },
                    } as RequestInit);
                    if (!response.ok) throw new Error(await apiErrorMessage(response));
                    const answer = extractContent(await safeResponseJson(response)).trim();
                    if (!answer) throw new Error('模型返回空回复');
                    if (controller.signal.aborted || !mountedRef.current ||
                        (target.accountId && communityRef.current.mutedAccountIds.includes(target.accountId))) {
                        throw new Error('请求已中止');
                    }
                    const currentKey = getSparkDMThreadKey(target.accountId, target.handle,
                        dmThreadsRef.current, communityRef.current.accounts);
                    saveDMThreads(appendSparkDMBatchAnswer(dmThreadsRef.current, currentKey, ids, answer, Date.now()));
                } catch (error: any) {
                    if (mountedRef.current) {
                        const currentKey = getSparkDMThreadKey(target.accountId, target.handle,
                            dmThreadsRef.current, communityRef.current.accounts);
                        let next = dmThreadsRef.current;
                        for (const id of ids) next = setSparkDMDelivery(next, currentKey, id, 'failed');
                        saveDMThreads(next);
                        addToast('私信未完成，点击原消息可重试：' +
                            (error?.name === 'AbortError' ? '请求超时或中止' : error?.message || '网络错误'), 'error');
                    }
                } finally {
                    window.clearTimeout(timeout);
                    if (dmRequestRef.current === controller) dmRequestRef.current = null;
                }
            }
        } finally {
            dmProcessingRef.current = false;
            if (mountedRef.current) setDmBusy(false);
        }
    };
    const queueSparkDM = (target: SparkDMTarget, key: string, id: string) => {
        if (dmQueueRef.current.some(item => item.id === id)) return;
        dmQueueRef.current.push({ target, key, id, accountId: target.accountId });
        // Hold a short burst before billing an API call; never wait indefinitely.
        if (!dmProcessingRef.current) {
            if (dmBatchTimerRef.current !== null) window.clearTimeout(dmBatchTimerRef.current);
            if (dmQueueRef.current.length >= 6) void processSparkDMQueue();
            else dmBatchTimerRef.current = window.setTimeout(() => {
                dmBatchTimerRef.current = null;
                void processSparkDMQueue();
            }, 1200);
        }
    };
    const sendSparkDM = () => {
        if (!dmTarget || !dmInput.trim()) return;
        if (!apiConfig.apiKey) { addToast('请先配置 API Key', 'error'); return; }
        if (dmTarget.accountId && communityRef.current.mutedAccountIds.includes(dmTarget.accountId)) {
            addToast('该账号已屏蔽，无法发送私信', 'info');
            return;
        }
        const target = dmTarget;
        const key = dmKey(target);
        const id = 'dm-user-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        saveDMThreads(appendSparkDMUser(dmThreadsRef.current, key, dmInput.trim(), id, Date.now()));
        setDmInput('');
        if (target.accountId) sparkEvent('dm_sent', 'user', { targetAccountId: target.accountId });
        queueSparkDM(target, key, id);
    };
    const retrySparkDM = (target: SparkDMTarget, id?: string) => {
        if (!id || !apiConfig.apiKey) return;
        if (target.accountId && communityRef.current.mutedAccountIds.includes(target.accountId)) return;
        const key = dmKey(target);
        if (!(dmThreadsRef.current[key] || []).some(m => m.id === id && m.delivery === 'failed')) return;
        saveDMThreads(setSparkDMDelivery(dmThreadsRef.current, key, id, 'pending'));
        queueSparkDM(target, key, id);
    };
    const [fanCounts, setFanCounts] = useState<Record<string, number>>(() => {
        try { return JSON.parse(localStorage.getItem('spark_fan_counts') || '{}'); } catch { return {}; }
    });
    const [fanChanges, setFanChanges] = useState<Record<string, number>>({});
    const [postTraffic, setPostTraffic] = useState<Record<string, SparkTraffic>>(() => {
        try { return JSON.parse(localStorage.getItem('spark_post_traffic') || '{}'); } catch { return {}; }
    });
    const trafficRef = useRef(postTraffic);
    const [editingFans, setEditingFans] = useState(false);
    const [fanInput, setFanInput] = useState('0');
    const fanKey = sparkTrafficKey;
    const applyTraffic = (posts: SocialPost[]) => {
        const previous = trafficRef.current;
        const next = { ...previous };
        const counts = { ...fanCountsRef.current };
        const changes: Record<string, number> = {};
        for (const post of posts) {
            if (post.authorType !== 'user' && post.authorType !== 'character') continue;
            const key = fanKey(post);
            const old = previous[post.id];
            const now = evaluateSparkTraffic(post, counts[key] || 0, old);
            if (old && old.evaluatedLikes === now.evaluatedLikes && old.evaluatedComments === now.evaluatedComments && old.evaluatedSaves === now.evaluatedSaves) continue;
            // Traffic estimates are informational; follower relations only change after named follow events.
            const difference = 0;
            counts[key] = Math.max(0, (counts[key] || 0) + difference);
            changes[key] = (changes[key] || 0) + difference;
            next[post.id] = now;
        }
        const userIncrease = Object.entries(changes).filter(([key, delta]) => key === 'user' && delta > 0).reduce((sum, [, delta]) => sum + delta, 0);
        if (userIncrease > 0) {
            setFollowerHistory(prev => {
                const nextHistory = [{ id: 'growth:' + Date.now() + ':' + Math.random(), count: userIncrease, time: Date.now() }, ...prev].slice(0, 100);
                localStorage.setItem('spark_follower_history', JSON.stringify(nextHistory));
                return nextHistory;
            });
        }
        trafficRef.current = next;
        fanCountsRef.current = counts;
        setPostTraffic(next);
        setFanCounts(counts);
        setFanChanges(changes);
        localStorage.setItem('spark_post_traffic', JSON.stringify(next));
        localStorage.setItem('spark_fan_counts', JSON.stringify(counts));
    };
    const fanCountsRef = useRef(fanCounts);
    useEffect(() => { fanCountsRef.current = fanCounts; }, [fanCounts]);
    // Private on-device recommendation interests: only affect discovery generation.
    const [interestScores, setInterestScores] = useState<Record<string, number>>(() => {
        try { return JSON.parse(localStorage.getItem('spark_interest_scores') || '{}'); } catch { return {}; }
    });
    const interestRef = useRef(interestScores);
    const learnInterest = (post: SocialPost, weight: number) => {
        const tokens = Array.from(new Set(((post.title || '') + ' ' + (post.content || '') + ' ' + (post.tags || []).join(' ')).toLowerCase().match(/[\\u4e00-\\u9fff]{2,5}|[a-z]{3,18}/g) || [])).filter(token => !/^(今天|感觉|真的|一个|什么|就是|自己|这个|那个|一下|大家|可以|还是|因为|然后|没有|一些|我们|你们|他们)$/.test(token)).slice(0, 24);
        const categories: Record<string, string[]> = {
            '绘画插画': ['画画', '绘画', '插画', '板绘', '水彩', '速写', '画师', '稿件', '约稿', '美术', 'procreate', 'illustration', 'art'],
            '二次元动漫': ['动漫', '漫画', '番剧', 'cos', '二次元', '同人', 'oc', '手办', '游戏'],
            '帅哥颜值': ['帅哥', '男神', '颜值', '腹肌', '男模', '美男', '帅气', '写真'],
            '穿搭时尚': ['穿搭', '衣服', '时尚', '妆容', '化妆', 'ootd', '搭配'],
            '美食探店': ['美食', '吃饭', '甜品', '烘焙', '咖啡', '餐厅', '探店', '做饭'],
            '宠物动物': ['猫咪', '狗狗', '宠物', '小猫', '小狗', '动物'],
            '生活日常': ['日常', '生活', '旅行', '旅游', '上班', '学习', '校园'],
        };
        const textContent = ((post.title || '') + ' ' + (post.content || '') + ' ' + (post.tags || []).join(' ')).toLowerCase();
        const next = { ...interestRef.current };
        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(word => textContent.includes(word))) next[category] = Math.max(0, Math.min(30, (next[category] || 0) + weight * 2));
        }
        for (const token of tokens) next[token] = Math.max(0, Math.min(30, (next[token] || 0) + weight));
        interestRef.current = next;
        setInterestScores(next);
        localStorage.setItem('spark_interest_scores', JSON.stringify(next));
    };
    const [searchQuery, setSearchQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [activeTopic, setActiveTopic] = useState<string | null>(null);
    const matchingSparkAccounts = useMemo(() => {
        const term = searchQuery.trim().toLocaleLowerCase();
        if (!term) return [];
        return communityState.accounts
            .filter(account => account.id !== 'user' && !communityState.mutedAccountIds.includes(account.id) &&
                [account.displayName, ...(account.aliases || [])].some(name => name.toLocaleLowerCase().includes(term)))
            .slice(0, 8);
    }, [searchQuery, communityState.accounts]);
    const matchingSparkTopics = useMemo(() => {
        const term = searchQuery.trim().toLocaleLowerCase();
        if (!term) return [];
        return [...new Set(feed.flatMap(post => post.tags || []).filter(tag => tag && tag.toLocaleLowerCase().includes(term)))].slice(0, 8);
    }, [searchQuery, feed]);
    const [feedTab, setFeedTab] = useState<'discover' | 'following'>('discover');
    const [visibleLimit, setVisibleLimit] = useState(40);
    const [viewedAccount, setViewedAccount] = useState<{ handle: string; avatar: string; accountId?: string } | null>(null);
    const [accountVisibleLimit, setAccountVisibleLimit] = useState(60);
    useEffect(() => { setAccountVisibleLimit(60); }, [viewedAccount?.accountId, viewedAccount?.handle]);
    const isSparkMuted = (accountId?: string) => !!accountId && communityRef.current.mutedAccountIds.includes(accountId);
    const getSparkPublicAuthorId = (name: string, charId?: string): string | undefined => {
        if (charId) {
            const handle = (characterHandles[charId] || []).find(item => item.handle === name);
            if (handle) return 'character:' + charId + ':handle:' + handle.id;
            return communityRef.current.accounts.find(a => a.ownerCharId === charId &&
                (a.displayName === name || a.aliases.includes(name)))?.id;
        }
        return resolveSparkDMAccount(communityRef.current.accounts, name)?.id;
    };
    const toggleMuteSparkAccount = (handle: string, id?: string) => {
        const account = resolveSparkDMAccount(communityRef.current.accounts, handle, id);
        if (!account || account.type === 'user') { addToast('账号身份无法确定，不能屏蔽', 'error'); return; }
        const muted = !isSparkMuted(account.id);
        writeCommunity(setSparkAccountMuted(communityRef.current, account.id, 'user', muted, Date.now(),
            'mute:' + account.id + ':' + Date.now()));
        if (muted && dmTarget?.accountId === account.id) setDmTarget(null);
        addToast(muted ? '已屏蔽账号，历史私信仍保留' : '已解除屏蔽', 'info');
    };
    const [namingCharId, setNamingCharId] = useState<string | null>(null);
    const [hiddenPostIds, setHiddenPostIds] = useState<string[]>(() => {
        try { const saved = JSON.parse(localStorage.getItem('spark_hidden_posts') || '[]'); return Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : []; } catch { return []; }
    });
    const hidePost = (postId: string) => {
        setHiddenPostIds(prev => {
            const next = prev.includes(postId) ? prev : [...prev, postId];
            localStorage.setItem('spark_hidden_posts', JSON.stringify(next));
            return next;
        });
        setSelectedPost(current => current?.id === postId ? null : current);
        addToast('已隐藏这篇笔记，可在设置中恢复', 'info');
    };
    const [followedHandles, setFollowedHandles] = useState<string[]>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('spark_followed_handles') || '[]');
            return Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : [];
        } catch { return []; }
    });
    // Modes: 'home' (Feed) | 'me' (Profile) | 'create' (Modal Overlay)
    const [activeTab, setActiveTab] = useState<'home' | 'me' | 'messages'>('home');
    useAppShortcut(ShortcutAppID.Social, intent => { setSelectedPost(null); setIsCreateOpen(false); setShowSettings(false); setActiveTab(intent.entryId === 'me' ? 'me' : 'home'); });
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const publishingRef = useRef(false);
    const [showUtilityShelf, setShowUtilityShelf] = useState(false);
    const [showCharPosting, setShowCharPosting] = useState(false);
    const [postingCharIds, setPostingCharIds] = useState<string[]>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('spark_posting_char_ids') || '[]');
            return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
        } catch { return []; }
    });
    useEffect(() => {
        try { localStorage.setItem('spark_posting_char_ids', JSON.stringify(postingCharIds)); }
        catch (error) { console.warn('Spark participating characters could not be saved', error); }
    }, [postingCharIds]);
    const [autoIdentity, setAutoIdentity] = useState(true);
    const [naturalComments, setNaturalComments] = useState(true);
    const [isCharPosting, setIsCharPosting] = useState(false); 
    
    const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isAutonomyBusy, setIsAutonomyBusy] = useState(false);
    const feedScrollRef = useRef<HTMLDivElement>(null);
    const pullStartY = useRef<number | null>(null);
    const pullStartX = useRef<number | null>(null);
    const [pullDistance, setPullDistance] = useState(0);
    const pullDistanceRef = useRef(0);
    const onFeedTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
        if (activeTab !== 'home' || isRefreshing || (feedScrollRef.current?.scrollTop || 0) > 0) {
            pullStartY.current = null;
            pullStartX.current = null;
            return;
        }
        pullStartY.current = e.touches[0]?.clientY ?? null;
        pullStartX.current = e.touches[0]?.clientX ?? null;
    };
    const onFeedTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
        if (pullStartY.current === null || activeTab !== 'home' || (feedScrollRef.current?.scrollTop || 0) > 0) return;
        const deltaX = Math.abs((e.touches[0]?.clientX ?? pullStartX.current ?? 0) - (pullStartX.current ?? 0));
        const deltaY = (e.touches[0]?.clientY ?? pullStartY.current) - pullStartY.current;
        // Horizontal image/carousel swipes must not trigger a paid feed refresh.
        if (deltaX > 12 && deltaX > Math.abs(deltaY)) {
            pullStartY.current = null;
            pullStartX.current = null;
            pullDistanceRef.current = 0;
            setPullDistance(0);
            return;
        }
        const delta = Math.max(0, Math.min(100, deltaY * 0.45));
        pullDistanceRef.current = delta;
        setPullDistance(delta);
    };
    const onFeedTouchEnd = () => {
        const shouldRefresh = pullStartY.current !== null && pullDistanceRef.current >= 65;
        pullStartY.current = null;
        pullStartX.current = null;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        if (shouldRefresh && !isRefreshing) void handleRefresh();
    };
    const [loadingComments, setLoadingComments] = useState(false);
    const [commentVisibleLimit, setCommentVisibleLimit] = useState(80);
    
    // Post Creation State
    const readDraft = (): Record<string, string> => {
        try {
            const raw = JSON.parse(localStorage.getItem('spark_post_draft') || '{}');
            return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        } catch { return {}; }
    };
    const [newPostTitle, setNewPostTitle] = useState(() => readDraft().title || '');
    const [newPostContent, setNewPostContent] = useState(() => readDraft().content || '');
    const [newPostTags, setNewPostTags] = useState(() => readDraft().tags || '');
    const [newPostEmoji, setNewPostEmoji] = useState(() => readDraft().emoji || '2728');
    const [stockImages, setStockImages] = useState<XhsStockImage[]>([]);
    const [selectedStockUrl, setSelectedStockUrl] = useState(() => readDraft().stockUrl || '');
    const [localPostImage, setLocalPostImage] = useState(() => readDraft().localImage || '');
    useEffect(() => {
        try {
            if (newPostTitle || newPostContent || newPostTags || selectedStockUrl || localPostImage) {
                localStorage.setItem('spark_post_draft', JSON.stringify({
                    title: newPostTitle, content: newPostContent, tags: newPostTags, emoji: newPostEmoji,
                    stockUrl: selectedStockUrl, localImage: localPostImage,
                }));
            } else localStorage.removeItem('spark_post_draft');
        } catch (error) { console.warn('Spark draft backup failed', error); }
    }, [newPostTitle, newPostContent, newPostTags, newPostEmoji, selectedStockUrl, localPostImage]);
    const closeCreatePost = () => {
        if ((newPostTitle.trim() || newPostContent.trim() || newPostTags.trim() || selectedStockUrl || localPostImage) &&
            !window.confirm('保存当前草稿并退出发布？下次打开可以继续编辑。')) return;
        setIsCreateOpen(false);
    };
    const [showCommentStickers, setShowCommentStickers] = useState(false);
    const handleLocalPostPhoto = async (file?: File) => {
        if (!file) return;
        try {
            const blob = await processImageToBlob(file);
            const ref = await putImageBlob(blob);
            setLocalPostImage(ref);
            setSelectedStockUrl('');
            addToast('已选择本地照片', 'success');
        } catch (error: any) { addToast('照片导入失败：' + (error?.message || '未知错误'), 'error'); }
    };
    const reloadStock = async () => setStockImages(await DB.getXhsStockImages());
    useEffect(() => { void reloadStock(); }, []);
    const pickStock = (title: string, content: string) => {
        const selected = chooseSparkStock(stockImages.filter(img => !img.category || img.category === 'material'), title, content);
        if (selected) void DB.updateXhsStockImageUsage(selected.id);
        return selected?.url;
    };
    const postVisual = (value: string | undefined, className: string) => value && (/^https?:\/\//i.test(value) || value.startsWith('blobref:'))
        ? <TokenImg value={value} className={className + ' object-cover'} />
        : <span>{codepointToEmoji(value || '✨')}</span>;

    const [sparkMemories, setSparkMemories] = useState<Record<string, string[]>>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('spark_char_memories') || '{}') as Record<string, string[]>;
            // Remove legacy entries that incorrectly exposed private collections or identified who liked a post.
            return Object.fromEntries(Object.entries(saved).map(([id, events]) => [id, (Array.isArray(events) ? events : []).filter(event => !/(收藏|User 点赞|User 取消了点赞|用户点赞|用户取消点赞)/i.test(String(event))) ]));
        } catch { return {}; }
    });
    const sparkMemoriesRef = useRef(sparkMemories);
    const remember = (charId: string | undefined, post: SocialPost, event: string) => {
        if (!charId || !characters.some(char => char.id === charId)) return;
        const next = { ...sparkMemoriesRef.current, [charId]: [...(sparkMemoriesRef.current[charId] || []), new Date().toLocaleDateString() + ' 《' + post.title.slice(0, 70) + '》 ' + event.slice(0, 250)].slice(-60) };
        sparkMemoriesRef.current = next;
        setSparkMemories(next);
        localStorage.setItem('spark_char_memories', JSON.stringify(next));
    };
        // Comment Input State
    const [commentInput, setCommentInput] = useState('');
    const [replyTarget, setReplyTarget] = useState<SocialComment | null>(null);
    const [isReplyingToUser, setIsReplyingToUser] = useState(false);

    // Settings / Handle Management
    const [showSettings, setShowSettings] = useState(false);
    const [sparkWorldbookIds, setSparkWorldbookIds] = useState<string[]>(() => {
        try { const saved = JSON.parse(localStorage.getItem('spark_worldbook_ids') || '[]'); return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
    });
    const toggleSparkWorldbook = (id: string) => setSparkWorldbookIds(prev => {
        const next = prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id];
        localStorage.setItem('spark_worldbook_ids', JSON.stringify(next));
        return next;
    });
    const [characterHandles, setCharacterHandles] = useState<Record<string, SubAccount[]>>(() => {
        let saved: Record<string, SubAccount[]> = {};
        try {
            const raw = JSON.parse(localStorage.getItem('spark_char_handles') || '{}');
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) saved = raw;
        } catch { /* Preserve generated defaults if legacy storage is malformed. */ }
        const normalized = { ...saved };
        for (const char of characters) {
            if (!Array.isArray(normalized[char.id]) || normalized[char.id].length === 0) {
                normalized[char.id] = [{ id: 'default', handle: char.socialProfile?.handle || char.name, note: '主账号' }];
            }
        }
        return normalized;
    });
    const [identityGroupId, setIdentityGroupId] = useState(GROUP_FILTER_ALL); // 身份管理弹窗的角色分组筛选

    // Sharing State
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareGroupId, setShareGroupId] = useState(GROUP_FILTER_ALL); // 分享帖子弹窗的角色分组筛选

    // Profile Sub-tab
    const [profileTab, setProfileTab] = useState<'notes' | 'collects'>('notes');
    const [profileVisibleLimit, setProfileVisibleLimit] = useState(60);
    useEffect(() => { setProfileVisibleLimit(60); }, [profileTab]);

    // User Custom Profile State (Local - Decoupled from Global UserProfile)
    const [socialProfile, setSocialProfile] = useState<SocialAppProfile>({
        name: '新用户',
        avatar: userProfile.avatar,
        bio: '这个人很懒，什么都没写。'
    });
    const visibleFeed = useMemo(() => rankSparkFeed(feed, communityState, {
        mode: feedTab, query: searchQuery, topic: activeTopic, userDisplayName: socialProfile.name,
    }), [feed, communityState, feedTab, searchQuery, activeTopic, socialProfile.name]);
    const [userSparkId, setUserSparkId] = useState('95279527');
    const [userBgImage, setUserBgImage] = useState('');
    const [isEditingId, setIsEditingId] = useState(false);
    
    const userBgInputRef = useRef<HTMLInputElement>(null);
    const socialAvatarInputRef = useRef<HTMLInputElement>(null);

    // Refs
    const commentsEndRef = useRef<HTMLDivElement>(null);
    const detailScrollRef = useRef<HTMLDivElement>(null);
    const prevCommentCountRef = useRef(0); // Track comment count to prevent initial jump
    const feedRef = useRef<SocialPost[]>([]);
    const mountedRef = useRef(true);
    const refreshRequestRef = useRef<AbortController | null>(null);
    const autonomyRequestRef = useRef<AbortController | null>(null);
    const commentRequestRef = useRef<{ postId: string; controller: AbortController } | null>(null);
    const commentOpenTimerRef = useRef<number | null>(null);
    const lastOpenedPostIdRef = useRef<string | null>(null);
    const replyRequestRef = useRef<{ postId: string; controller: AbortController } | null>(null);
    const replyQueueRef = useRef<{ post: SocialPost; content: string; parentCommentId: string }[]>([]);
    const replyBatchTimerRef = useRef<number | null>(null);
    const lastCommentSubmitRef = useRef<{ postId: string; content: string; at: number } | null>(null);
    const feedLoadGenerationRef = useRef(0);
    const clearingFeedRef = useRef(false);
    const deletedPostIdsRef = useRef<Set<string>>(new Set());
    const postPersistenceRef = useRef<Promise<void>>(Promise.resolve());
    const autonomyTickRef = useRef<() => Promise<void>>(async () => {});
    const persistPostMutation = (write: () => Promise<unknown>): Promise<void> => {
        const running = postPersistenceRef.current.then(async () => { await write(); });
        // An individual write can fail, but must not permanently block later edits.
        postPersistenceRef.current = running.catch(error => console.error('Spark post persistence failed', error));
        return running;
    };

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            refreshRequestRef.current?.abort();
            autonomyRequestRef.current?.abort();
            commentRequestRef.current?.controller.abort();
            if (commentOpenTimerRef.current !== null) window.clearTimeout(commentOpenTimerRef.current);
            commentOpenTimerRef.current = null;
            lastOpenedPostIdRef.current = null;
            replyRequestRef.current?.controller.abort();
            refreshRequestRef.current = null;
            commentRequestRef.current = null;
            replyRequestRef.current = null;
            replyQueueRef.current = [];
            if (replyBatchTimerRef.current !== null) window.clearTimeout(replyBatchTimerRef.current);
            replyBatchTimerRef.current = null;
            dmRequestRef.current?.abort();
            dmRequestRef.current = null;
            if (dmBatchTimerRef.current !== null) window.clearTimeout(dmBatchTimerRef.current);
            dmBatchTimerRef.current = null;
            dmQueueRef.current = [];
        };
    }, []);

    useEffect(() => {
        const generation = feedLoadGenerationRef.current;
        DB.getSocialPosts().then(posts => {
            if (!mountedRef.current || generation !== feedLoadGenerationRef.current) return;
            if (posts.length > 0) {
                const sorted = registerSparkPosts([...posts].sort((a,b) => b.timestamp - a.timestamp));
                // Preserve prior follows stored by handle while migrating to account IDs.
                let migrated = communityRef.current;
                try {
                    const legacy = JSON.parse(localStorage.getItem('spark_followed_handles') || '[]');
                    if (Array.isArray(legacy)) for (const handle of legacy) {
                        if (typeof handle !== 'string') continue;
                        const candidates = migrated.accounts.filter(a => a.type !== 'user' &&
                            (a.displayName === handle || a.aliases.includes(handle)));
                        // Never attribute an old name-only follow to the first of two same-name accounts.
                        if (candidates.length !== 1) continue;
                        const account = candidates[0];
                        if (!migrated.follows.some(item => item.followerId === 'user' && item.followedId === account.id)) {
                            migrated = toggleSparkFollow(migrated, 'user', account.id, Date.now(), 'migrate-follow-' + account.id).state;
                        }
                    }
                } catch { /* Invalid legacy follow list is safely ignored. */ }
                if (migrated !== communityRef.current) writeCommunity(migrated);
                // IndexedDB can be slow on mobile. If the user already created
                // something while this read was pending, keep that live version.
                const liveIds = new Set(feedRef.current.map(post => post.id));
                const next = [...feedRef.current, ...sorted.filter(post => !liveIds.has(post.id) && !deletedPostIdsRef.current.has(post.id))];
                feedRef.current = next;
                setFeed(next);
            }
        }).catch(error => { if (mountedRef.current) addToast('读取 Spark 历史帖子失败：' + (error?.message || error), 'error'); });
        
        // Load User Config & Social Profile from DB assets and LocalStorage (hybrid migration)
        const loadAssets = async () => {
            const savedUserId = localStorage.getItem('spark_user_id');
            // Try load from DB first
            const dbBg = await DB.getAsset('spark_user_bg');
            const dbProfileStr = await DB.getAsset('spark_social_profile');
            
            // Fallback to localStorage if DB missing (Legacy migration)
            const lsBg = localStorage.getItem('spark_user_bg');
            const lsProfileStr = localStorage.getItem('spark_social_profile');

            if (savedUserId) setUserSparkId(savedUserId);
            
            if (dbBg) {
                setUserBgImage(dbBg);
            } else if (lsBg) {
                // Migrate to DB
                setUserBgImage(lsBg);
                await DB.saveAsset('spark_user_bg', lsBg);
                localStorage.removeItem('spark_user_bg');
            }
            
            let loadedProfile = null;
            if (dbProfileStr) {
                try { loadedProfile = JSON.parse(dbProfileStr); } catch(e) {}
            } else if (lsProfileStr) {
                try { loadedProfile = JSON.parse(lsProfileStr); } catch(e) {}
                // Migrate to DB
                if (loadedProfile) {
                    await DB.saveAsset('spark_social_profile', lsProfileStr!);
                    localStorage.removeItem('spark_social_profile');
                }
            }

            if (loadedProfile) {
                setSocialProfile(loadedProfile);
            } else {
                // Initial fallback to global user profile only once
                setSocialProfile({
                    name: '新用户',
                    avatar: userProfile.avatar,
                    bio: '这个人很懒，什么都没写。'
                });
            }
        };
        loadAssets();

        // Add defaults for newly loaded characters, never overwrite live edits or newly generated alts.
        setCharacterHandles(current => {
            const updated = { ...current };
            let changed = false;
            for (const char of characters) {
                if (!Array.isArray(updated[char.id]) || updated[char.id].length === 0) {
                    updated[char.id] = [{ id: 'default', handle: char.socialProfile?.handle || char.name, note: '主账号' }];
                    changed = true;
                }
            }
            return changed ? updated : current;
        });

    }, [characters.length]);

    // Save Handles to LocalStorage whenever updated
    useEffect(() => {
        if (Object.keys(characterHandles).length > 0) {
            localStorage.setItem('spark_char_handles', JSON.stringify(characterHandles));
        }
    }, [characterHandles]);

    // FIX: Only scroll to bottom if comment count INCREASES, not on initial load
    // This prevents the "jumping" behavior when opening a post
    useEffect(() => {
        if (selectedPost) {
            const currentCount = selectedPost.comments.length;
            if (currentCount > prevCommentCountRef.current) {
                // New comment added: only scroll the internal detail panel.
                // Avoid scrollIntoView(), which can scroll outer containers and shift the whole app layout.
                const detailScroller = detailScrollRef.current;
                if (detailScroller) {
                    detailScroller.scrollTo({
                        top: detailScroller.scrollHeight,
                        behavior: 'smooth'
                    });
                }
            }
            prevCommentCountRef.current = currentCount;
        } else {
            prevCommentCountRef.current = 0; // Reset
        }
    }, [selectedPost?.comments.length]);

    // --- Helpers ---

    const suggestAccountNames = async (charId: string) => {
        const char = characters.find(c => c.id === charId);
        if (!char || !apiConfig.apiKey || namingCharId) { if (!apiConfig.apiKey) addToast('请配置 API Key', 'error'); return; }
        setNamingCharId(charId);
        try {
            const context = await buildGenerationContext([char]);
            const accounts = characterHandles[charId] || [];
            const prompt = `请严格根据角色核心人设、社会身份、爱好和公开形象，给角色「${char.name}」设计真实社交平台网名。大号不一定是本名；小号要体现不同使用目的，但不能泄露私密身份。已有账号：${JSON.stringify(accounts)}。只输出 JSON 数组，每项 {"id":"已有账号id","handle":"独特网名"}，每个账号一项，不能重复、不能与用户网名相同。`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: buildGenerationMessages([char], context, prompt), temperature: 0.8 }),
                __sullyMeta: { appId: 'social', appName: 'Spark', purpose: '角色自拟账号昵称' },
            } as RequestInit);
            if (!response.ok) throw new Error(await apiErrorMessage(response));
            const items = safeParseJSON(extractContent(await safeResponseJson(response)));
            if (!Array.isArray(items)) throw new Error('返回格式不正确');
            const used = new Set([socialProfile.name.trim().toLowerCase()]);
            const suggestions = new Map<string, string>();
            for (const item of items) {
                const name = typeof item?.handle === 'string' ? item.handle.trim().slice(0, 30) : '';
                if (!accounts.some(a => a.id === item?.id) || !name || used.has(name.toLowerCase())) continue;
                suggestions.set(item.id, name); used.add(name.toLowerCase());
            }
            if (!suggestions.size) throw new Error('没有有效的网名');
            setCharacterHandles(prev => ({ ...prev, [charId]: (prev[charId] || []).map(a => suggestions.has(a.id) ? { ...a, handle: suggestions.get(a.id)! } : a) }));
            addToast('已根据角色人设生成昵称', 'success');
        } catch (e: any) { addToast('生成昵称失败：' + e.message, 'error'); }
        finally { setNamingCharId(null); }
    };

    const addSubAccount = (charId: string) => {
        const newAcct: SubAccount = {
            id: `sub-${Date.now()}`,
            handle: '新马甲',
            note: '身份备注'
        };
        setCharacterHandles(prev => ({
            ...prev,
            [charId]: [...(prev[charId] || []), newAcct]
        }));
        trackEvent('给角色添加一个马甲');
    };

    const updateSubAccount = (charId: string, acctId: string, field: keyof SubAccount, value: string) => {
        setCharacterHandles(prev => ({
            ...prev,
            [charId]: prev[charId].map(a => a.id === acctId ? { ...a, [field]: value } : a)
        }));
    };

    const deleteSubAccount = (charId: string, acctId: string) => {
        setCharacterHandles(prev => ({
            ...prev,
            [charId]: prev[charId].filter(a => a.id !== acctId)
        }));
    };

    const handleUserBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                // 背景图存二进制：assets 行里只留 blobref 令牌，渲染走 TokenImg。
                // 旧令牌不主动删（同一张图可能被别处引用），交给孤儿 GC。
                const blob = await processImageToBlob(file, { skipCompression: true });
                const ref = await putImageBlob(blob);
                setUserBgImage(ref);
                // Save to DB Assets
                await DB.saveAsset('spark_user_bg', ref);
                addToast('背景图已更新', 'success');
            } catch (err) {
                addToast('图片处理失败', 'error');
            }
        }
    };

    const handleSocialAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                // 头像同样只存令牌；这里改的是 socialProfile 内存态，
                // 落库在 saveUserProfileChanges（点「保存资料」时整个 JSON 写回）。
                const blob = await processImageToBlob(file);
                const ref = await putImageBlob(blob);
                setSocialProfile(prev => ({ ...prev, avatar: ref }));
                trackEvent('更换 Spark 头像');
            } catch (err: any) {
                addToast(err.message, 'error');
            }
        }
    };

    const saveUserProfileChanges = async () => {
        localStorage.setItem('spark_user_id', userSparkId);
        // Save Profile to DB Assets（avatar 是 blobref 令牌，二进制在 IndexedDB）
        await DB.saveAsset('spark_social_profile', JSON.stringify(socialProfile));
        setIsEditingId(false);
        addToast('主页资料已保存 (仅在 Spark 生效)', 'success');
    };

    const prependPostsToFeed = (newPosts: SocialPost[], persist = true) => {
        const registered = registerSparkPosts(newPosts);
        const existingIds = new Set(feedRef.current.map(post => post.id));
        const fresh = registered.filter(post => !existingIds.has(post.id));
        const next = prependUniqueSocialPosts(feedRef.current, fresh);
        feedRef.current = next;
        setFeed(next);
        applyTraffic(fresh);
        if (fresh.length) {
            let community = communityRef.current;
            for (const post of fresh) {
                community = appendSparkEvent(community, {
                    id: 'post-created:' + post.id, type: 'post_created',
                    actorAccountId: post.authorId || 'user', postId: post.id, createdAt: post.timestamp,
                });
            }
            writeCommunity(community);
        }
        if (persist) {
            void Promise.all(fresh.map(p => persistPostMutation(() => DB.saveSocialPost(p))))
                .catch(error => addToast('Spark 笔记保存失败，请勿关闭应用：' + (error?.message || error), 'error'));
        }
    };

    const updatePostInFeed = (postId: string, updater: (post: SocialPost) => SocialPost): SocialPost | undefined => {
        const before = feedRef.current.find(post => post.id === postId);
        const result = updateSocialPost(feedRef.current, postId, updater);
        if (!result.post) return undefined;
        const updated = registerSparkPosts([result.post])[0];
        const next = result.feed.map(post => post.id === postId ? updated : post);
        feedRef.current = next;
        setFeed(next);
        setSelectedPost(current => current?.id === postId ? updated : current);
        void persistPostMutation(() => DB.saveSocialPost(updated))
            .catch(error => addToast('Spark 修改保存失败，请重试：' + (error?.message || error), 'error'));
        applyTraffic([updated]);
        if (before) {
            let community = communityRef.current;
            const oldIds = new Set((before.comments || []).map(comment => comment.id));
            const priorComments = new Map((before.comments || []).map(comment => [comment.id, comment]));
            for (const comment of updated.comments) {
                if (!oldIds.has(comment.id)) {
                    community = appendSparkEvent(community, {
                        id: 'comment-created:' + comment.id, type: 'comment_created',
                        actorAccountId: comment.authorId || 'user', targetAccountId: updated.authorId,
                        postId, commentId: comment.id, createdAt: comment.timestamp || Date.now(),
                    });
                } else if (!!priorComments.get(comment.id)?.isLiked !== !!comment.isLiked) {
                    community = appendSparkEvent(community, {
                        id: 'comment-like:' + comment.id + ':' + Date.now() + ':' + Math.random(),
                        type: comment.isLiked ? 'comment_liked' : 'comment_unliked',
                        actorAccountId: 'user', targetAccountId: comment.authorId,
                        postId, commentId: comment.id, createdAt: Date.now(),
                    });
                }
            }
            if (before.isLiked !== updated.isLiked) {
                community = appendSparkEvent(community, {
                    id: 'post-like:' + postId + ':' + Date.now(), type: updated.isLiked ? 'post_liked' : 'post_unliked',
                    actorAccountId: 'user', targetAccountId: updated.authorId, postId, createdAt: Date.now(),
                });
            }
            if (before.isCollected !== updated.isCollected) {
                community = appendSparkEvent(community, {
                    id: 'post-save:' + postId + ':' + Date.now(), type: updated.isCollected ? 'post_collected' : 'post_uncollected',
                    actorAccountId: 'user', targetAccountId: updated.authorId, postId, createdAt: Date.now(),
                });
            }
            if (community !== communityRef.current) writeCommunity(community);
        }
        return updated;
    };

    const removePostFromFeed = async (postId: string): Promise<void> => {
        // Only remove UI and notices after persistence succeeds, so a failed delete is recoverable.
        await persistPostMutation(() => DB.deleteSocialPost(postId));
        deletedPostIdsRef.current.add(postId);
        const next = feedRef.current.filter(p => p.id !== postId);
        feedRef.current = next;
        setFeed(next);
        setSelectedPost(current => current?.id === postId ? null : current);
        setNotices(prev => {
            const remaining = prev.filter(item => item.postId !== postId);
            localStorage.setItem('spark_notifications', JSON.stringify(remaining));
            return remaining;
        });
        sparkEvent('post_deleted', 'user', { postId });
    };

    // --- AI Logic (Updated for Multi-Handle) ---
    const privateChatSnippetsRef = useRef<string[]>([]);
    const publicTextLeaksPrivateChat = (text: string) =>
        containsSparkPrivateQuote(text, privateChatSnippetsRef.current);
    const buildGenerationContext = async (participants: CharacterProfile[]) => {
        const recent = await Promise.all(participants.map(async char =>
            [char.id, await loadCharacterContextMessages(char)] as const));
        const fragments = recent.flatMap(([, messages]) => messages
            .map(message => typeof message.content === 'string' ? message.content.slice(0, 1600) : '')
            .filter(Boolean));
        privateChatSnippetsRef.current = [...new Set([...privateChatSnippetsRef.current, ...fragments])].slice(-300);
        return buildSparkGenerationContext(participants.map(char => ({ ...char, mountedWorldbooks: worldbooks.filter(wb => sparkWorldbookIds.includes(wb.id) && !wb.disable).map(wb => ({ ...wb })) })), userProfile, socialProfile, characterHandles, Object.fromEntries(recent), sparkMemoriesRef.current);
    };

    const buildGenerationMessages = (members: CharacterProfile[], context: string, prompt: string) =>
        buildSparkGenerationRequestMessages(members, userProfile, context, prompt);

    const isFollowing = (handle: string, id?: string): boolean => {
        const account = resolveSparkDMAccount(communityState.accounts, handle, id);
        if (account) return communityState.follows.some(follow => follow.followerId === 'user' && follow.followedId === account.id);
        const sameNames = communityState.accounts.filter(candidate => candidate.type !== 'user' &&
            (candidate.displayName === handle || candidate.aliases.includes(handle)));
        return sameNames.length === 0 && followedHandles.includes(handle);
    };
    const toggleFollow = (handle: string, id?: string) => {
        const post = feedRef.current.find(item => id ? item.authorId === id : item.authorName === handle);
        const existing = resolveSparkDMAccount(communityRef.current.accounts, handle, id);
        if (!existing && communityRef.current.accounts.filter(account =>
            account.type !== 'user' && (account.displayName === handle || account.aliases.includes(handle))).length > 1) {
            addToast('有同名账号，请从对应笔记打开作者主页', 'error');
            return;
        }
        const candidateType: SparkAccountType = existing?.type || post?.authorType || 'stranger';
        const result = ensureSparkAccount(communityRef.current, {
            type: candidateType, id: existing?.id || post?.authorId, displayName: handle,
            ownerCharId: existing?.ownerCharId || post?.authorCharId,
            handleId: existing?.handleId, avatar: existing?.avatar || post?.authorAvatar,
        }, () => 'npc-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        if (result.account.id === 'user') return;
        const follow = toggleSparkFollow(result.state, 'user', result.account.id, Date.now(), 'follow-' + Date.now() + '-' + Math.random());
        writeCommunity(follow.state);
        setFollowedHandles(prev => {
            const next = follow.action === 'follow' ? [...new Set([...prev, handle])] : prev.filter(h => h !== handle);
            localStorage.setItem('spark_followed_handles', JSON.stringify(next));
            return next;
        });
    };

    // Share one validated post-persistence path across characters in a low-cost batch.
    const persistBatchedCharacterPost = (char: CharacterProfile, result: any): boolean => {
        if (!result || typeof result.content !== 'string' || !result.content.trim()) return false;
        if (publicTextLeaksPrivateChat(String(result.title || '') + result.content)) return false;
        const accounts = characterHandles[char.id] || [];
        const requestedName = String(result.authorName || '').trim().slice(0, 30);
        const main = accounts.find(a => a.id === 'default' || a.note === '主账号');
        const matching = accounts.find(a => a.handle === requestedName);
        const isAlt = result.accountType === 'alt';
        const name = matching?.handle || (!isAlt ? (main?.handle || char.socialProfile?.handle || char.name)
            : (requestedName || char.name + '的日常'));
        if (!name || name === socialProfile.name || name === userProfile.name) return false;
        if (characters.some(other => other.id !== char.id &&
            (characterHandles[other.id] || []).some(handle => handle.handle === name))) return false;
        const id = matching?.id || (!isAlt ? main?.id || 'default' :
            'ai-alt-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        if (isAlt && !matching) setCharacterHandles(prev => {
            const existing = prev[char.id] || [];
            if (existing.some(h => h.handle === name)) return prev;
            return { ...prev, [char.id]: [...existing, { id, handle: name, note: 'AI 自建马甲' }] };
        });
        const preparedComments: SocialComment[] = (Array.isArray(result.comments) ? result.comments : [])
            .slice(0, 2).flatMap((draft: any): SocialComment[] => {
                if (!draft || typeof draft.content !== 'string' || !draft.content.trim()) return [];
                const stranger = resolveSparkAuthor({
                    authorName: draft.authorName, charId: null, isCharacter: false,
                }, [], characters, characterHandles, [socialProfile.name, userProfile.name]);
                if (!stranger || stranger.character || publicTextLeaksPrivateChat(draft.content)) return [];
                return [{
                    id: 'char-prefilled-comment-' + Date.now() + '-' + Math.random().toString(36).slice(2),
                    authorName: stranger.name,
                    authorAvatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=' + encodeURIComponent(stranger.name),
                    content: draft.content.trim().slice(0, 400),
                    likes: 0, authorType: 'stranger', isCharacter: false, timestamp: Date.now(),
                }];
            });
        const post: SocialPost = {
            id: 'char-post-' + Date.now() + '-' + Math.random().toString(36).slice(2),
            authorName: name, authorAvatar: getSparkAuthorAvatar(char, name, characterHandles, id),
            title: String(result.title || '随手记录').slice(0, 100),
            content: result.content.trim().slice(0, 2500),
            images: [pickStock(String(result.title || ''), result.content) || '✨'],
            likes: 0, isCollected: false, isLiked: false, comments: uniqueGeneratedSocialComments([], preparedComments),
            sparkInitialCommentsHandled: true, timestamp: Date.now(),
            tags: ['日常'], bgStyle: getRandomStyle().bg, authorType: 'character', authorCharId: char.id,
            authorId: 'character:' + char.id + ':handle:' + id, source: 'ai',
        };
        prependPostsToFeed([post]);
        remember(char.id, post, '自己发布了笔记：' + post.content);
        return true;
    };

    const handleCharPost = async () => {
        const selected = characters.filter(c => postingCharIds.includes(c.id));
        if (!selected.length) { addToast('请先选择角色', 'error'); return; }
        if (!apiConfig.apiKey) { addToast('请配置 API Key', 'error'); return; }
        if (isCharPosting) return;
        setIsCharPosting(true);
        const generation = feedLoadGenerationRef.current;
        try {
            if (selected.length > 1) {
                // Up to eight characters per provider request, versus one call per character.
                // Use PUBLIC profiles and posts; never co-locate multiple private personas.
                let created = 0;
                for (const group of planSparkCharacterBatches(selected)) {
                    if (!mountedRef.current || generation !== feedLoadGenerationRef.current) return;
                    const profiles = group.map(char => ({
                        charId: char.id,
                        name: char.name,
                        handles: (characterHandles[char.id] || []).map(a => a.handle),
                        publicBio: char.socialProfile?.bio || '',
                        publicWriting: feedRef.current.filter(p => p.authorCharId === char.id).slice(0, 2)
                            .map(p => ({ account: p.authorName, example: p.content.slice(0, 120) })),
                    }));
                    const context = '公开资料，用于一次生成多个相互独立的虚拟社交作者。任何私聊、私有世界书及隐藏真实身份不可见：\n'
                        + JSON.stringify(profiles);
                    const prompt = '为上列已选择的 ' + group.length + ' 个 charId 各生成至多一条 Spark 笔记。'
                        + '可以保持沉默，但不能冒用其他 charId、用户账号或别人的网名。'
                        + '作者的网名优先复用自己的公开账号，也可以在合理动机下使用新的匿名马甲。'
                        + '帖子内容自然有个性，严格按各人公开资料与近期公开作品风格，不造假人气，不泄露私密信息。'
                        + '每篇帖子可以附带 0-2 位虚拟陌生网友的简短真实评论，不能冒充角色或用户，不必强行制造互动。'
                        + '只输出一个 JSON 数组：[{"charId":"上方真实ID","accountType":"main或alt",'
                        + '"authorName":"自己的公开网名","title":"标题","content":"正文",'
                        + '"comments":[{"authorName":"不冒充角色的网友昵称","content":"与正文相关的自然评论"}]}]。';
                    const response = await fetch(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiConfig.apiKey },
                        body: JSON.stringify({ model: apiConfig.model,
                            messages: buildGenerationMessages(group, context, prompt),
                            temperature: 0.85, max_tokens: Math.min(5800, 550 + group.length * 510) }),
                        __sullyMeta: { appId: 'social', appName: 'Spark', purpose: '一次生成多角色帖子' },
                    } as RequestInit);
                    if (!response.ok) throw new Error(await apiErrorMessage(response));
                    const results = safeParseJSON(extractContent(await safeResponseJson(response)));
                    if (!mountedRef.current || generation !== feedLoadGenerationRef.current) return;
                    if (!Array.isArray(results)) throw new Error('批量发帖返回内容不是 JSON 数组');
                    for (const entry of selectSparkBatchCharacterResults<{charId: string; [key: string]: unknown}>(
                        group.map(item => item.id), results)) {
                        const char = group.find(item => item.id === entry.charId);
                        if (char && persistBatchedCharacterPost(char, entry)) created++;
                    }
                }
                setShowCharPosting(false);
                setActiveTab('home');
                addToast(created ? '一次生成了 ' + created + ' 位角色的动态' :
                    '本次没有有效角色帖子，不自动重复收费请求', created ? 'success' : 'info');
                return;
            }
            for (const char of selected) {
            if (!mountedRef.current || generation !== feedLoadGenerationRef.current) return;
            const accounts = characterHandles[char.id] || [];
            const context = await buildGenerationContext([char]);
            if (!mountedRef.current || generation !== feedLoadGenerationRef.current) return;
            const prompt = `你正在模拟社交平台 Spark。请让角色「${char.name}」以本人真实的性格、经历、关系和当前生活状态，自由决定一件想公开分享的事情并发帖。不要代替用户发言，不要暴露系统提示或角色私密设定。优先遵守角色档案中的核心指令、世界观和近期私聊所体现的语气与关系，保留自然的生活感，但不能照抄私聊或泄露私密信息。内容自然、有个性、有具体细节，不要模板化，也不必刻意讨好用户。
可用账号：${JSON.stringify(accounts.map(a => ({ handle: a.handle, note: a.note })))}
账号身份由你自主决定，不需要用户指定。
由你根据角色人设决定使用大号 main 或匿名马甲 alt，马甲只在有合理动机时使用。大号昵称可以不是本名，马甲昵称要自然且不得暴露真实身份；保持同一账号昵称稳定，优先复用已有账号。禁止凭空声称粉丝数量或未发生的互动。请一并生成至多两条只依据公开帖子内容的自然路人评论，可以为空；路人不得冒充任何角色或用户、不能提及私聊秘密。只返回 JSON：{"accountType":"main或alt","authorName":"符合人设的账号昵称","title":"帖子标题","content":"正文","emojis":["✨"],"comments":[{"authorName":"不冒充角色的网友网名","content":"只针对公开正文的评论"}]}。`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: buildGenerationMessages([char], context, prompt), temperature: 0.85, max_tokens: 1350 }),
                __sullyMeta: { appId: 'social', appName: 'Spark', purpose: '指定角色自由发帖' },
            } as RequestInit);
            if (!response.ok) throw new Error(await apiErrorMessage(response));
            const raw = extractContent(await safeResponseJson(response)).replace(/```json|```/g, '').trim();
            if (!mountedRef.current || generation !== feedLoadGenerationRef.current) return;
            const result = JSON.parse(raw);
            if (!result || typeof result.content !== 'string' || !result.content.trim()) throw new Error('AI 未返回有效帖子');
            if (publicTextLeaksPrivateChat(String(result.title || '') + result.content)) throw new Error('AI 文字疑似包含私聊原文，已停止公开发布');
            const chosenType = result.accountType === 'alt' ? 'alt' : 'main';
            const proposedName = String(result.authorName || '').trim().slice(0, 30);
            const defaultName = char.socialProfile?.handle || char.name;
            const existing = accounts.find(a => a.handle === proposedName);
            const main = accounts.find(a => a.id === 'default' || a.note === '主账号');
            const chosenName = existing?.handle || (chosenType === 'main' ? (main?.handle || proposedName || defaultName) : (proposedName || char.name + '的日常'));
            const chosenHandleId = existing?.id || (chosenType === 'main' ? (main?.id || 'default') : 'ai-alt-' + Date.now() + '-' + Math.random().toString(36).slice(2));
            if (!existing && chosenType === 'alt') {
                setCharacterHandles(prev => {
                    const current = prev[char.id] || [];
                    if (current.some(a => a.handle === chosenName)) return prev;
                    return { ...prev, [char.id]: [...current, { id: chosenHandleId, handle: chosenName, note: 'AI 自建马甲' }] };
                });
            }
            const handle = { handle: chosenName };
            const preparedComments: SocialComment[] = (Array.isArray(result.comments) ? result.comments : [])
                .slice(0, 2).flatMap((draft: any): SocialComment[] => {
                    if (!draft || typeof draft.content !== 'string' || !draft.content.trim() ||
                        publicTextLeaksPrivateChat(draft.content)) return [];
                    const speaker = resolveSparkAuthor({
                        authorName: draft.authorName, charId: null, isCharacter: false,
                    }, [], characters, characterHandles, [socialProfile.name, userProfile.name]);
                    if (!speaker || speaker.character) return [];
                    return [{
                        id: 'single-char-prefill-' + Date.now() + '-' + Math.random().toString(36).slice(2),
                        authorName: speaker.name,
                        authorAvatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=' + encodeURIComponent(speaker.name),
                        content: draft.content.trim().slice(0, 400),
                        likes: 0, authorType: 'stranger', isCharacter: false, timestamp: Date.now(),
                    }];
                });
            const post: SocialPost = {
                id: `char-post-${Date.now()}-${Math.random()}`,
                authorName: handle?.handle || char.name, authorAvatar: getSparkAuthorAvatar(char, chosenName, characterHandles, chosenHandleId),
                title: String(result.title || '随手记录').slice(0, 100),
                content: result.content,
                images: [pickStock(String(result.title || ''), result.content) || '✨'],
                likes: 0, isCollected: false, isLiked: false,
                comments: uniqueGeneratedSocialComments([], preparedComments),
                sparkInitialCommentsHandled: true, timestamp: Date.now(),
                tags: ['日常'], bgStyle: getRandomStyle().bg, authorType: 'character', authorCharId: char.id,
                authorId: 'character:' + char.id + ':handle:' + chosenHandleId, source: 'ai',
            };
            prependPostsToFeed([post]);
            remember(char.id, post, '自己发布了笔记：' + post.content);
            }
            setShowCharPosting(false);
            setActiveTab('home');
            addToast(`已让 ${selected.length} 位角色发布动态`, 'success');
        } catch (error: any) {
            addToast('角色发帖失败：' + (error?.message || '未知错误'), 'error');
        } finally { setIsCharPosting(false); }
    };

    const handleRefresh = async () => {

        if (!apiConfig.apiKey) { addToast('请配置 API Key', 'error'); return; }
        if (refreshRequestRef.current) return;
        const controller = new AbortController();
        refreshRequestRef.current = controller;
        setIsRefreshing(true);
        trackEvent('刷新 Spark 推荐流');
        try {
            const shuffledChars = [...characters].sort(() => 0.5 - Math.random());
            const selectedChars = shuffledChars.slice(0, Math.min(3, characters.length));
            
            const context = await buildGenerationContext(selectedChars);
            if (controller.signal.aborted) return;

            // Gently age interests on each refresh so older tastes gradually make room for new ones.
            const aged = Object.fromEntries(Object.entries(interestRef.current).map(([topic, score]) => [topic, Math.round(score * 0.94 * 100) / 100]).filter(([, score]) => Number(score) >= 0.2)) as Record<string, number>;
            interestRef.current = aged;
            setInterestScores(aged);
            localStorage.setItem('spark_interest_scores', JSON.stringify(aged));
            const interests = Object.entries(aged).filter(([, score]) => score > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([topic, score]) => topic + '(' + Math.round(score) + ')').join('、');
            const prompt = `### 任务: 模拟社交APP "Spark" 的推荐流
【隐形兴趣推荐】根据用户近期发帖、点赞、评论和点开阅读积累的兴趣权重，适当提高相关内容比例：${interests || '暂无明显偏好'}。例如经常看绘画就多推荐绘画，常互动帅哥内容就多推荐相关话题；保留约三分之一探索内容，不要所有帖子都同一主题，也不要向用户或角色揭露兴趣画像。
你需要一次生成 6-8 条新的社交媒体帖子，并为每条附带 0-2 条自然评论。评论属于同一次请求的返回结果，不允许另外请求评论；可以没人评论，不能机械凑数。

### 🎭 内容构成 (混合模式)
1. **角色发帖 (30%)**: 
   - 选中的角色: ${selectedChars.map(c => c.name).join(', ')}
   - **关键规则**: 每个角色有多个马甲(账号)。请根据内容需要，选择最合适的账号身份发帖。
   - 例如：如果是吐槽，可能用小号；如果是发美照，用大号。请务必使用 **Configured Handle (网名)**。
   - **内容方向**: 公开发言，生活日常、吐槽、或者暗戳戳的记录。

2. **路人/网友发帖 (70%)**: 
   - 模拟真实的互联网生态：吃瓜群众、技术宅、美妆博主、情感树洞。

### 🚫 绝对禁令
1. **禁止扮演用户**: 用户的网名是 "${socialProfile.name}"。绝对禁止生成 \`authorName\` 等于或近似 "${socialProfile.name}" 的帖子（无论是角色帖还是路人帖）。如果你想用类似的名字，请改成完全不同的网名。
2. **路人不得冒用身份**: 路人的 \`authorName\` 必须是全新的网名，绝对不能与上方【角色身份表】中列出的任何【网名】重合。
3. **禁止上帝视角**。

### 输出格式 (JSON Array)
[
  {
    "isCharacter": true/false,
    "charId": "如果是角色填ID, 否则null", 
    "authorName": "必须填身份表中定义的【网名】",
    "title": "简短吸睛的标题",
    "content": "正文内容...",
    "emojis": ["🎈", "✨"],
    "comments": [
      {"author": "仅真实网友或已授权角色的公开网名", "charId": "对应角色ID或null", "content": "与正文有关的简短评论"}
    ]
  },
  ...
]`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: buildGenerationMessages(selectedChars, context, prompt), temperature: 0.8, max_tokens: 4800 }),
                signal: controller.signal,
                __sullyMeta: { appId: 'social', appName: 'Spark', purpose: '刷新推荐流' },
            } as RequestInit);
            if (!response.ok) throw new Error(await apiErrorMessage(response));
            const data = await safeResponseJson(response);
            if (controller.signal.aborted) return;
            const json = safeParseJSON(extractContent(data));
            if (!Array.isArray(json)) throw new Error('Parsed data is not an array');
            
            const newPosts: SocialPost[] = json
                .flatMap((item: any) => {
                const author = resolveSparkAuthor(item, selectedChars, characters, characterHandles, [socialProfile.name, userProfile.name]);
                if (!author || typeof item.content !== 'string' || !item.content.trim() ||
                    isSparkMuted(getSparkPublicAuthorId(author.name, author.character?.id)) ||
                    publicTextLeaksPrivateChat(String(item.title || '') + item.content)) return [];
                item = { ...item, authorName: author.name };
                let avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${item.authorName}`;
                const matchedChar = author.character;
                const avatarPool = stockImages.filter(img => img.category === 'avatar');
                const stockAvatar = avatarPool.length ? avatarPool[Array.from(String(item.authorName)).reduce((n, c) => n + c.charCodeAt(0), 0) % avatarPool.length] : undefined;
                if (matchedChar) avatar = getSparkAuthorAvatar(matchedChar, item.authorName, characterHandles);
                const isCharacterPost = !!matchedChar;
                if (!isCharacterPost) {
                    avatar = stockAvatar?.url || `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(item.authorName)}`;
                }
                // Normalize emoji content. AI usually returns real emoji chars; fall back to a ✨ char (not codepoint) for safety.
                // These comments come from the SAME refresh call. Seed them on
                // the post now, so opening each note does not bill another AI call.
                const prefilled = (Array.isArray(item.comments) ? item.comments : []).slice(0, 2)
                    .flatMap((draft: any): SocialComment[] => {
                        const speaker = resolveSparkAuthor(draft, selectedChars, characters,
                            characterHandles, [socialProfile.name, userProfile.name]);
                        if (!speaker || typeof draft.content !== 'string' || !draft.content.trim() ||
                            publicTextLeaksPrivateChat(draft.content) ||
                            isSparkMuted(getSparkPublicAuthorId(speaker.name, speaker.character?.id)) ||
                            (speaker.character && matchedChar && speaker.character.id === matchedChar.id)) return [];
                        return [{
                            id: 'prefilled-comment-' + Date.now() + '-' + Math.random().toString(36).slice(2),
                            authorName: speaker.name,
                            authorAvatar: speaker.character
                                ? getSparkAuthorAvatar(speaker.character, speaker.name, characterHandles)
                                : 'https://api.dicebear.com/7.x/notionists/svg?seed=' + encodeURIComponent(speaker.name),
                            content: draft.content.trim().slice(0, 400),
                            likes: 0, timestamp: Date.now(), authorType: speaker.character ? 'character' : 'stranger',
                            isCharacter: !!speaker.character, authorCharId: speaker.character?.id,
                        }];
                    });
                const rawEmojis = Array.isArray(item.emojis) && item.emojis.length > 0 ? item.emojis : ['✨'];
                const images = [pickStock(String(item.title || ''), String(item.content || '')) || '✨'];
                return [{
                    id: `post-${Date.now()}-${Math.random()}`,
                    authorName: item.authorName || 'Unknown',
                    authorAvatar: avatar,
                    title: typeof item.title === 'string' ? item.title : '无标题',
                    content: item.content || '...',
                    images,
                    likes: 0,
                    isCollected: false,
                    isLiked: false,
                    comments: uniqueGeneratedSocialComments([], prefilled),
                    sparkInitialCommentsHandled: true,
                    timestamp: Date.now(),
                    tags: ['Life', 'Vlog'],
                    bgStyle: getRandomStyle().bg,
                    authorType: isCharacterPost ? 'character' as const : 'stranger' as const,
                    authorCharId: matchedChar?.id,
                    source: 'ai' as const,
                }];
            });
            if (!newPosts.length) throw new Error('模型返回的作者身份不匹配，未添加帖子');
            prependPostsToFeed(newPosts);
            for (const post of newPosts) remember(post.authorCharId, post, '自己发布了笔记：' + post.content);
            addToast('首页已刷新: 冲浪模式开启', 'success');
        } catch (e: any) {
            if (e?.name !== 'AbortError') addToast('刷新失败: ' + e.message, 'error');
        } finally {
            if (refreshRequestRef.current === controller) {
                refreshRequestRef.current = null;
                if (mountedRef.current) setIsRefreshing(false);
            }
        }
    };


    // Opt-in and strictly metered: runs only while Spark is mounted, never in the background.
    const runSparkAutonomyTick = async () => {
        if (!mountedRef.current || !communityRef.current.autonomy.enabled || !apiConfig.apiKey) return;
        // Never spend an autonomous call while an explicitly requested AI task is
        // queued or running; the next eligible tick can batch community actions.
        if (autonomyRequestRef.current || refreshRequestRef.current || commentRequestRef.current ||
            replyRequestRef.current || dmProcessingRef.current || dmQueueRef.current.length ||
            publishingRef.current || isCharPosting) return;
        const reservation = reserveSparkTrafficRun(communityRef.current, Date.now());
        if (!reservation.allowed) return;
        // Reserve before the API call: even a timeout can consume the provider's quota.
        writeCommunity(reservation.state);
        const controller = new AbortController();
        autonomyRequestRef.current = controller;
        const generation = feedLoadGenerationRef.current;
        setIsAutonomyBusy(true);
        try {
            const recentlyActive = new Set(feedRef.current.slice(0, 15).map(post => post.authorCharId).filter(Boolean));
            const allowedChars = characters.filter(char => postingCharIds.includes(char.id));
            const activeChars = allowedChars.filter(char => recentlyActive.has(char.id));
            const participants = [...activeChars, ...allowedChars.filter(char => !recentlyActive.has(char.id))].slice(0, 2);
            const context = participants.length ? await buildGenerationContext(participants) : '当前只有稳定的虚拟陌生网友参与 Spark 社区。';
            if (controller.signal.aborted || !mountedRef.current || generation !== feedLoadGenerationRef.current) return;
            const publicPosts = feedRef.current.filter(post =>
                !communityRef.current.mutedAccountIds.includes(post.authorId || '') &&
                !communityRef.current.hiddenPostIds.includes(post.id) &&
                !hiddenPostIds.includes(post.id)
            ).slice(0, 12).map(post => ({
                id: post.id, title: post.title, content: post.content.slice(0, 280),
                authorName: post.authorName, tags: post.tags,
                comments: post.comments.slice(-3).map(comment => ({ id: comment.id, author: comment.authorName, content: comment.content.slice(0, 120) })),
            }));
            const publicAccounts = communityRef.current.accounts.filter(account => account.id !== 'user' &&
                !communityRef.current.mutedAccountIds.includes(account.id))
                .slice(-15).map(account => ({ id: account.id, handle: account.displayName, interests: account.interests }));
            const existingFollows = communityRef.current.follows.slice(-20).map(f => ({ from: f.followerId, to: f.followedId }));
            const visiblePostIds = new Set(feedRef.current.map(item => item.id));
            const previousEvents = communityRef.current.events
                .filter(event => !event.postId || visiblePostIds.has(event.postId))
                .slice(-12)
                .map(event => ({
                    kind: event.type,
                    actor: communityRef.current.accounts.find(a => a.id === event.actorAccountId)?.displayName || '未知网友',
                    target: communityRef.current.accounts.find(a => a.id === event.targetAccountId)?.displayName || undefined,
                    postId: event.postId, createdAt: event.createdAt,
                }));
            const prompt = [
                '你安排 SullyOS 内 Spark 虚拟社区的少量自主活动；绝不能访问或控制真实小红书。',
                '本轮最多返回 2 个有因果的社区事件，返回 [] 表示无人活动，可以沉默。kind 仅限 post、comment、like、follow、unfollow。',
                'post: {kind:"post",authorName:"公开网名",charId:"角色ID或null",title:"标题",content:"正文",tags:["话题"]}',
                'comment: {kind:"comment",postId:"已存在帖子ID",authorName:"公开网名",charId:"角色ID或null",content:"评论"}',
                'like: {kind:"like",postId:"已存在帖子ID",authorName:"公开网名",charId:"角色ID或null"}',
                'follow/unfollow: {kind:"follow",targetAccountId:"user或已列出的账号ID",authorName:"公开网名",charId:"角色ID或null"}，取关时 kind=unfollow；必须先有关注才能取关。',
                '绝不虚构点赞、关注或活动目标；请结合公开帖子与角色喜好判断，不能每次都关注用户。',
                '角色必须使用已配置的网名与角色 ID；普通网友可复用有历史的账号，不必围绕用户发言。',
                '继续已有话题时请引用已有真实帖子 ID；没有因果线索则分享独立日常，不凭空捏造过去的社交事件。',
                '绝不代替用户发言，不公开任何私聊内容、世界书秘密、后台账号归属或马甲真身；角色之间记忆不得串台。',
                '只有包含 JSON 数组的回复才有效；不要虚构点赞数、粉丝数、浏览数。',
                '当前真实帖子: ' + JSON.stringify(publicPosts),
                '已知稳定账号: ' + JSON.stringify(publicAccounts),
                '当前真实关注关系: ' + JSON.stringify(existingFollows),
                '最近社区事件: ' + JSON.stringify(previousEvents),
            ].join('\n');
            const response = await fetch(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiConfig.apiKey },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: buildGenerationMessages(participants, context, prompt),
                    temperature: 0.75,
                }),
                signal: controller.signal,
                __sullyMeta: { appId: 'social', appName: 'Spark', purpose: '用户开启的社区自主活动' },
            } as RequestInit);
            if (!response.ok) throw new Error(await apiErrorMessage(response));
            const result = safeParseJSON(extractContent(await safeResponseJson(response)));
            if (!Array.isArray(result)) throw new Error('社区活动返回格式无效');
            let created = 0;
            for (const item of result.slice(0, 2)) {
                if (controller.signal.aborted || !mountedRef.current || generation !== feedLoadGenerationRef.current || !communityRef.current.autonomy.enabled) return;
                if (!item || !['post', 'comment', 'like', 'follow', 'unfollow'].includes(item.kind)) continue;
                const needsContent = item.kind === 'post' || item.kind === 'comment';
                if (needsContent && typeof item.content !== 'string') continue;
                const content = typeof item.content === 'string' ? item.content.trim().slice(0, 1000) : '';
                if (needsContent && (!content || publicTextLeaksPrivateChat(content + (typeof item.title === 'string' ? item.title : '')))) continue;
                const author = resolveSparkAuthor(item, participants, characters, characterHandles, [socialProfile.name, userProfile.name]);
                if (!author) continue;
                const actorId = getSparkPublicAuthorId(author.name, author.character?.id);
                if (isSparkMuted(actorId)) continue;
                const avatar = author.character ? getSparkAuthorAvatar(author.character, author.name, characterHandles) : 'https://api.dicebear.com/7.x/notionists/svg?seed=' + encodeURIComponent(author.name);
                const authorType = author.character ? 'character' as const : 'stranger' as const;
                if (item.kind === 'like' || item.kind === 'follow' || item.kind === 'unfollow') {
                    const targetPost = item.kind === 'like' ? feedRef.current.find(p => p.id === item.postId) : undefined;
                    if (item.kind === 'like' && !targetPost) continue;
                    const targetId = item.kind === 'like' ? targetPost?.authorId : item.targetAccountId;
                    if (!targetId || typeof targetId !== 'string') continue;
                    if (item.kind !== 'like' && !communityRef.current.accounts.some(a => a.id === targetId)) continue;
                    if (communityRef.current.mutedAccountIds.includes(targetId)) continue;
                    const savedHandles = author.character ? characterHandles[author.character.id] || [] : [];
                    const selectedHandle = savedHandles.find(h => h.handle === author.name);
                    const accountResult = ensureSparkAccount(communityRef.current, {
                        type: authorType, ownerCharId: author.character?.id, handleId: selectedHandle?.id,
                        displayName: author.name, avatar,
                    }, () => 'npc-' + Date.now() + '-' + Math.random().toString(36).slice(2));
                    const account = accountResult.account;
                    if (communityRef.current.mutedAccountIds.includes(account.id) || account.id === targetId) continue;
                    if (accountResult.state !== communityRef.current) writeCommunity(accountResult.state);
                    if (item.kind === 'like' && targetPost) {
                        let effect = applySparkNpcLike(communityRef.current, targetPost, account.id, Date.now());
                        if (!effect.changed) continue;
                        const updated = updatePostInFeed(targetPost.id, current => {
                            effect = applySparkNpcLike(communityRef.current, current, account.id, Date.now());
                            return effect.changed ? effect.post : current;
                        });
                        if (!updated || !effect.changed) continue;
                        writeCommunity(effect.state);
                        if (targetPost.authorId === 'user') addNotices([{
                            id: 'npc-like:' + targetPost.id + ':' + account.id,
                            kind: 'likes', actor: author.name, avatar,
                            content: '赞了你的笔记《' + targetPost.title + '》',
                            postId: targetPost.id, time: Date.now(), read: false,
                        }]);
                    } else {
                        const action = item.kind === 'unfollow' ? 'unfollow' : 'follow';
                        const changed = applySparkNpcFollow(communityRef.current, account.id, targetId, action, Date.now());
                        if (!changed.changed) continue;
                        writeCommunity(changed.state);
                        if (action === 'follow' && targetId === 'user') addNotices([{
                            id: 'npc-follow:' + account.id + ':user:' + Date.now(), kind: 'follows',
                            actor: author.name, avatar, content: '关注了你',
                            time: Date.now(), read: false,
                        }]);
                    }
                    created++;
                    continue;
                }
                if (item.kind === 'post') {
                    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 100) : '';
                    if (!title) continue;
                    const tags = Array.isArray(item.tags)
                        ? item.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
                            .map((tag: string) => tag.trim().slice(0, 24)).filter(Boolean).slice(0, 3) : [];
                    const post: SocialPost = {
                        id: 'autonomy-post-' + Date.now() + '-' + Math.random().toString(36).slice(2),
                        authorName: author.name, authorAvatar: avatar, authorType, authorCharId: author.character?.id,
                        title, content, tags: tags.length ? tags : ['日常'], images: [pickStock(title, content) || '✨'],
                        likes: 0, comments: [], isLiked: false, isCollected: false, timestamp: Date.now(),
                        bgStyle: getRandomStyle().bg, source: 'ai',
                    };
                    prependPostsToFeed([post]);
                    remember(author.character?.id, post, '自己在 Spark 发布了笔记：' + content);
                    created++;
                } else {
                    const post = feedRef.current.find(saved => saved.id === item.postId);
                    if (!post || isSparkMuted(post.authorId)) continue;
                    const comment: SocialComment = {
                        id: 'autonomy-comment-' + Date.now() + '-' + Math.random().toString(36).slice(2),
                        authorName: author.name, authorAvatar: avatar, authorType, authorCharId: author.character?.id,
                        isCharacter: !!author.character, content, likes: 0, timestamp: Date.now(),
                    };
                    if (!uniqueGeneratedSocialComments(post.comments || [], [comment]).length) continue;
                    const changed = updatePostInFeed(post.id, current => ({
                        ...current, comments: mergeSocialComments(current.comments || [], [comment]),
                    }));
                    if (!changed) continue;
                    remember(author.character?.id, post, '自己在 Spark 评论了《' + post.title + '》：' + content);
                    if (post.authorType === 'user') addNotices([{
                        id: 'autonomy-notice:' + comment.id, kind: 'comments', actor: author.name,
                        avatar, content, postId: post.id, time: Date.now(), read: false,
                    }]);
                    created++;
                }
            }
            if (created) addToast('Spark 社区有 ' + created + ' 条新动态', 'info');
        } catch (error: any) {
            if (error?.name !== 'AbortError' && mountedRef.current) addToast('社区自主活动失败：' + (error?.message || error), 'error');
        } finally {
            if (autonomyRequestRef.current === controller) {
                autonomyRequestRef.current = null;
                if (mountedRef.current) setIsAutonomyBusy(false);
            }
        }
    };
    autonomyTickRef.current = runSparkAutonomyTick;

    useEffect(() => {
        if (!communityState.autonomy.enabled || !apiConfig.apiKey) return;
        let active = true;
        const tick = () => { if (active) void autonomyTickRef.current(); };
        tick();
        const interval = window.setInterval(tick, 5 * 60 * 1000);
        return () => {
            active = false;
            window.clearInterval(interval);
            autonomyRequestRef.current?.abort();
        };
    }, [communityState.autonomy.enabled, communityState.autonomy.maxCallsPerDay,
        communityState.autonomy.minIntervalHours, apiConfig.apiKey, apiConfig.model, apiConfig.baseUrl]);

    const generateComments = async (post: SocialPost, inboxCount = 0) => {

        if (!post || !apiConfig.apiKey) return;
        const livePost = feedRef.current.find(item => item.id === post.id);
        if (!livePost || !needsSparkInitialCommentCall(livePost)) return;
        if (commentRequestRef.current?.postId === post.id) return;
        commentRequestRef.current?.controller.abort();
        const controller = new AbortController();
        commentRequestRef.current = { postId: post.id, controller };
        post = livePost;
        setLoadingComments(true);
        try {
            const shuffledChars = [...characters].sort(() => 0.5 - Math.random());
            const selectedChars = selectSparkParticipants(post, shuffledChars, characterHandles);
            const context = await buildGenerationContext(selectedChars);
            if (controller.signal.aborted) return;
            
            let authorType = "Stranger";
            if (post.authorType === 'user') authorType = "User";
            else if (post.authorType === 'character' && post.authorCharId) {
                const c = characters.find(ch => ch.id === post.authorCharId);
                if (c) authorType = `Character "${c.name}"`;
            } else if (!post.authorType) {
                // Legacy fallback for posts saved before authorType was tracked.
                if (post.authorName === socialProfile.name) authorType = "User";
                else {
                    const c = characters.find(ch => {
                        const handles = characterHandles[ch.id] || [];
                        return handles.some(h => h.handle === post.authorName);
                    });
                    if (c) authorType = `Character "${c.name}"`;
                }
            }

            const prompt = `### 任务: 模拟社交APP评论区
**帖子来源**: "Spark" 社区
**楼主**: "${post.authorName}" (${authorType})
**帖子标题**: "${post.title}"
**帖子正文**:
"""
${post.content || '(楼主没写正文)'}
"""

请基于上面的【标题 + 正文】生成 4-6 条评论，评论要切实回应正文里提到的内容，不要只对着标题空泛地说。混合使用 **选定角色** 和 **随机路人**。\n${naturalComments ? '角色评论必须符合各自的人设、关系与说话习惯；允许不同意见、冷淡、玩笑和沉默，禁止千篇一律的夸赞或无根据的亲密。优先依据上文角色核心指令与近期私聊中呈现的说话节奏、用词和互动距离，但不能照抄私聊或泄露私密内容。不得让楼主用其他马甲评论自己的帖子。' : ''}
角色评论时，请选择一个符合语境的马甲身份。

### 禁令
- **绝对禁止** 生成 \`author\` 等于或近似 "${socialProfile.name}" (用户) 的评论。
- 路人评论的 \`author\` 必须是全新的网名，绝对不能与上方【角色身份库】中列出的任何马甲网名重合。

### 输出格式
${inboxCount > 0 ? '若还要生成来信，最终只输出一个带 comments、incomingDMs 两字段的 JSON 对象。' : '只输出一个 JSON 评论数组。'}
评论数组项的格式如下：
[
  { "author": "网名 (Handle) 或 路人昵称", "charId": "角色ID或null", "content": "评论内容..." }
]`;
            const combinedPrompt = inboxCount > 0 ? prompt + `
### 追加同一次请求中的第二个任务：首次陌生人私信
仅根据用户公开帖子内容，生成至多 ${inboxCount} 位虚拟陌生网友可能主动发来的第一句话；人数不足可返回 []，禁止强制凑数。
只输出一个 JSON 对象，形状：{"comments":[按上方格式的评论],"incomingDMs":[{"name":"不同且不冒充用户或角色的网名","persona":"稳定公开性格和说话风格","message":"针对该帖的自然私信"}]}。
所有信息均须来自帖子公开内容，不能引用任何私聊、世界书或后台马甲身份。
` : prompt;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: buildGenerationMessages(selectedChars, context, combinedPrompt), temperature: 0.8, max_tokens: 2200 }),
                signal: controller.signal,
                __sullyMeta: { appId: 'social', appName: 'Spark', purpose: inboxCount ? '发帖后一次生成评论和首批私信' : '生成帖子评论' },
            } as RequestInit);
            if (!response.ok) throw new Error(await apiErrorMessage(response));
            const data = await safeResponseJson(response);
            if (controller.signal.aborted) return;
            const json = safeParseJSON(extractContent(data));
            const combinedResult = parseSparkPostPublishBatch(json);
            const commentsJson = combinedResult.comments;
            // Saving one AI result into multiple local workflows must not trigger another call.
            if (inboxCount > 0 && combinedResult.incomingDMs.length) {
                acceptGeneratedIncomingDMs(post, combinedResult.incomingDMs, inboxCount, feedLoadGenerationRef.current);
            }
            // A completed paid attempt is final even when the model returns no valid
            // commenters: reopening the same post must never silently bill again.
            if (!controller.signal.aborted) updatePostInFeed(post.id, current => ({
                ...current, sparkInitialCommentsHandled: true,
            }));
            if (commentsJson.length) {
                const comments: SocialComment[] = commentsJson
                    .flatMap((c: any) => {
                        const author = resolveSparkAuthor(c, selectedChars, characters, characterHandles, [socialProfile.name, userProfile.name]);
                        if (!author || typeof c.content !== 'string' || !c.content.trim() ||
                            isSparkMuted(getSparkPublicAuthorId(author.name, author.character?.id)) ||
                            publicTextLeaksPrivateChat(c.content)) return [];
                        const authorName = author.name;
                        let avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${authorName}`;
                        const char = author.character;
                        if (char) avatar = getSparkAuthorAvatar(char, authorName, characterHandles);
                        return [{
                            id: `cmt-${Math.random()}`,
                            authorName: authorName,
                            authorAvatar: avatar,
                            content: c.content || '...',
                            likes: 0,
                            isCharacter: !!char,
                            authorType: char ? 'character' : 'stranger',
                            authorCharId: char?.id,
                        } as SocialComment];
                    });
                // Repeat speakers are allowed; only replayed text is deduplicated.
                const uniqueComments = uniqueGeneratedSocialComments(feedRef.current.find(item => item.id === post.id)?.comments || [], comments);
                if (!uniqueComments.length) return;
                const updated = updatePostInFeed(post.id, current => ({
                    ...current,
                    comments: mergeSocialComments(current.comments || [], uniqueComments),
                }));
                if (!updated) return; // The user may have deleted or cleared the post meanwhile.
                if (post.authorType === 'user') addNotices(uniqueComments.filter(comment => comment.authorType !== 'user').map(comment => ({
                    id: 'comment:' + comment.id, kind: 'comments' as const, actor: comment.authorName,
                    avatar: comment.authorAvatar, content: comment.content, postId: post.id, time: Date.now(), read: false,
                })));
            }
        } catch (e: any) {
            if (e?.name !== 'AbortError') addToast(`评论加载失败: ${e?.message || e}`, 'error');
        } finally {
            if (commentRequestRef.current?.controller === controller) {
                commentRequestRef.current = null;
                if (mountedRef.current) setLoadingComments(false);
            }
        }
    };

    const generateRepliesToUser = (post: SocialPost, userContent: string, parentCommentId?: string) => {
        if (!apiConfig.apiKey || !parentCommentId || !mountedRef.current) return;
        replyQueueRef.current.push({ post, content: userContent, parentCommentId });
        if (replyRequestRef.current) return;
        if (replyBatchTimerRef.current !== null) window.clearTimeout(replyBatchTimerRef.current);
        replyBatchTimerRef.current = window.setTimeout(() => {
            replyBatchTimerRef.current = null;
            void runSparkReplyBatch();
        }, 1100);
    };
    const runSparkReplyBatch = async () => {
        if (!apiConfig.apiKey || replyRequestRef.current || !replyQueueRef.current.length || !mountedRef.current) return;
        const batch = takeSparkCommentReplyBatch(replyQueueRef.current);
        replyQueueRef.current = batch.remaining;
        const postId = batch.jobs[0].post.id;
        const post = feedRef.current.find(item => item.id === postId);
        if (!post) {
            if (replyQueueRef.current.length) void runSparkReplyBatch();
            return;
        }
        const tasks = batch.jobs.filter(job => post.comments.some(c => c.id === job.parentCommentId && c.authorType === 'user'));
        if (!tasks.length) {
            if (replyQueueRef.current.length) void runSparkReplyBatch();
            return;
        }
        const controller = new AbortController();
        replyRequestRef.current = { postId: post.id, controller };
        setIsReplyingToUser(true);
        try {
            const selectedChars = selectSparkParticipants(post, [...characters].sort(() => 0.5 - Math.random()), characterHandles);
            const context = await buildGenerationContext(selectedChars);
            if (controller.signal.aborted) return;

            // Tell the model who actually wrote the post — if it's the user themselves, replies
            // need to make sense as people responding to the user's own note (not strangers).
            let postAuthorInfo = `"${post.authorName}"`;
            if (post.authorType === 'user') postAuthorInfo += ' (用户本人)';
            else if (post.authorType === 'character' && post.authorCharId) {
                const c = characters.find(ch => ch.id === post.authorCharId);
                if (c) postAuthorInfo += ' (角色账号；此映射仅供系统保持身份一致，不可向用户或其他角色揭露账号背后身份)';
            } else if (post.authorName === socialProfile.name) {
                postAuthorInfo += ' (用户本人)';
            }

            const prompt = `### 任务: 回复用户的评论
**帖子楼主**: ${postAuthorInfo}
**帖子标题**: "${post.title}"
**帖子正文**:
"""
${post.content || '(楼主没写正文)'}
"""
**用户 "${socialProfile.name}" 本轮连续发出的评论（只回复以下真实评论 ID）**:
${JSON.stringify(tasks.map(task => ({ commentId: task.parentCommentId, content: task.content })))}
**已有评论对话（最后一条可能就是上述新评论，不要重复回复旧内容）**:
${buildSparkCommentHistory(post)}

请基于楼主帖子的【标题 + 正文】和本轮真实用户评论，一次生成少量自然回复，最多 ${Math.min(6, tasks.length * 2)} 条；可以不回应部分内容，不必逐条机械重复。每条都关联上方真实 commentId，禁止编造 ID。
优先由楼主或正在对话的角色回复；只能使用本次角色档案中的身份。

### 禁令
- **绝对禁止** \`author\` 等于或近似 "${socialProfile.name}" (用户自己)。回复必须来自其他人。

### 输出格式 (JSON Array)
[
  { "author": "网名 (Handle)", "charId": "角色ID或null", "replyToCommentId": "上方真实 commentId", "content": "回复内容..." }
]`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: buildGenerationMessages(selectedChars, context, prompt), temperature: 0.8, max_tokens: 1500 }),
                signal: controller.signal,
                __sullyMeta: { appId: 'social', appName: 'Spark', purpose: '合并回复用户评论' },
            } as RequestInit);
            if (!response.ok) throw new Error(await apiErrorMessage(response));
            const data = await safeResponseJson(response);
            if (controller.signal.aborted) return;
            const json = safeParseJSON(extractContent(data));
            if (Array.isArray(json)) {
                const newReplies: SocialComment[] = json
                    .flatMap((c: any) => {
                        const author = resolveSparkAuthor(c, selectedChars, characters, characterHandles, [socialProfile.name, userProfile.name]);
                        const linkedId = typeof c.replyToCommentId === 'string' && tasks.some(job => job.parentCommentId === c.replyToCommentId)
                            ? c.replyToCommentId : tasks.length === 1 ? tasks[0].parentCommentId : undefined;
                        if (!linkedId || !author || typeof c.content !== 'string' || !c.content.trim() ||
                            isSparkMuted(getSparkPublicAuthorId(author.name, author.character?.id)) ||
                            publicTextLeaksPrivateChat(c.content)) return [];
                        const authorName = author.name;
                        let avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${authorName}`;
                        const char = author.character;
                        if (char) avatar = getSparkAuthorAvatar(char, authorName, characterHandles);
                        return [{
                            id: `cmt-reply-${Date.now()}-${Math.random()}`,
                            authorName: authorName,
                            authorAvatar: avatar,
                            content: c.content.trim(),
                            parentCommentId: linkedId,
                            replyToAuthorName: socialProfile.name,
                            timestamp: Date.now(),
                            likes: 0,
                            isCharacter: !!char,
                            authorType: char ? 'character' : 'stranger',
                            authorCharId: char?.id,
                        } as SocialComment];
                    });
                const publicReplies = uniqueGeneratedSocialComments(feedRef.current.find(item => item.id === post.id)?.comments || [], newReplies);
                if (!publicReplies.length) return;
                if (publicReplies.length > 0) {
                    const updated = updatePostInFeed(post.id, current => ({
                        ...current,
                        comments: mergeSocialComments(current.comments || [], publicReplies),
                    }));
                    if (!updated) return;
                    addNotices(publicReplies.map(reply => ({
                        id: 'reply:' + reply.id, kind: 'comments' as const, actor: reply.authorName,
                        avatar: reply.authorAvatar, content: reply.content, postId: post.id, time: Date.now(), read: false,
                    })));
                    for (const reply of publicReplies) {
                        remember(reply.authorCharId, post, '自己回复了 User：' + reply.content);
                        if (post.authorCharId && post.authorCharId !== reply.authorCharId) remember(post.authorCharId, post, reply.authorName + ' 回复了 User：' + reply.content);
                    }
                    addToast(`收到 ${publicReplies.length} 条新回复`, 'info');
                }
            }
        } catch (e: any) {
            if (e?.name !== 'AbortError') addToast(`回复生成失败: ${e?.message || e}`, 'error');
        } finally {
            if (replyRequestRef.current?.controller === controller) {
                replyRequestRef.current = null;
                if (mountedRef.current) setIsReplyingToUser(false);
                if (replyQueueRef.current.length && mountedRef.current) void runSparkReplyBatch();
            }
        }
    };

    const handleShare = async (targetId: string, isGroup: boolean) => {
        if (!selectedPost) return;
        try {
            await DB.saveMessage({ charId: isGroup ? 'user' : targetId, groupId: isGroup ? targetId : undefined, role: 'user', type: 'social_card', content: '[分享帖子]', metadata: { post: selectedPost } });
            if (!isGroup) remember(targetId, selectedPost, 'User 分享这篇笔记到私聊');
            setShowShareModal(false);
            addToast('分享成功', 'success');
            trackEvent('分享帖子到聊天');
        } catch (e) { addToast('分享失败', 'error'); }
    };

    // A post-publish request already generated BOTH comments and first incoming DMs.
    // Process the inbox section locally: never charge for a separate API call.
    const acceptGeneratedIncomingDMs = (post: SocialPost, parsed: unknown[], count: number, generation: number) => {
        if (!Array.isArray(parsed) || !mountedRef.current ||
            feedLoadGenerationRef.current !== generation ||
            !feedRef.current.some(item => item.id === post.id)) return;
        try {
            const incoming: Array<{ key: string; name: string; content: string; persona: string }> = [];
            let nextCommunity = communityRef.current;
            const used = new Set<string>();
            for (const raw of parsed.slice(0, count)) {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
                const entry = raw as Record<string, unknown>;
                const name = String(entry.name || '').trim().slice(0, 32);
                const known = resolveSparkDMAccount(nextCommunity.accounts, name);
                if (known && isSparkMuted(known.id)) continue;
                const content = String(entry?.message || '').trim().slice(0, 500);
                if (!name || !content || used.has(name)) continue;
                const author = resolveSparkAuthor({ author: name, charId: null, isCharacter: false },
                    [], characters, characterHandles, [socialProfile.name, userProfile.name]);
                if (!author || author.character) continue;
                const resolved = ensureSparkAccount(nextCommunity, {
                    type: 'stranger', displayName: author.name,
                }, () => 'npc-' + Date.now() + '-' + Math.random().toString(36).slice(2));
                nextCommunity = resolved.state;
                const key = resolved.account.id;
                if (isSparkMuted(key) || dmThreadsRef.current[key]?.length ||
                    dmThreadsRef.current[name]?.length || incoming.some(item => item.key === key)) continue;
                used.add(name);
                incoming.push({
                    key, name,
                    content,
                    persona: String(entry?.persona || '因看到用户的笔记《' + post.title + '》主动搭话，言谈风格：' + content).slice(0, 500),
                });
            }
            if (!incoming.length) return;
            for (const item of incoming) {
                nextCommunity = appendSparkEvent(nextCommunity, {
                    id: 'dm-incoming:' + item.key + ':' + Date.now() + ':' + Math.random().toString(36).slice(2),
                    type: 'dm_sent', actorAccountId: item.key, targetAccountId: 'user', createdAt: Date.now(),
                    metadata: { source: 'spark-post-incoming', postId: post.id },
                });
            }
            if (nextCommunity !== communityRef.current) writeCommunity(nextCommunity);
            setDmThreads(prev => {
                const next = { ...prev };
                for (const item of incoming) {
                    if (!next[item.key]?.length && !next[item.name]?.length) {
                        next[item.key] = [{ role: 'assistant' as const, content: item.content, time: Date.now() }];
                    }
                }
                dmThreadsRef.current = next;
                localStorage.setItem('spark_dm_threads', JSON.stringify(next));
                return next;
            });
            setNpcPersonas(prev => {
                const next = { ...prev };
                for (const item of incoming) {
                    if (!next[item.key]) next[item.key] = item.persona;
                }
                localStorage.setItem('spark_npc_personas', JSON.stringify(next));
                return next;
            });
            setDmUnread(prev => {
                const next = { ...prev };
                for (const item of incoming) {
                    if (next[item.key] === undefined) next[item.key] = 1;
                }
                localStorage.setItem('spark_dm_unread', JSON.stringify(next));
                return next;
            });
        } catch (error) { console.warn('Spark incoming DM processing failed', error); }
    };

    const handleCreatePost = async () => {
        if (!newPostContent.trim() || publishingRef.current) return;
        const generation = feedLoadGenerationRef.current;
        publishingRef.current = true;
        setIsPublishing(true);
        try {
        const post: SocialPost = {
            id: `user-post-${Date.now()}`,
            authorName: socialProfile.name, // Use Local Identity
            authorAvatar: socialProfile.avatar, // Use Local Identity
            title: newPostTitle || '无标题',
            content: newPostContent,
            // Sticker selector stores twemoji codepoints (eg "2728"); convert to the real emoji char
            // so that the feed/detail views render an emoji instead of the raw codepoint text.
            images: [localPostImage || selectedStockUrl || pickStock(newPostTitle, newPostContent) || codepointToEmoji(newPostEmoji)],
            likes: 0,
            isCollected: false,
            isLiked: false,
            comments: [],
            timestamp: Date.now(),
            tags: parseSparkPublishTags(newPostTags),
            bgStyle: getRandomStyle().bg,
            authorType: 'user', source: 'user',
        };
        // Do not discard the draft until IndexedDB confirms the original post exists.
        const saved = registerSparkPosts([post])[0];
        await persistPostMutation(() => DB.saveSocialPost(saved));
        if (!mountedRef.current || generation !== feedLoadGenerationRef.current) return;
        prependPostsToFeed([saved], false);
        learnInterest(saved, 4);
        setNewPostContent(''); setNewPostTitle(''); setNewPostTags(''); setSelectedStockUrl(''); setLocalPostImage('');
        localStorage.removeItem('spark_post_draft');
        setIsCreateOpen(false);
        setActiveTab('home');
        addToast('笔记已保存并发布', 'success');
        if (apiConfig.apiKey) {
            // Fold possible new inbox conversations into the SAME comment-generation request.
            const followers = communityRef.current.follows.filter(follow => follow.followedId === 'user').length;
            const chance = Math.min(0.88, 0.18 + Math.log10(followers + 1) * 0.14);
            const inboxCount = Math.random() < chance
                ? Math.min(5, 1 + Math.floor(Math.log10(followers + 1) / 1.6) + (Math.random() < 0.2 ? 1 : 0))
                : 0;
            void generateComments(saved, inboxCount);
        }
        } catch (error: any) {
            addToast('发布未完成，草稿仍在，可直接重试：' + (error?.message || error), 'error');
        } finally {
            publishingRef.current = false;
            if (mountedRef.current) setIsPublishing(false);
        }
    };

    const handleDeletePost = async (postId: string) => {
        const post = feedRef.current.find(item => item.id === postId);
        if (!post || !canDeleteSocialPost(post, socialProfile.name)) { addToast('只能删除自己的笔记', 'error'); return; }
        if (!window.confirm('删除自己的这篇笔记？此操作无法撤销。')) return;
        try {
            await removePostFromFeed(postId);
            addToast('帖子已删除', 'success');
            trackEvent('删除一条帖子');
        } catch (error: any) {
            addToast('删除失败，笔记仍已保留：' + (error?.message || error), 'error');
        }
    };
    const handleLike = (e: any, post: SocialPost) => {
        e.stopPropagation();
        if (post.authorType === 'character') remember(post.authorCharId, post, post.isLiked ? '自己的笔记少了一个赞' : '自己的笔记收到点赞');
        learnInterest(post, post.isLiked ? -2 : 2);
        updatePostInFeed(post.id, current => ({
            ...current,
            isLiked: !current.isLiked,
            likes: current.isLiked ? current.likes - 1 : current.likes + 1,
        }));
        trackEvent('点赞一条帖子', { action: post.isLiked ? 'unlike' : 'like' });
    };
    
    const handleSendComment = () => {
        if (!selectedPost || !commentInput.trim()) return;
        const text = commentInput.trim();
        const now = Date.now();
        const recent = lastCommentSubmitRef.current;
        if (recent && recent.postId === selectedPost.id && recent.content === text && now - recent.at < 650) return;
        lastCommentSubmitRef.current = { postId: selectedPost.id, content: text, at: now };

        const userComment: SocialComment = {
                id: `cmt-user-${now}-${Math.random().toString(36).slice(2, 9)}`,
                authorName: socialProfile.name, // Use Local Identity
                authorAvatar: socialProfile.avatar, // Use Local Identity
                content: commentInput.trim(),
                likes: 0,
                isCharacter: false,
                authorType: 'user' as const,
                authorId: 'user',
                timestamp: Date.now(),
                ...(replyTarget ? { parentCommentId: replyTarget.id, replyToAuthorName: replyTarget.authorName } : {}),
        };
        const updatedPost = updatePostInFeed(selectedPost.id, current => ({
            ...current,
            comments: mergeSocialComments(current.comments || [], [userComment]),
        }));
        if (!updatedPost) { lastCommentSubmitRef.current = null; return; }
        learnInterest(selectedPost, 3);
        if (selectedPost.authorType === 'character') remember(selectedPost.authorCharId, selectedPost, '自己的公开笔记收到评论：' + userComment.content);
        const contentToSend = commentInput; 
        setCommentInput(''); 
        setReplyTarget(null);
        void generateRepliesToUser(updatedPost, contentToSend, userComment.id); 
    };

    const handleOpenPost = (post: SocialPost) => {
        const livePost = feedRef.current.find(item => item.id === post.id) || post;
        setSelectedPost(livePost);
        setReplyTarget(null);
        setCommentVisibleLimit(80);
        lastOpenedPostIdRef.current = livePost.id;
        if (commentOpenTimerRef.current !== null) window.clearTimeout(commentOpenTimerRef.current);
        commentOpenTimerRef.current = null;
        // Feed ranking already accounts for seen IDs; make that signal real and persistent.
        const updatedCommunity = markSparkPostSeen(communityRef.current, livePost.id);
        if (updatedCommunity !== communityRef.current) writeCommunity(updatedCommunity);
        learnInterest(livePost, 0.3);
        // Quick accidental opens should not incur an API bill.
        if (needsSparkInitialCommentCall(livePost)) {
            commentOpenTimerRef.current = window.setTimeout(() => {
                commentOpenTimerRef.current = null;
                if (mountedRef.current && lastOpenedPostIdRef.current === livePost.id) void generateComments(livePost);
            }, 900);
        }
    };

    const handleClosePost = () => {
        lastOpenedPostIdRef.current = null;
        if (commentOpenTimerRef.current !== null) window.clearTimeout(commentOpenTimerRef.current);
        commentOpenTimerRef.current = null;
        commentRequestRef.current?.controller.abort();
        commentRequestRef.current = null;
        setLoadingComments(false);
        setReplyTarget(null);
        setSelectedPost(null);
    };

    const hasSparkOverlay = showSettings || showShareModal || showCharPosting ||
        showUtilityShelf || isCreateOpen || !!dmTarget || !!viewedAccount ||
        showCommentStickers || !!selectedPost || !!noticeCategory || searchOpen;
    const dismissTopSparkOverlay = (): boolean => {
        if (showSettings) setShowSettings(false);
        else if (showShareModal) setShowShareModal(false);
        else if (showCharPosting) setShowCharPosting(false);
        else if (showUtilityShelf) setShowUtilityShelf(false);
        else if (isCreateOpen) closeCreatePost();
        else if (dmTarget) setDmTarget(null);
        else if (viewedAccount) setViewedAccount(null);
        else if (showCommentStickers) setShowCommentStickers(false);
        else if (selectedPost) handleClosePost();
        else if (noticeCategory) setNoticeCategory(null);
        else if (searchOpen) setSearchOpen(false);
        else return false;
        return true;
    };
    // Follow SullyOS's native/local back stack rather than intercepting browser history.
    useLocalBackHandler(dismissTopSparkOverlay, 80, hasSparkOverlay);
    useEffect(() => {
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            const focused = document.activeElement as HTMLElement | null;
            if (focused && ['INPUT', 'TEXTAREA'].includes(focused.tagName)) {
                focused.blur();
                event.preventDefault();
                return;
            }
            if (dismissTopSparkOverlay()) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        window.addEventListener('keydown', onEscape);
        return () => window.removeEventListener('keydown', onEscape);
    }, [hasSparkOverlay, showSettings, showShareModal, showCharPosting, showUtilityShelf,
        isCreateOpen, dmTarget, viewedAccount, showCommentStickers, selectedPost, noticeCategory, searchOpen]);

    const handleClearFeed = async () => {
        if (clearingFeedRef.current) return;
        clearingFeedRef.current = true;
        refreshRequestRef.current?.abort();
        autonomyRequestRef.current?.abort();
        autonomyRequestRef.current = null;
        commentRequestRef.current?.controller.abort();
        replyRequestRef.current?.controller.abort();
        refreshRequestRef.current = null;
        commentRequestRef.current = null;
        replyRequestRef.current = null;
        replyQueueRef.current = [];
        setIsRefreshing(false);
        setLoadingComments(false);
        setIsReplyingToUser(false);
        setIsAutonomyBusy(false);
        feedLoadGenerationRef.current += 1;
        try {
            // Clear is destructive: only report success and remove live data after DB confirms it.
            await persistPostMutation(() => DB.clearSocialPosts());
            if (!mountedRef.current) return;
            feedRef.current = [];
            setFeed([]);
            setSelectedPost(null);
            const currentCommunity = communityRef.current;
            writeCommunity({
                ...currentCommunity,
                seenPostIds: [],
                hiddenPostIds: [],
                notifications: currentCommunity.notifications.filter(item => !item.postId),
                events: currentCommunity.events.filter(item => !item.postId),
            });
            setHiddenPostIds([]);
            try { localStorage.removeItem('spark_hidden_posts'); } catch { /* local cache is optional */ }
            setPostTraffic({});
            trafficRef.current = {};
            try { localStorage.removeItem('spark_post_traffic'); } catch { /* local cache is optional */ }
            setNotices(prev => {
                const next = prev.filter(item => !item.postId);
                localStorage.setItem('spark_notifications', JSON.stringify(next));
                return next;
            });
            setShowSettings(false);
            addToast('推荐流已清空', 'success');
            trackEvent('清空 Spark 推荐流');
        } catch (error: any) {
            addToast('清空失败，已有帖子仍保留：' + (error?.message || error), 'error');
        } finally {
            clearingFeedRef.current = false;
        }
    };

    // --- Renderers ---

    // 1. Feed Item (Glassmorphism)
    const accountPosts = (handle: string, id?: string) => {
        const account = resolveSparkDMAccount(communityState.accounts, handle, id);
        return feed.filter(post => account ? post.authorId === account.id || (!post.authorId && post.authorName === handle) : post.authorName === handle);
    };

    const renderFeedItem = (post: SocialPost) => (
        <div key={post.id} onClick={() => handleOpenPost(post)} className="break-inside-avoid mb-3 min-w-0 bg-white rounded-xl overflow-hidden shadow-sm cursor-pointer active:scale-[0.98] relative group">
            <div className="aspect-[4/5] w-full flex items-center justify-center relative overflow-hidden" style={{ background: post.bgStyle }}>
                <div className="relative w-full h-full flex items-center justify-center text-5xl">{postVisual(post.images[0], 'w-full h-full')}</div>
            </div>
            <div className="px-2.5 pt-2 pb-3">
                <h3 className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2 mb-2">{post.title}</h3>
                <div className="flex justify-between items-center gap-2">
                    <div className="flex flex-1 items-center gap-2 min-w-0">
                        <TokenImg value={post.authorAvatar} className="w-5 h-5 rounded-full object-cover shrink-0 ring-1 ring-white/50" />
                        <span className="text-[11px] text-slate-700 truncate font-medium">{post.authorName}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-slate-400 group-hover:text-slate-600 transition-colors">
                        <Icons.Heart filled={post.isLiked} className="w-4 h-4" onClick={(e) => handleLike(e, post)} />
                        <span className="text-[10px] font-medium">{post.likes}</span>
                    </div>
                </div>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); canDeleteSocialPost(post, socialProfile.name) ? handleDeletePost(post.id) : hidePost(post.id); }}
                aria-label={canDeleteSocialPost(post, socialProfile.name) ? '删除自己的笔记' : '不感兴趣，隐藏笔记'}
                className="absolute top-2 right-2 z-20 min-w-8 h-8 px-1 rounded-lg bg-black/35 text-white text-xs backdrop-blur-md">{canDeleteSocialPost(post, socialProfile.name) ? '删除' : '隐藏'}</button>
        </div>
    );

    // 2. Detail Overlay (Glassmorphism)
    // FIX: Using a fixed container for backdrop to prevent layout gaps.
    // REMOVED 'key={selectedPost.id}' to prevent re-mounting jitter.
    // SEPARATED scrollable container from animation wrapper.
    const renderDetail = () => {
        if (!selectedPost) return null;
        return (
            <div 
                className="absolute inset-0 z-[60] h-full w-full bg-white/90 backdrop-blur-xl flex flex-col"
            >
                {/* 
                   Animation Wrapper. 
                   We want the whole overlay content to slide up. 
                   We ensure this doesn't re-render on state changes like comments.
                */}
                <div className="flex-1 w-full h-full flex flex-col animate-slide-up relative overflow-hidden">
                    {/* Header —— 自理安全区：--safe-top 让开刘海（带 iOS env 偶发返回 0 的 JS 兜底；非刘海设备保底 12px） */}
                    <div className="flex items-center justify-between px-4 bg-white/60 backdrop-blur-xl border-b border-white/20 shrink-0 relative z-20" style={{ paddingTop: 'max(12px, var(--safe-top))', paddingBottom: '12px' }}>
                        <button onClick={handleClosePost} className="p-2 -m-2 active:opacity-60"><Icons.Back /></button>
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setViewedAccount({ handle: selectedPost.authorName, avatar: selectedPost.authorAvatar, accountId: selectedPost.authorId })} aria-label="查看作者主页">
                                <TokenImg value={selectedPost.authorAvatar} className="w-8 h-8 rounded-full object-cover border border-white/50" />
                            </button>
                            <button type="button" onClick={() => setViewedAccount({ handle: selectedPost.authorName, avatar: selectedPost.authorAvatar, accountId: selectedPost.authorId })} className="text-sm font-bold text-slate-800">{selectedPost.authorName}</button>
                            {selectedPost.authorType !== 'user' && (
                                <button type="button" onClick={() => toggleFollow(selectedPost.authorName, selectedPost.authorId)}
                                    className="ml-auto rounded-full border border-[#555555]/30 px-3 py-1 text-xs font-bold text-[#555555]">
                                    {isFollowing(selectedPost.authorName, selectedPost.authorId) ? '已关注 ✓' : '+ 关注'}
                                </button>
                            )}
                        </div>
                        <button onClick={() => { setShowShareModal(true); trackEvent('打开分享帖子面板'); }} className="p-2 -m-2 active:opacity-60"><Icons.Share onClick={() => setShowShareModal(true)} className="w-6 h-6 text-slate-800 cursor-pointer hover:text-[#555555]" /></button>
                    </div>

                    {/* Scrollable Area */}
                    <div ref={detailScrollRef} className="flex-1 overflow-y-auto no-scrollbar pb-24">
                        {/* Main Visual */}
                        <div className="w-full aspect-square flex items-center justify-center text-[8rem] relative overflow-hidden" style={{ background: selectedPost.bgStyle }}>
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/10"></div>
                            {/* Removed animate-bounce-slow to prevent reflow jitter */}
                            <div className="relative z-10 w-full h-full flex items-center justify-center text-[8rem]">{postVisual(selectedPost.images[0], 'w-full h-full')}</div>
                        </div>

                        <div className="p-6 space-y-4">
                            <h1 className="text-2xl font-black text-slate-900 leading-snug tracking-tight">{selectedPost.title}</h1>
                            <p className="text-[15px] text-slate-700 leading-relaxed whitespace-pre-wrap font-light">{selectedPost.content}</p>
                            
                            <div className="flex gap-2 flex-wrap pt-2">
                                {selectedPost.tags.map(t => <button type="button" key={t}
                                onClick={() => { setActiveTopic(t); setSearchQuery(''); setSearchOpen(false); setFeedTab('discover'); setActiveTab('home'); setSelectedPost(null); setViewedAccount(null); }}
                                className="text-xs font-bold text-neutral-600 bg-neutral-50/50 backdrop-blur-sm border border-neutral-100 px-2.5 py-1 rounded-full">#{t}</button>)}
                            </div>
                            <div className="text-xs text-slate-400 font-medium border-b border-slate-100/50 pb-6">{new Date(selectedPost.timestamp).toLocaleDateString()}</div>
                            {selectedPost.authorType === 'user' && postTraffic[selectedPost.id] && <div className="grid grid-cols-3 gap-2 rounded-xl bg-neutral-50/70 p-3 text-center text-xs text-slate-600">
                                <div><strong className="block text-base text-slate-800">{postTraffic[selectedPost.id].impressions.toLocaleString()}</strong>模拟曝光</div>
                                <div><strong className="block text-base text-slate-800">{postTraffic[selectedPost.id].reads.toLocaleString()}</strong>模拟阅读</div>
                                <div><strong className="block text-base text-slate-800">{postTraffic[selectedPost.id].score}</strong>内容评分估算</div>
                                <div><strong className="block text-base text-slate-800">{postTraffic[selectedPost.id].likes}</strong>点赞</div>
                                <div><strong className="block text-base text-slate-800">{postTraffic[selectedPost.id].comments}</strong>评论</div>
                                <div><strong className="block text-base text-neutral-500">{communityState.follows.filter(follow => follow.followedId === 'user').length}</strong>可追踪粉丝总数</div>
                            </div>}
                        </div>

                        {/* Comments Section */}
                        <div className="px-6 pb-6">
                            <div className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                                <span>共 {selectedPost.comments.filter(comment => !isSparkMuted(comment.authorId || getSparkPublicAuthorId(comment.authorName, comment.authorCharId))).length} 条评论</span>
                                {(loadingComments || isReplyingToUser) && <div className="w-3 h-3 border-2 border-slate-300 border-t-[#555555] rounded-full animate-spin"></div>}
                            </div>
                            
                            <div className="space-y-6">
                                {selectedPost.comments.length === 0 && !loadingComments && <div className="text-center text-slate-300 text-xs py-10">快来抢沙发...</div>}
                                {selectedPost.comments.filter(comment => !isSparkMuted(comment.authorId || getSparkPublicAuthorId(comment.authorName, comment.authorCharId))).length > commentVisibleLimit && <button type="button" onClick={() => setCommentVisibleLimit(n => n + 80)}
                                    className="block mx-auto mb-4 rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-500">查看更早的评论</button>}
                                {selectedPost.comments.filter(comment => !isSparkMuted(comment.authorId || getSparkPublicAuthorId(comment.authorName, comment.authorCharId))).slice(-commentVisibleLimit).map(c => (
                                    <div key={c.id} className={`flex gap-3 animate-fade-in group ${c.parentCommentId ? 'ml-6 border-l-2 border-slate-100 pl-3' : ''}`}>
                                        <TokenImg value={c.authorAvatar} className="w-9 h-9 rounded-full object-cover shrink-0 border border-slate-100" />
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start">
                                                <span className={`text-xs font-bold ${c.isCharacter ? 'text-slate-800' : 'text-slate-500'}`}>{c.authorName}</span>
                                                <div className="flex items-center gap-1 text-slate-400 cursor-pointer hover:text-[#555555]">
                                                    <button type="button" aria-label={c.isLiked ? '取消点赞评论' : '点赞评论'} onClick={() => updatePostInFeed(selectedPost.id, current => ({ ...current, comments: current.comments.map(item => item.id === c.id ? toggleSocialCommentLike(item) : item) }))}>
                                        <Icons.Heart filled={!!c.isLiked} className="w-3.5 h-3.5" />
                                    </button>
                                                    <span className="text-[10px]">{c.likes}</span>
                                                </div>
                                            </div>
                                            {c.parentCommentId && <p className="text-[11px] text-slate-400 mt-1">↳ 回复 @{c.replyToAuthorName || selectedPost.comments.find(parent => parent.id === c.parentCommentId)?.authorName || '楼中楼'}</p>}
                                            <div className="text-[13px] text-slate-700 mt-0.5 leading-normal font-light whitespace-pre-wrap">{c.content.split(/(\[表情包\]\(https?:\/\/[^\s)]+\))/g).map((part, i) => { const match = part.match(/^\[表情包\]\((https?:\/\/[^\s)]+)\)$/); return match ? <img key={i} src={match[1]} alt="表情包" className="max-w-32 max-h-32 object-contain rounded-lg my-1" /> : <React.Fragment key={i}>{part}</React.Fragment>; })}</div>
                                            <button type="button" onClick={() => setReplyTarget(c)} className="mt-2 text-xs text-slate-400 hover:text-slate-700">回复</button>
                                        </div>
                                    </div>
                                ))}
                                <div ref={commentsEndRef} />
                            </div>
                        </div>
                    </div>

                    {showCommentStickers && <div className="absolute bottom-16 left-0 right-0 z-40 bg-white border-t border-slate-100 p-3 grid grid-cols-5 gap-2 max-h-44 overflow-y-auto">
                        {stockImages.filter(img => img.category === 'sticker').map(img => <button type="button" key={img.id} onClick={() => { setCommentInput(prev => prev + ' [表情包](' + img.url + ')'); setShowCommentStickers(false); }}><img src={img.url} alt={img.tags.join(' ')} className="w-full aspect-square object-contain" /></button>)}
                        {!stockImages.some(img => img.category === 'sticker') && <p className="col-span-5 text-xs text-slate-400">请先在小红书图库的「评论表情包」分类添加图片。</p>}
                    </div>}
                    {/* Bottom Input Bar - Absolute to sit on top of scroll area at bottom */}
                    <div className="absolute bottom-0 w-full pb-[var(--safe-bottom,0px)] z-30 pointer-events-none">
                         {replyTarget && <div className="pointer-events-auto flex justify-between items-center px-4 py-2 bg-white border-t border-slate-100 text-xs text-slate-500">
                             <span>回复 @{replyTarget.authorName}</span><button type="button" onClick={() => setReplyTarget(null)}>取消回复 ×</button>
                         </div>}
                         <div className="pointer-events-auto h-16 bg-white/80 backdrop-blur-xl border-t border-white/40 px-4 flex items-center justify-between gap-4 shadow-[0_-4px_20px_rgba(0, 0, 0,0.03)]">
                            <div className="flex-1 bg-slate-100/50 rounded-full px-5 py-2.5 flex items-center gap-2 focus-within:bg-white focus-within:ring-1 focus-within:ring-slate-200 transition-all border border-transparent focus-within:border-slate-200">
                                <input 
                                    value={commentInput}
                                    onChange={(e) => setCommentInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); handleSendComment(); } }}
                                    
                                    placeholder={replyTarget ? "回复 @" + replyTarget.authorName : "说点什么..."}
                                    className="bg-transparent text-sm w-full outline-none text-slate-800 placeholder:text-slate-400 disabled:opacity-50"
                                />
                                {commentInput.trim() && <button  onClick={handleSendComment} className="text-[#555555] font-bold text-sm animate-fade-in disabled:opacity-40">发送</button>}
                            </div>
                            <button type="button" onClick={() => setShowCommentStickers(v => !v)} className="text-xs text-neutral-500 shrink-0">表情包</button>
                            <div className="flex gap-5 text-slate-600 shrink-0 items-center">
                                <div className="flex flex-col items-center gap-0.5">
                                    <Icons.Heart filled={selectedPost.isLiked} onClick={(e) => handleLike(e, selectedPost)} className="w-6 h-6" />
                                    <span className="text-[10px] font-medium">{selectedPost.likes}</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                    <Icons.Star filled={selectedPost.isCollected} onClick={() => {  updatePostInFeed(selectedPost.id, current => ({ ...current, isCollected: !current.isCollected })); trackEvent('收藏一条帖子', { action: selectedPost.isCollected ? 'uncollect' : 'collect' }); }} className="w-6 h-6" />
                                    <span className="text-[10px] font-medium">{selectedPost.isCollected ? '已收藏' : '收藏'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        // Main Container with Premium Gradient Background
        <div className="h-full w-full bg-gradient-to-br from-neutral-50 via-slate-50 to-neutral-50 flex flex-col font-sans relative text-slate-900 overflow-hidden">
            
            {dmTarget && <div className="absolute inset-0 z-[90] bg-white flex min-h-0 flex-col" style={{ paddingTop: 'var(--safe-top)', maxHeight: 'var(--visual-viewport-height, 100dvh)' }}>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                    <button type="button" onClick={() => setDmTarget(null)} className="text-xl">‹</button>
                    <TokenImg value={dmTarget.avatar} className="w-9 h-9 rounded-full object-cover" />
                    <strong className="truncate text-sm">{dmTarget.handle}</strong>
                </div>
                <div ref={dmScrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3 bg-slate-50">
                    {(dmThreads[dmKey(dmTarget)] || []).length > dmVisibleLimit && <button type="button" className="block mx-auto text-xs text-slate-500 px-4 py-2 border rounded-full" onClick={() => setDmVisibleLimit(limit => limit + 80)}>查看更早的私信</button>}
                    {(dmThreads[dmKey(dmTarget)] || []).slice(-dmVisibleLimit).map((message, index) => <div key={message.id || index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${message.role === 'user' ? 'bg-[#555555] text-white' : 'bg-white text-slate-800'}`}>
                            {message.content}
                            {message.role === 'user' && message.delivery === 'pending' && <span className="block text-[10px] opacity-75 mt-1">排队发送中…</span>}
                            {message.role === 'user' && message.delivery === 'failed' && <button type="button" onClick={() => retrySparkDM(dmTarget, message.id)}
                                className="block text-[11px] underline mt-1" aria-label="重试这条私信">发送失败 · 点击重试</button>}
                        </div>
                    </div>)}
                    {dmBusy && <p className="text-xs text-slate-400">对方正在输入…</p>}
                </div>
                <div className="flex items-center gap-2 p-3 shrink-0 border-t border-slate-100" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
                    <input ref={dmInputRef} onFocus={() => { if (dmScrollRef.current) dmScrollRef.current.scrollTop = dmScrollRef.current.scrollHeight; }} value={dmInput} onChange={e => setDmInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); sendSparkDM(); } }} placeholder="发送私信…" className="flex-1 min-w-0 rounded-full bg-slate-100 px-4 py-2 text-sm" />
                    <button type="button" disabled={!dmInput.trim()} onClick={() => sendSparkDM()} className="text-[#555555] font-bold disabled:opacity-40">发送</button>
                </div>
            </div>}
            {viewedAccount && (() => {
                const posts = accountPosts(viewedAccount.handle, viewedAccount.accountId);
                const owner = characters.find(c => (characterHandles[c.id] || []).some(a => a.handle === viewedAccount.handle));
                const account = owner && (characterHandles[owner.id] || []).find(a => a.handle === viewedAccount.handle);
                const isMain = account?.id === 'default' || account?.note === '主账号';
                return <div className="absolute inset-0 z-[80] flex flex-col bg-white" style={{ paddingTop: 'max(12px, var(--safe-top))' }}>
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                        <button onClick={() => setViewedAccount(null)} className="text-xl px-2" aria-label="返回">‹</button>
                        <span className="font-bold truncate">{viewedAccount.handle}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 pb-24">
                        <div className="flex items-center gap-4">
                            <TokenImg value={viewedAccount.avatar} className="w-16 h-16 rounded-full object-cover" />
                            <div className="min-w-0"><h2 className="text-xl font-bold break-words">{viewedAccount.handle}</h2>
                                <p className="text-xs text-slate-400">Spark 账号</p></div>
                        </div>
                        <div className="flex gap-7 text-xs text-slate-500 my-5">
                            <span><strong className="text-slate-800">{posts.length}</strong> 笔记</span>
                            <span><strong className="text-slate-800">{communityState.follows.filter(follow => follow.followedId === viewedAccount.accountId).length}</strong> 粉丝</span>
                        </div>

                        {viewedAccount.handle !== socialProfile.name && <button type="button" onClick={() => { openSparkDM(viewedAccount); setViewedAccount(null); }} className="w-full rounded-full border border-[#555555] text-[#555555] font-bold py-2 mb-2">私信</button>}
                        {viewedAccount.handle !== socialProfile.name && <button type="button" onClick={() => toggleMuteSparkAccount(viewedAccount.handle, viewedAccount.accountId)}
                            className="w-full rounded-full border border-slate-300 text-slate-600 font-bold py-2 mb-2">{isSparkMuted(viewedAccount.accountId) ? '解除屏蔽' : '屏蔽此账号'}</button>}
                        {viewedAccount.handle !== socialProfile.name && <button type="button" onClick={() => toggleFollow(viewedAccount.handle, viewedAccount.accountId)} className="w-full rounded-full bg-[#555555] text-white font-bold py-2 mb-5">
                            {isFollowing(viewedAccount.handle, viewedAccount.accountId) ? '已关注 ✓ · 点击取消' : '+ 关注'}
                        </button>}
                        <p className="font-bold text-sm border-b pb-3 mb-3">TA 的笔记</p>
                        <div className="grid grid-cols-2 gap-3">
                            {posts.slice(0, accountVisibleLimit).map(post => <button type="button" key={post.id} onClick={() => { setViewedAccount(null); handleOpenPost(post); }} className="text-left rounded-xl border border-slate-100 overflow-hidden">
                                <div className="aspect-[4/5] flex items-center justify-center text-5xl" style={{ background: post.bgStyle }}>{postVisual(post.images[0], 'w-full h-full')}</div>
                                <div className="p-2 text-xs font-bold line-clamp-2">{post.title}</div>
                            </button>)}
                        </div>
                        {posts.length > accountVisibleLimit && <button type="button" onClick={() => setAccountVisibleLimit(count => count + 60)} className="w-full mt-3 py-3 rounded-xl border border-slate-200 text-xs text-slate-600">加载更早的笔记</button>}
                        {!posts.length && <p className="text-center text-xs text-slate-400 py-12">这个账号还没有发布笔记</p>}
                    </div>
                </div>;
            })()}
            <Modal isOpen={showCharPosting} title="Char 发帖设置" onClose={() => setShowCharPosting(false)}>
                <div className="space-y-4 py-2 text-sm text-slate-700">
                    <div className="space-y-2">
                        <p className="font-bold">选择发帖角色（可多选）</p>
                        <div className="grid grid-cols-4 gap-3 max-h-52 overflow-y-auto py-2">
                            {characters.map(c => {
                                const checked = postingCharIds.includes(c.id);
                                return <button type="button" key={c.id} aria-pressed={checked} onClick={() => setPostingCharIds(prev => checked ? prev.filter(id => id !== c.id) : [...prev, c.id])} className="flex flex-col items-center gap-1 min-w-0">
                                    <span className={`relative block w-12 h-12 rounded-full ${checked ? 'ring-2 ring-[#555555] ring-offset-2' : ''}`}>
                                        <TokenImg value={c.avatar} className="w-full h-full rounded-full object-cover" />
                                        {checked && <span className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-[#555555] text-white text-xs flex items-center justify-center">✓</span>}
                                    </span>
                                    <span className="text-[11px] truncate max-w-full">{c.name}</span>
                                </button>;
                            })}
                        </div>
                        <p className="text-xs text-slate-400">已选 {postingCharIds.length} 位，每位角色自由发布自己的动态</p>
                    </div>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={autoIdentity} onChange={e => setAutoIdentity(e.target.checked)}/>由 Char 自行选择马甲</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={naturalComments} onChange={e => setNaturalComments(e.target.checked)}/>评论遵循角色人设与关系</label>
                    <button type="button" disabled={isCharPosting || postingCharIds.length === 0} onClick={handleCharPost} className="w-full rounded-xl bg-[#555555] text-white font-bold py-3 disabled:opacity-40">{isCharPosting ? '角色正在构思…' : '让 Char 自由发帖'}</button>
                </div>
            </Modal>
            {/* 收纳入口与小红书主功能独立，避免占据发现/我的导航。 */}
            <Modal isOpen={showUtilityShelf} title="收纳" onClose={() => setShowUtilityShelf(false)}>
                <div className="space-y-2 py-2">
                    <button type="button" onClick={() => { setShowUtilityShelf(false); openApp(AppID.XhsStock); }} className="w-full flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-700"><span>小红书图库</span><span className="text-slate-400">›</span></button>
                    <button type="button" onClick={() => { setShowUtilityShelf(false); openApp(AppID.XhsFreeRoam); }} className="w-full flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-700"><span>自由活动</span><span className="text-slate-400">›</span></button>
                </div>
            </Modal>
            {/* --- Modals (Settings, Share) --- */}
            <Modal isOpen={showSettings} title="Spark 设置" onClose={() => setShowSettings(false)}>
                <div className="space-y-4 py-2 text-sm">
                    <div className="rounded-xl border border-slate-200 p-3 space-y-3">
                        <label className="flex items-start gap-3 justify-between">
                            <span className="min-w-0">
                                <strong className="block text-sm text-slate-800">社区自主活动（自愿开启）</strong>
                                <span className="block text-xs text-slate-500 mt-1">默认关闭。开启后，角色和稳定网友可能继续真实话题、发帖或评论，也可能保持安静；不会让你等待。</span>
                            </span>
                            <input type="checkbox" aria-label="开启社区自主活动" className="mt-1" checked={communityState.autonomy.enabled}
                                onChange={event => {
                                    const enabled = event.target.checked;
                                    writeCommunity({ ...communityRef.current, autonomy: { ...communityRef.current.autonomy, enabled } });
                                    if (!enabled) { autonomyRequestRef.current?.abort(); autonomyRequestRef.current = null; setIsAutonomyBusy(false); }
                                    else if (!apiConfig.apiKey) addToast('已开启；配置 API Key 后才会开始自动请求', 'info');
                                }} />
                        </label>
                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                            <label>最短调用间隔
                                <select value={communityState.autonomy.minIntervalHours}
                                    onChange={event => writeCommunity({ ...communityRef.current, autonomy: { ...communityRef.current.autonomy, minIntervalHours: Number(event.target.value) } })}
                                    className="block w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg p-2">
                                    {[1, 3, 6, 12, 24, 48].map(hours => <option key={hours} value={hours}>{hours} 小时</option>)}
                                </select>
                            </label>
                            <label>每日 API 次数上限
                                <select value={communityState.autonomy.maxCallsPerDay}
                                    onChange={event => {
                                        const maxCallsPerDay = Number(event.target.value);
                                        writeCommunity({ ...communityRef.current, autonomy: {
                                            ...communityRef.current.autonomy, maxCallsPerDay,
                                            callsToday: Math.min(communityRef.current.autonomy.callsToday, maxCallsPerDay),
                                        } });
                                    }}
                                    className="block w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg p-2">
                                    {[0, 1, 2, 3].map(calls => <option key={calls} value={calls}>{calls === 0 ? '暂停调用' : calls + ' 次'}</option>)}
                                </select>
                            </label>
                        </div>
                        <p className="text-xs text-slate-500">省 API 模式：同一次发帖同时处理评论和可选来信；同一账号连发私信与同帖连续评论会短时合批；多 Char 发帖最多 8 位一组。批量节省调用次数，但仍按服务商的实际 Token 量计费。</p>
                        <p className="text-xs text-slate-400">仅在 Spark 打开时每 5 分钟检查，实际请求受间隔和额度约束。今日已使用：{communityState.autonomy.lastRunDay === getSparkTrafficLocalDay() ? communityState.autonomy.callsToday : 0}/{communityState.autonomy.maxCallsPerDay} 次。超时和失败请求也占用额度。</p>
                        {isAutonomyBusy && <p className="text-xs text-slate-500">正在生成社区动态，可继续正常操作。</p>}
                    </div>
                    <p className="text-xs text-slate-500">选择参与 Spark 的 Char。大号与马甲由 AI 依据人设自行决定，不再由 User 手动创建或指定。</p>
                    <div className="grid grid-cols-4 gap-3 max-h-60 overflow-y-auto">
                        {characters.map(c => <button type="button" key={c.id} onClick={() => setPostingCharIds(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])} className="flex flex-col items-center gap-1">
                            <span className={`w-12 h-12 rounded-full ${postingCharIds.includes(c.id) ? 'ring-2 ring-neutral-500 ring-offset-2' : ''}`}><TokenImg value={c.avatar} className="w-full h-full rounded-full object-cover" /></span>
                            <span className="text-[11px] truncate max-w-full">{c.name}</span>
                        </button>)}
                    </div>
                    <p className="text-xs text-slate-400">已选择 {postingCharIds.length} 位角色</p>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={naturalComments} onChange={e => setNaturalComments(e.target.checked)} />评论遵循角色人设与关系</label>
                    <div className="border-t border-slate-100 pt-3 space-y-2">
                        <p className="font-semibold text-slate-700">Spark 读取的世界书</p>
                        <p className="text-xs text-slate-400">仅本应用的 AI 生成读取选中的世界书，不修改其他 App 的挂载配置。</p>
                        <div className="max-h-40 overflow-y-auto space-y-2">
                            {worldbooks.filter(wb => !wb.disable).map(wb => <label key={wb.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={sparkWorldbookIds.includes(wb.id)} onChange={() => toggleSparkWorldbook(wb.id)} /><span className="truncate">{wb.title}</span></label>)}
                            {!worldbooks.some(wb => !wb.disable) && <p className="text-xs text-slate-400">暂无可用世界书</p>}
                        </div>
                    </div>
                    {communityState.mutedAccountIds.length > 0 && <div className="space-y-2 border-t border-slate-100 pt-3">
                        <p className="font-semibold text-slate-700">已屏蔽账号（历史私信不会删除）</p>
                        {communityState.mutedAccountIds.map(id => {
                            const account = communityState.accounts.find(a => a.id === id);
                            return <button key={id} type="button" onClick={() => account && toggleMuteSparkAccount(account.displayName, id)}
                                className="flex w-full justify-between gap-2 rounded-xl border border-slate-200 p-2 text-xs">
                                <span className="truncate">{account?.displayName || '旧账号'}</span><span>解除屏蔽</span>
                            </button>;
                        })}
                    </div>}
                    {hiddenPostIds.length > 0 && <button type="button" onClick={() => { setHiddenPostIds([]); localStorage.removeItem('spark_hidden_posts'); addToast('已恢复隐藏的笔记', 'success'); }} className="w-full border rounded-xl py-2 text-xs">恢复已隐藏的 {hiddenPostIds.length} 篇笔记</button>}
                    <button type="button" onClick={() => { if (window.confirm('确定清空 Spark 推荐流中的全部帖子和评论吗？此操作无法撤销。')) handleClearFeed(); }} className="w-full border border-neutral-200 text-neutral-500 rounded-xl py-2 text-xs">清除推荐流</button>
                    <p className="text-xs text-slate-400">自动活动仅在本页面开放期间执行；不会后台消耗额度。</p>
                    <button type="button" disabled={isCharPosting || !postingCharIds.length} onClick={() => { setShowSettings(false); void handleCharPost(); }} className="w-full bg-[#555555] text-white rounded-xl py-3 font-bold disabled:opacity-40">{isCharPosting ? '发布中…' : '让选中的 Char 现在发帖'}</button>
                    <button type="button" onClick={() => setShowSettings(false)} className="w-full border rounded-xl py-2">完成</button>
                </div>
            </Modal>

            <Modal isOpen={showShareModal} title="分享帖子" onClose={() => setShowShareModal(false)}>
                {/* 分组筛选（没建分组时不渲染） */}
                <CharacterGroupFilterBar characters={characters} groups={characterGroups} value={shareGroupId} onChange={setShareGroupId} className="mb-1 px-2" />
                <div className="grid grid-cols-4 gap-4 p-2">
                    {filterCharactersByGroup(characters, characterGroups, shareGroupId).map(c => (
                        <button key={c.id} onClick={() => handleShare(c.id, false)} className="flex flex-col items-center gap-2 group">
                            <TokenImg value={c.avatar} className="w-12 h-12 rounded-full object-cover border border-slate-100 group-active:scale-90 transition-transform" />
                            <span className="text-[10px] text-slate-600 truncate w-full text-center">{c.name}</span>
                        </button>
                    ))}
                </div>
            </Modal>

            {/* --- Create Post Modal (Full Screen Overlay) --- */}
            {isCreateOpen && (
                <div className="absolute inset-0 z-50 bg-white flex flex-col animate-slide-up">
                    {/* Create Header —— 自理安全区：外层扛 safe-top + 背景，内层保持 h-14 内容栏（同主栏，避开 border-box 吃 padding） */}
                    <div className="sticky top-0 z-20 bg-white border-b border-slate-50" style={{ paddingTop: 'var(--safe-top)' }}>
                        <div className="h-14 flex items-center justify-between px-4">
                            <button onClick={closeCreatePost} className="text-slate-600 text-sm font-bold px-2 py-1">取消</button>
                            <span className="text-sm font-bold text-slate-800">发布笔记</span>
                            <button
                                onClick={handleCreatePost}
                                disabled={!newPostContent.trim() || isPublishing}
                                className={`px-4 py-1.5 rounded-full text-xs font-bold text-white transition-all ${newPostContent.trim() ? 'bg-[#555555] shadow-md shadow-neutral-200' : 'bg-slate-200 text-slate-400'}`}
                            >
                                {isPublishing ? '保存中…' : '发布'}
                            </button>
                        </div>
                    </div>

                    {/* Create Content */}
                    <div className="flex-1 overflow-y-auto no-scrollbar p-6">
                        <input 
                            value={newPostTitle} 
                            onChange={e => setNewPostTitle(e.target.value)} 
                            placeholder="填写标题会有更多赞哦~" 
                            className="text-xl font-black placeholder:text-slate-300 outline-none mb-4 w-full" 
                        />
                        <textarea 
                            value={newPostContent} 
                            onChange={e => setNewPostContent(e.target.value)} 
                            placeholder="分享你此刻的想法..." 
                            className="w-full h-auto min-h-[200px] resize-none outline-none text-base leading-relaxed placeholder:text-slate-300 font-medium" 
                        />
                        
                        <label className="block mt-3 mb-2 text-xs font-bold text-slate-500">
                            话题标签（最多 6 个，用空格或逗号分隔）
                            <input type="text" value={newPostTags} onChange={e => setNewPostTags(e.target.value)}
                                placeholder="绘画 插画 日常"
                                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none" />
                        </label>
                        <div className="mt-4 pt-4 border-t border-slate-50">
                            <div className="flex justify-between items-center mb-2">
                                <p className="text-xs font-bold text-slate-500">从小红书图库选配图（URL，不存图片本体）</p>
                                <button type="button" onClick={() => void reloadStock()} className="text-xs text-neutral-500">刷新图库</button>
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-2">
                                {stockImages.filter(img => !img.category || img.category === 'material').map(img => <button type="button" key={img.id} onClick={() => setSelectedStockUrl(img.url)} className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 ${selectedStockUrl === img.url ? 'border-neutral-500' : 'border-transparent'}`}>
                                    <img src={img.url} alt={img.tags.join(' ')} loading="lazy" className="w-full h-full object-cover" />
                                </button>)}
                            </div>
                            {!stockImages.filter(img => !img.category || img.category === 'material').length && <p className="text-xs text-slate-400">图库为空，可以先去「收纳 → 小红书图库」添加 URL 素材。</p>}
                        </div>
                        <div className="mt-3 rounded-xl border border-slate-100 p-3">
                            <label className="text-xs font-bold text-slate-600">从本地相册选择图片
                                <input type="file" accept="image/*" onChange={e => { void handleLocalPostPhoto(e.target.files?.[0]); e.target.value = ''; }} className="block w-full text-xs mt-2" />
                            </label>
                            {localPostImage && <div className="mt-2 flex items-center gap-3"><TokenImg value={localPostImage} className="w-20 h-20 rounded-lg object-cover" /><button type="button" onClick={() => setLocalPostImage('')} className="text-xs text-neutral-500">移除</button></div>}
                        </div>
                        {/* Sticker Selector - Flowing after text */}
                        <div className="mt-4 pt-4 border-t border-slate-50">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">添加心情贴纸 (Sticker)</p>
                            <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                                {STICKER_OPTIONS.map(sticker => (
                                    <button
                                        key={sticker.code}
                                        onClick={() => setNewPostEmoji(sticker.code)}
                                        className={`w-12 h-12 rounded-xl border flex items-center justify-center transition-all shrink-0 ${newPostEmoji === sticker.code ? 'border-[#555555] bg-neutral-50' : 'border-slate-100'}`}
                                    >
                                        <img src={twemojiUrl(sticker.code)} alt={sticker.label} className="w-7 h-7" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Main Feed View --- */}
            <div className={`flex-col h-full ${selectedPost || isCreateOpen ? 'hidden' : 'flex'}`}>
                
                {/* Top Nav - Glass —— 自理安全区：外层扛 safe-top + 背景（无固定高度，padding 正常撑开到刘海/灵动岛下），
                    内层保持 h-11 内容栏、文字居中。不能把 paddingTop 直接加到 h-11 上：border-box 会把 padding 吃进
                    固定高度，content-box 塌成 0，文字被挤到白条下沿、跨在白/渐变交界上被劈开。sticky 必须留在外层。 */}
                <div className="sticky top-0 z-30 bg-white/60 backdrop-blur-xl border-b border-white/20" style={{ paddingTop: 'var(--safe-top)' }}>
                    <div className="h-11 flex items-center justify-between px-4">
                        <button onClick={closeApp} className="p-1"><Icons.Back onClick={closeApp} /></button>
                        <div className="flex items-center gap-4 text-sm font-bold min-w-0">
                            <button type="button" onClick={() => { setActiveTab('home'); setFeedTab('following'); }} className={`flex items-center gap-1 ${activeTab === 'home' && feedTab === 'following' ? 'text-slate-900' : 'text-slate-400'}`}>
                                {(() => { const latest = feed.find(p => p.authorType === 'character' && isFollowing(p.authorName)); return latest ? <TokenImg value={latest.authorAvatar} className="w-6 h-6 rounded-full object-cover" /> : null; })()}
                                关注
                            </button>
                            <button type="button" onClick={() => { setActiveTab('home'); setFeedTab('discover'); }} className={`relative ${activeTab === 'home' && feedTab === 'discover' ? 'text-slate-900' : 'text-slate-400'}`}>发现{activeTab === 'home' && feedTab === 'discover' && <span className="absolute -bottom-2 left-1 right-1 h-0.5 bg-[#555555] rounded-full" />}</button>
                        </div>
                        <div className="flex items-center gap-3 text-xs shrink-0">
                            <button type="button" aria-label="搜索" onClick={() => { setSearchOpen(v => !v); setActiveTab('home'); setFeedTab('discover'); }} className="text-slate-600 text-xl">⌕</button>
                            <button type="button" onClick={() => setShowUtilityShelf(true)} className="text-slate-500">收纳</button>
                            <button type="button" onClick={() => setShowSettings(true)} className="text-slate-700 font-bold">设置</button>
                        </div>
                    </div>
                </div>

                {searchOpen && <div className="bg-white/90 border-b border-slate-100">
                    <div className="flex items-center gap-2 px-3 py-2">
                        <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setActiveTopic(null); }} placeholder="搜索笔记、话题、用户" className="flex-1 min-w-0 rounded-full bg-slate-100 px-3 py-2 text-sm outline-none" />
                        <button type="button" onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="text-slate-400 text-xs">取消</button>
                    </div>
                    {searchQuery.trim() && (matchingSparkAccounts.length > 0 || matchingSparkTopics.length > 0) && <div className="px-3 pb-2 max-h-36 overflow-y-auto space-y-1">
                        {matchingSparkAccounts.map(account => <button type="button" key={account.id}
                            onClick={() => { setViewedAccount({ handle: account.displayName, avatar: account.avatar || '', accountId: account.id }); setSearchOpen(false); }}
                            className="block w-full py-1 text-xs text-left text-slate-700">用户 · @{account.displayName}</button>)}
                        {matchingSparkTopics.map(topic => <button type="button" key={topic}
                            onClick={() => { setActiveTopic(topic); setSearchQuery(''); setSearchOpen(false); }}
                            className="block w-full py-1 text-xs text-left text-slate-700">话题 · #{topic}</button>)}
                    </div>}
                </div>}
                {activeTopic && activeTab === 'home' && <div className="flex items-center justify-between px-4 py-2 text-xs bg-white/85 border-b border-slate-100">
                    <span className="font-bold text-slate-600">#{activeTopic} 的相关笔记</span>
                    <button type="button" onClick={() => setActiveTopic(null)} className="text-slate-500">显示全部 ×</button>
                </div>}
                {/* Content Area */}
                <div ref={feedScrollRef} onTouchStart={onFeedTouchStart} onTouchMove={onFeedTouchMove} onTouchEnd={onFeedTouchEnd} onTouchCancel={onFeedTouchEnd} className="flex-1 overflow-y-auto no-scrollbar overscroll-y-contain">
                    
                    {activeTab === 'home' && (
                        <div className="p-2 min-h-full">
                            {(pullDistance > 0 || isRefreshing) && <div className="flex justify-center items-center overflow-hidden text-[#555555]" style={{ height: isRefreshing ? 40 : pullDistance }}>
                                <div className={`w-5 h-5 border-2 border-[#555555] border-t-transparent rounded-full ${isRefreshing ? 'animate-spin' : ''}`} style={{ transform: isRefreshing ? undefined : `rotate(${pullDistance * 5}deg)` }} />
                                <span className="text-xs ml-2">{isRefreshing ? '正在刷新…' : pullDistance >= 65 ? '松开刷新' : '下拉刷新'}</span>
                            </div>}
                            {/* 完整卡片占一个网格单元，避免多栏分片与 backdrop-filter/裁切组合丢失作者栏。 */}
                            <div className="columns-2 gap-2 pb-24">
                                {visibleFeed.filter(post => !hiddenPostIds.includes(post.id)).slice(0, visibleLimit).map(post => renderFeedItem(post))}
                            </div>
                            {visibleFeed.length > visibleLimit && <button type="button" onClick={() => setVisibleLimit(limit => limit + 40)} className="block mx-auto mt-2 mb-20 rounded-full border border-slate-200 bg-white px-6 py-2 text-sm text-slate-600">加载更多笔记</button>}
                            {visibleFeed.length === 0 && <p className="text-center text-xs text-slate-400 py-16">{searchQuery || activeTopic ? '没有找到相关笔记，试试别的关键词' : feedTab === 'following' ? '关注的账号暂时没有笔记' : '社区里还没有笔记，下拉刷新看看'}</p>}
                        </div>
                    )}

                    {activeTab === 'messages' && <div className="min-h-full bg-white pb-24">
                        <h2 className="text-center text-lg font-bold py-5">消息</h2>
                        {!noticeCategory ? <>
                            <div className="grid grid-cols-3 gap-2 px-4 py-5 border-b border-slate-100">
                                {([{ kind: 'likes', icon: '♥', label: '赞和收藏', color: 'bg-neutral-100 text-neutral-500' }, { kind: 'follows', icon: '●', label: '新增关注', color: 'bg-neutral-100 text-neutral-500' }, { kind: 'comments', icon: '●●', label: '评论和@', color: 'bg-neutral-100 text-neutral-500' }] as const).map(item => <button key={item.kind} type="button" onClick={() => { setNoticeCategory(item.kind); markNoticesRead(item.kind); }} className="flex flex-col items-center gap-2">
                                    <span className={`relative w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${item.color}`}>{item.icon}
                                        {notices.some(n => n.kind === item.kind && !n.read) && <span className="absolute -right-1 -top-1 w-3 h-3 rounded-full bg-[#555555]" />}
                                    </span><span className="text-xs text-slate-700">{item.label}</span>
                                </button>)}
                            </div>
                            <div className="px-5 pt-5 pb-2 flex items-center justify-between">
                                <h3 className="text-sm font-bold">私信 {Object.values(dmUnread).reduce((sum, count) => sum + count, 0) > 0 ? '(' + Object.values(dmUnread).reduce((sum, count) => sum + count, 0) + ')' : ''}</h3>
                            </div>
                            <div className="flex gap-2 px-5 pb-3">
                                {([{ id: 'all', label: '全部' }, { id: 'following', label: '已关注' }, { id: 'strangers', label: '陌生人' }] as const).map(tab => <button key={tab.id} type="button" onClick={() => setDmFilter(tab.id)} className={`rounded-full px-3 py-1 text-xs ${dmFilter === tab.id ? 'bg-[#555555] text-white' : 'bg-slate-100 text-slate-600'}`}>{tab.label}</button>)}
                            </div>
                            {Object.entries(dmThreads).filter(([handle, messages]) => messages.length > 0 &&
                                !communityState.mutedAccountIds.includes(communityState.accounts.find(a => a.id === handle)?.id ||
                                    resolveSparkDMAccount(communityState.accounts, handle)?.id || '') && (dmFilter === 'all' || (dmFilter === 'following' ? isFollowing(communityState.accounts.find(a => a.id === handle)?.displayName || handle) : !isFollowing(communityState.accounts.find(a => a.id === handle)?.displayName || handle)))).sort((a, b) => (b[1][b[1].length - 1]?.time || 0) - (a[1][a[1].length - 1]?.time || 0)).map(([handle, messages]) => {
                                const account = communityState.accounts.find(item => item.id === handle);
                                const displayHandle = account?.displayName || handle;
                                const accountPost = feed.find(post => account ? post.authorId === account.id : post.authorName === handle);
                                return <button key={handle} type="button" onClick={() => openSparkDM({ handle: displayHandle, avatar: accountPost?.authorAvatar || account?.avatar || '', accountId: account?.id })} className="w-full flex gap-3 items-center px-5 py-3 border-b border-slate-50 text-left">
                                    <span className="w-11 h-11 rounded-full bg-slate-100 overflow-hidden">{accountPost?.authorAvatar ? <TokenImg value={accountPost.authorAvatar} className="w-full h-full object-cover" /> : '✦'}</span>
                                    <span className="min-w-0 flex-1"><strong className="block text-sm truncate">{displayHandle}</strong><span className="block text-xs text-slate-400 truncate">{messages[messages.length - 1]?.content}</span></span>{(dmUnread[handle] || 0) > 0 && <span className="shrink-0 rounded-full bg-[#555555] text-white text-[10px] px-1.5 py-0.5">{dmUnread[handle] > 99 ? "99+" : dmUnread[handle]}</span>}
                                </button>;
                            })}
                            {!Object.values(dmThreads).some(messages => messages.length > 0) && <p className="px-5 py-6 text-xs text-slate-400">还没有私信，进入网友主页可以发起聊天</p>}

                        </> : <>
                            <button type="button" onClick={() => setNoticeCategory(null)} className="px-4 py-3 text-sm text-slate-600">‹ 返回消息</button>
                            <h3 className="px-4 pb-3 text-sm font-bold">{noticeCategory === 'likes' ? '赞和收藏' : noticeCategory === 'follows' ? '新增关注' : '评论和@'}</h3>
                            {noticeCategory === 'follows' && <div className="mx-4 mb-3 rounded-xl bg-neutral-50 p-4">
                                <p className="text-xs text-slate-500">主页粉丝总数</p>
                                <p className="text-2xl font-bold text-[#555555]">{communityState.follows.filter(follow => follow.followedId === 'user').length}</p>
                                <p className="text-xs text-slate-500 mt-2">按有明确账号身份的站内关注关系统计。</p>
                                {followerHistory.length > 0 && <p className="text-xs text-slate-400 mt-1">旧版模拟粉丝变动记录：{followerHistory.reduce((sum, item) => sum + item.count, 0)}（未计入真实粉丝）</p>}
                                <p className="text-xs text-slate-400 mt-1">下方列出有明确账号的关注者；其余增长只显示人数，不虚构昵称。</p>
                            </div>}
                            {noticeCategory === 'follows' && followerHistory.map(item => <div key={item.id} className="px-4 py-3 border-b border-slate-50 flex justify-between text-sm">
                                <span>帖子流量带来新增粉丝 <strong className="text-[#555555]">+{item.count}</strong></span>
                                <span className="text-xs text-slate-400">{new Date(item.time).toLocaleDateString()}</span>
                            </div>)}
                            {noticeGroups(noticeCategory).map(group => {
                                const unique = group.entries.filter((entry, index, all) => all.findIndex(item => item.actor === entry.actor) === index);
                                const shown = expandedNoticeGroups.includes(group.key) ? unique : unique.slice(0, 5);
                                const post = feed.find(p => p.id === group.entries[0]?.postId);
                                return <div key={group.key} className="border-b border-slate-100 px-4 py-3">
                                    {noticeCategory === 'likes' && <p className="text-xs text-slate-500 mb-2">你的笔记《{post?.title || '已删除的笔记'}》收到 {unique.length} 位用户的赞或收藏</p>}
                                    {noticeCategory === 'follows' && <p className="text-xs text-slate-500 mb-2">最近关注你的人 · {unique.length} 位</p>}
                                    <div className="flex flex-wrap gap-3">
                                        {shown.map(n => <button key={n.id} type="button" onClick={() => {
                                            const account = resolveSparkDMAccount(communityState.accounts, n.actor);
                                            const matches = communityState.accounts.filter(candidate => candidate.type !== 'user' &&
                                                (candidate.displayName === n.actor || candidate.aliases.includes(n.actor)));
                                            if (!account && matches.length > 1) {
                                                addToast('存在同名账号，无法确定这条旧通知的作者', 'info');
                                                return;
                                            }
                                            const accountPost = feed.find(p => account ? p.authorId === account.id : p.authorName === n.actor);
                                            if (accountPost || account) setViewedAccount({
                                                handle: account?.displayName || n.actor,
                                                avatar: n.avatar || accountPost?.authorAvatar || account?.avatar || '',
                                                accountId: account?.id || accountPost?.authorId,
                                            });
                                            else openSparkDM({ handle: n.actor, avatar: n.avatar || '' });
                                        }} className="flex items-center gap-1.5 max-w-[45%] min-w-0 text-left">
                                            <span className="w-8 h-8 shrink-0 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center">{n.avatar ? <TokenImg value={n.avatar} className="w-full h-full object-cover" /> : '✦'}</span>
                                            <span className="text-xs truncate">{n.actor}</span>
                                        </button>)}
                                    </div>
                                    {noticeCategory === 'comments' && <p className="text-xs text-slate-600 mt-2 whitespace-pre-wrap">{group.entries[0].content}</p>}
                                    {unique.length > 5 && <button type="button" onClick={() => setExpandedNoticeGroups(prev => prev.includes(group.key) ? prev.filter(key => key !== group.key) : [...prev, group.key])} className="text-xs text-[#555555] mt-3">{expandedNoticeGroups.includes(group.key) ? '收起' : '查看全部 ' + unique.length + ' 人 ›'}</button>}
                                    {post && <button type="button" onClick={() => handleOpenPost(post)} className="block text-xs text-slate-400 mt-2">查看原帖 ›</button>}
                                </div>;
                            })}
                            {!notices.some(n => n.kind === noticeCategory) && !(noticeCategory === 'follows' && followerHistory.length) && <p className="text-center py-16 text-xs text-slate-400">还没有收到相关消息</p>}
                        </>}
                    </div>}
                    {activeTab === 'me' && (
                        <div className="min-h-full bg-white/80 backdrop-blur-xl animate-fade-in">
                            {/* Profile Header (Enhanced) */}
                            <div className="relative group">
                                <div className="h-40 w-full overflow-hidden bg-slate-200 relative cursor-pointer" onClick={() => userBgInputRef.current?.click()}>
                                    {userBgImage ? (
                                        <TokenImg value={userBgImage} className="w-full h-full object-cover" />
                                    ) : (
                                        <TokenImg value={userProfile.avatar} className="w-full h-full object-cover blur-2xl opacity-60 scale-125" />
                                    )}
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                        <span className="text-white text-xs font-bold bg-black/30 px-3 py-1 rounded-full backdrop-blur-md">更换背景</span>
                                    </div>
                                    <input type="file" ref={userBgInputRef} className="hidden" accept="image/*" onChange={handleUserBgUpload} />
                                </div>
                                
                                <div className="px-6 relative -mt-12 flex justify-between items-end">
                                    {/* Social Avatar - Clickable to change */}
                                    <div className="w-24 h-24 rounded-full p-1 bg-white/90 backdrop-blur-md shadow-lg relative group cursor-pointer" onClick={() => socialAvatarInputRef.current?.click()}>
                                        <TokenImg value={socialProfile.avatar} className="w-full h-full rounded-full object-cover" />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-full">
                                            <span className="text-white text-[10px] font-bold">更换</span>
                                        </div>
                                        <input type="file" ref={socialAvatarInputRef} className="hidden" accept="image/*" onChange={handleSocialAvatarUpload} />
                                    </div>

                                    <div className="flex gap-2 mb-2">
                                        <button onClick={() => { setIsEditingId(!isEditingId); if(isEditingId) saveUserProfileChanges(); }} className="px-4 py-1.5 rounded-full border border-slate-200/60 bg-white/50 backdrop-blur-sm text-xs font-bold text-slate-600 hover:bg-white transition-colors">
                                            {isEditingId ? '保存资料' : '编辑资料'}
                                        </button>
                                        <button className="p-1.5 rounded-full border border-slate-200/60 bg-white/50 backdrop-blur-sm text-slate-600 hover:bg-white transition-colors"><Icons.Share className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="px-6 pt-4 pb-6">
                                {isEditingId ? (
                                    <input 
                                        value={socialProfile.name} 
                                        onChange={e => setSocialProfile({...socialProfile, name: e.target.value})}
                                        className="text-2xl font-black text-slate-800 bg-slate-100/50 px-2 rounded outline-none border-b border-dashed border-slate-300 w-full mb-1"
                                    />
                                ) : (
                                    <h2 className="text-2xl font-black text-slate-800">{socialProfile.name}</h2>
                                )}

                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-slate-400 font-mono">Spark ID: </span>
                                    {isEditingId ? (
                                        <input 
                                            value={userSparkId} 
                                            onChange={e => setUserSparkId(e.target.value)} 
                                            className="text-xs font-mono text-slate-600 bg-slate-100 px-1 rounded outline-none border-b border-primary w-24"
                                        />
                                    ) : (
                                        <span className="text-xs text-slate-400 font-mono">{userSparkId}</span>
                                    )}
                                </div>
                                
                                {isEditingId ? (
                                    <textarea 
                                        value={socialProfile.bio} 
                                        onChange={e => setSocialProfile({...socialProfile, bio: e.target.value})}
                                        className="w-full mt-3 text-sm text-slate-600 bg-slate-50 p-2 rounded-lg outline-none resize-none border border-slate-200 focus:border-primary/50"
                                        rows={3}
                                        placeholder="填写你的个人简介..."
                                    />
                                ) : (
                                    <p className="text-sm text-slate-600 mt-3 leading-relaxed font-light">{socialProfile.bio}</p>
                                )}

                                <div className="flex items-center gap-2 px-4">
                                    <button type="button" onClick={() => { setFanInput(String(fanCounts.user ?? 0)); setEditingFans(v => !v); }} className="text-xs text-neutral-500">旧版模拟粉丝展示值</button>
                                    {editingFans && <><input type="number" min="0" max="100000000" value={fanInput} onChange={e => setFanInput(e.target.value)} className="w-24 border rounded px-2 py-1 text-xs" />
                                    <button type="button" onClick={() => { const value = Number(fanInput); if (!Number.isFinite(value) || value < 0 || value > 100000000) return; setFanCounts(prev => { const next = { ...prev, user: Math.round(value) }; localStorage.setItem('spark_fan_counts', JSON.stringify(next)); return next; }); setEditingFans(false); }} className="text-xs font-bold text-neutral-500">保存</button></>}
                                </div>
                                {fanChanges.user !== undefined && <p className="text-xs text-center text-slate-500">旧版模拟粉丝变化（不计入真实粉丝）：{fanChanges.user > 0 ? '+' : ''}{fanChanges.user}</p>}
                                <div className="flex gap-6 mt-5 bg-white/40 p-4 rounded-2xl border border-white/50 shadow-sm">
                                    <div className="text-center"><span className="block font-bold text-slate-800">{communityState.follows.filter(follow => follow.followerId === 'user').length}</span><span className="text-[10px] text-slate-400">关注</span></div>
                                    <div className="text-center"><span className="block font-bold text-slate-800">{communityState.follows.filter(follow => follow.followedId === 'user').length}</span><span className="text-[10px] text-slate-400">粉丝</span></div>
                                    <div className="text-center"><span className="block font-bold text-slate-800">{feed.filter(post => post.authorType === 'user').reduce((sum, post) => sum + post.likes, 0)}</span><span className="text-[10px] text-slate-400">已记录点赞</span></div>
                                </div>
                            </div>

                            {/* Sticky Tabs */}
                            <div className="sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-slate-100 flex">
                                <button onClick={() => { setProfileTab('notes'); trackEvent('切换个人主页子标签', { tab: 'notes' }); }} className={`flex-1 py-3 text-sm font-bold transition-colors ${profileTab === 'notes' ? 'text-slate-900 border-b-2 border-[#555555]' : 'text-slate-400'}`}>笔记</button>
                                <button onClick={() => { setProfileTab('collects'); trackEvent('切换个人主页子标签', { tab: 'collects' }); }} className={`flex-1 py-3 text-sm font-bold transition-colors ${profileTab === 'collects' ? 'text-slate-900 border-b-2 border-[#555555]' : 'text-slate-400'}`}>收藏</button>
                            </div>

                            <div className="p-2 min-h-[300px] bg-slate-50/50 pb-24">
                                <div className="columns-2 gap-2 space-y-2">
                                    {feed.filter(p => profileTab === 'notes' ? (p.authorType === 'user' || (!p.authorType && p.authorName === socialProfile.name)) : p.isCollected).slice(0, profileVisibleLimit).map(post => (
                                        <div key={post.id} onClick={() => handleOpenPost(post)} className="break-inside-avoid bg-white rounded-xl overflow-hidden shadow-sm border border-slate-100 cursor-pointer">
                                            <div className="aspect-[4/5] flex items-center justify-center text-4xl" style={{ background: post.bgStyle }}>{postVisual(post.images[0], 'w-full h-full')}</div>
                                            <div className="p-3">
                                                <h4 className="text-xs font-bold text-slate-800 line-clamp-2 leading-tight">{post.title}</h4>
                                                <div className="flex justify-between items-center mt-2">
                                                    <div className="flex items-center gap-1"><TokenImg value={post.authorAvatar} className="w-3 h-3 rounded-full" /><span className="text-[9px] text-slate-400 truncate w-12">{post.authorName}</span></div>
                                                    <div className="flex items-center gap-0.5 text-slate-400"><Icons.Heart filled={post.isLiked} className="w-3 h-3" /><span className="text-[9px]">{post.likes}</span></div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {feed.filter(p => profileTab === 'notes' ? (p.authorType === 'user' || (!p.authorType && p.authorName === socialProfile.name)) : p.isCollected).length > profileVisibleLimit && <button type="button" onClick={() => setProfileVisibleLimit(n => n + 60)} className="block mx-auto mt-4 rounded-full border border-slate-200 px-5 py-2 text-xs text-slate-600">加载更早的笔记</button>}
                                {feed.filter(p => profileTab === 'notes' ? (p.authorType === 'user' || (!p.authorType && p.authorName === socialProfile.name)) : p.isCollected).length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-2">
                                        <Package size={48} className="text-slate-300 opacity-30" />
                                        <span className="text-xs">空空如也</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="absolute bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-100 flex items-center justify-around h-16" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                    <button onClick={() => { setActiveTab('home'); setFeedTab('discover'); }} className={`text-sm ${activeTab === 'home' ? 'text-slate-900 font-bold' : 'text-slate-400'}`}>首页</button>
                    <button onClick={() => setIsCreateOpen(true)} aria-label="发布笔记" className="w-14 h-12 bg-[#555555] rounded-xl text-white text-4xl leading-none">+</button>
                    <button onClick={() => setActiveTab('messages')} className={`text-sm ${activeTab === 'messages' ? 'text-slate-900 font-bold' : 'text-slate-400'}`}>消息</button>
                    <button onClick={() => setActiveTab('me')} className={`text-sm ${activeTab === 'me' ? 'text-slate-900 font-bold' : 'text-slate-400'}`}>我</button>
                </div>
            </div>

            {selectedPost && renderDetail()}
        </div>
    );
};

export default SocialApp;
import { useAppShortcut } from '../utils/appShortcutLaunch';
import { AppID as ShortcutAppID } from '../types';
