import { ContextBuilder } from '../utils/context';
import { loadCharacterContextMessages } from '../utils/chatContextRange';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, SocialPost, SocialComment, SubAccount, SocialAppProfile } from '../types';
import { buildSparkCommentHistory, buildSparkGenerationContext, getSparkHandles, resolveSparkAuthor, selectSparkParticipants } from '../utils/socialGeneration';
import { processImageToBlob } from '../utils/file';
import { putImageBlob } from '../utils/blobRef';
import Modal from '../components/os/Modal';
import { extractContent, safeResponseJson } from '../utils/safeApi';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../components/character/CharacterGroupFilter';
import { House, User, Package, Warning, Bell, MagnifyingGlass } from '@phosphor-icons/react';
import { canDeleteSocialPost, mergeSocialComments, prependUniqueSocialPosts, toggleSocialCommentLike, updateSocialPost } from '../utils/socialFeedMerge';
import { trackEvent } from '../utils/analytics';
import {
    createEmptySparkCommunityState, normalizeSparkCommunityState, mergeSparkCommunityStates,
    ensureSparkAccount, normalizeSparkPost, normalizeSparkName, toggleSparkFollow, toggleSparkInterest,
    addSparkNotification, markSparkNotificationsRead, appendSparkEvent, setSparkPostHidden,
    setSparkAccountMuted, markSparkPostSeen, rankSparkFeed, deriveSparkProfileStats,
} from '../utils/sparkCommunity';
import type { SparkCommunityState, SparkEventType, SparkNotificationType } from '../utils/sparkCommunity';
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
const BRAND_COLOR = '#ff2442'; // Premium Red

// Advanced Gradients for "Image" backgrounds
const POST_STYLES = [
    { name: 'Sunset', bg: 'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 99%, #FECFEF 100%)', text: '#fff' },
    { name: 'Ocean', bg: 'linear-gradient(120deg, #89f7fe 0%, #66a6ff 100%)', text: '#fff' },
    { name: 'Peach', bg: 'linear-gradient(to top, #fff1eb 0%, #ace0f9 100%)', text: '#555' },
    { name: 'Night', bg: 'linear-gradient(to top, #30cfd0 0%, #330867 100%)', text: '#fff' },
    { name: 'Love', bg: 'linear-gradient(to top, #f43b47 0%, #453a94 100%)', text: '#fff' },
    { name: 'Fresh', bg: 'linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)', text: '#444' },
    { name: 'Lemon', bg: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', text: '#fff' },
    { name: 'Plum', bg: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)', text: '#fff' },
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

type SparkPostDraft = { title: string; content: string; emoji: string };
type SparkCommentDraft = { content: string; replyToCommentId?: string };

const readSparkPostDraft = (): SparkPostDraft => {
    const empty = { title: '', content: '', emoji: '2728' };
    try {
        if (typeof localStorage === 'undefined') return empty;
        const raw = localStorage.getItem('spark_post_draft');
        if (!raw) return empty;
        const value = JSON.parse(raw);
        return {
            title: typeof value?.title === 'string' ? value.title : '',
            content: typeof value?.content === 'string' ? value.content : '',
            emoji: typeof value?.emoji === 'string' ? value.emoji : '2728',
        };
    } catch {
        return empty;
    }
};

const readSparkCommentDrafts = (): Record<string, SparkCommentDraft> => {
    try {
        if (typeof localStorage === 'undefined') return {};
        const value = JSON.parse(localStorage.getItem('spark_comment_drafts') || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        const drafts: Record<string, SparkCommentDraft> = {};
        Object.entries(value).forEach(([id, draft]: [string, any]) => {
            if (draft && typeof draft.content === 'string') {
                drafts[id] = {
                    content: draft.content,
                    ...(typeof draft.replyToCommentId === 'string' ? { replyToCommentId: draft.replyToCommentId } : {}),
                };
            }
        });
        return drafts;
    } catch {
        return {};
    }
};

const hasSparkCommunityCache = (): boolean => {
    try {
        return typeof localStorage !== 'undefined' && !!localStorage.getItem('spark_community_state');
    } catch {
        return false;
    }
};

const readSparkCommunityCache = (): SparkCommunityState => {
    try {
        if (typeof localStorage === 'undefined') return createEmptySparkCommunityState();
        const raw = localStorage.getItem('spark_community_state');
        return raw ? normalizeSparkCommunityState(JSON.parse(raw)) : createEmptySparkCommunityState();
    } catch {
        return createEmptySparkCommunityState();
    }
};

const createSparkId = (prefix = 'id'): string =>
    prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);

// --- Icons ---

const Icons = {
    Heart: ({ filled, onClick, className }: { filled?: boolean, onClick?: (e: any) => void, className?: string }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? BRAND_COLOR : "none"} stroke={filled ? BRAND_COLOR : "currentColor"} strokeWidth={2} className={`transition-transform active:scale-75 cursor-pointer ${className || "w-6 h-6"}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
        </svg>
    ),
    Star: ({ filled, onClick, className }: { filled?: boolean, onClick?: (e: any) => void, className?: string }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? "#fbbf24" : "none"} stroke={filled ? "#fbbf24" : "currentColor"} strokeWidth={2} className={`transition-transform active:scale-75 cursor-pointer ${className || "w-6 h-6"}`}>
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
    const { closeApp, characters, updateCharacter, apiConfig, addToast, userProfile, groups, characterGroups } = useOS();
    const [feed, setFeed] = useState<SocialPost[]>([]);
    const [hasInitialCommunityCache] = useState<boolean>(hasSparkCommunityCache);
    const [communityState, setCommunityState] = useState<SparkCommunityState>(readSparkCommunityCache);
    const [communityLoaded, setCommunityLoaded] = useState<boolean>(hasInitialCommunityCache);
    const communityStateRef = useRef(communityState);
    const communityCachePresentRef = useRef(hasInitialCommunityCache);
    const communityMutationVersionRef = useRef(0);
    const communityPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
    const [feedMode, setFeedMode] = useState<'discover' | 'following'>('discover');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTopic, setActiveTopic] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [showNotifications, setShowNotifications] = useState(false);
    const [activePostMenuId, setActivePostMenuId] = useState<string | null>(null);
    // Modes: 'home' (Feed) | 'me' (Profile) | 'create' (Modal Overlay)
    const [activeTab, setActiveTab] = useState<'home' | 'me'>('home');
    useAppShortcut(ShortcutAppID.Social, intent => { setSelectedPost(null); setIsCreateOpen(false); setShowSettings(false); setActiveTab(intent.entryId === 'me' ? 'me' : 'home'); });
    const [isCreateOpen, setIsCreateOpen] = useState(false); 
    
    const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [loadingComments, setLoadingComments] = useState(false);
    
    // Post Creation State — restore the last local draft before the first render.
    const [initialDraft] = useState<SparkPostDraft>(readSparkPostDraft);
    const [newPostTitle, setNewPostTitle] = useState(initialDraft.title);
    const [newPostContent, setNewPostContent] = useState(initialDraft.content);
    const [newPostEmoji, setNewPostEmoji] = useState(initialDraft.emoji);

    // Comment Input State
    const [commentInput, setCommentInput] = useState('');
    const [replyTarget, setReplyTarget] = useState<SocialComment | null>(null);
    const [isReplyingToUser, setIsReplyingToUser] = useState(false);

    // Settings / Handle Management
    const [showSettings, setShowSettings] = useState(false);
    const [characterHandles, setCharacterHandles] = useState<Record<string, SubAccount[]>>({});
    const [identityGroupId, setIdentityGroupId] = useState(GROUP_FILTER_ALL); // 身份管理弹窗的角色分组筛选

    // Sharing State
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareGroupId, setShareGroupId] = useState(GROUP_FILTER_ALL); // 分享帖子弹窗的角色分组筛选

    // Profile Sub-tab
    const [profileTab, setProfileTab] = useState<'notes' | 'collects'>('notes');

    // User Custom Profile State (Local - Decoupled from Global UserProfile)
    const [socialProfile, setSocialProfile] = useState<SocialAppProfile>({
        name: userProfile.name,
        avatar: userProfile.avatar,
        bio: '这个人很懒，什么都没写。'
    });
    const [userSparkId, setUserSparkId] = useState('95279527');
    const [userBgImage, setUserBgImage] = useState('');
    const [isEditingId, setIsEditingId] = useState(false);
    const visibleFeed = useMemo(() => rankSparkFeed(feed, communityState, {
        mode: feedMode,
        query: searchQuery,
        topic: activeTopic,
        accountId: selectedAccountId,
        userDisplayName: socialProfile.name,
    }), [feed, communityState, feedMode, searchQuery, activeTopic, selectedAccountId, socialProfile.name]);

    const profileStats = useMemo(
        () => deriveSparkProfileStats(feed, communityState, socialProfile.name),
        [feed, communityState, socialProfile.name],
    );

    const unreadNotifications = useMemo(
        () => communityState.notifications
            .filter(notification => notification.targetAccountId === 'user' && !notification.readAt)
            .sort((a, b) => b.createdAt - a.createdAt),
        [communityState.notifications],
    );

    const matchingAccounts = useMemo(() => {
        const query = normalizeSparkName(searchQuery);
        if (!query) return [];
        return communityState.accounts
            .filter(account => account.id !== 'user' &&
                [account.displayName, ...account.aliases].some(name => normalizeSparkName(name).includes(query)))
            .slice(0, 5);
    }, [communityState.accounts, searchQuery]);

    const availableTopics = useMemo(() => {
        const topics = new Map<string, string>();
        feed.forEach(post => [...(post.tags || []), ...(post.topicIds || [])].forEach(rawTopic => {
            const topic = String(rawTopic || '').trim();
            const normalized = normalizeSparkName(topic);
            if (topic && !['user', 'life', 'vlog'].includes(normalized) && !topics.has(normalized)) {
                topics.set(normalized, topic);
            }
        }));
        return [...topics.values()];
    }, [feed]);

    const matchingTopics = useMemo(() => {
        const query = normalizeSparkName(searchQuery);
        return query ? availableTopics.filter(topic => normalizeSparkName(topic).includes(query)).slice(0, 6) : [];
    }, [availableTopics, searchQuery]);
    
    const userBgInputRef = useRef<HTMLInputElement>(null);
    const socialAvatarInputRef = useRef<HTMLInputElement>(null);

    // Refs
    const commentsEndRef = useRef<HTMLDivElement>(null);
    const detailScrollRef = useRef<HTMLDivElement>(null);
    const prevCommentCountRef = useRef(0); // Track comment count to prevent initial jump
    const feedRef = useRef<SocialPost[]>([]);
    const mountedRef = useRef(true);
    const refreshRequestRef = useRef<AbortController | null>(null);
    const commentRequestRef = useRef<{ postId: string; controller: AbortController } | null>(null);
    const replyRequestRef = useRef<{ postId: string; controller: AbortController } | null>(null);
    const replyQueueRef = useRef<Array<{ postId: string; commentId: string; content: string }>>([]);
    const replyWorkerRunningRef = useRef(false);
    const commentSubmitLockRef = useRef(false);
    const createPostLockRef = useRef(false);
    const feedLoadGenerationRef = useRef(0);
    const socialPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
    const commentDraftsRef = useRef<Record<string, SparkCommentDraft>>(readSparkCommentDrafts());

    const updateCommunityState = (updater: SparkCommunityState | ((current: SparkCommunityState) => SparkCommunityState)) => {
        const next = typeof updater === 'function' ? updater(communityStateRef.current) : updater;
        communityStateRef.current = next;
        communityMutationVersionRef.current += 1;
        setCommunityState(next);
        const serialized = JSON.stringify(next);
        try {
            localStorage.setItem('spark_community_state', serialized);
        } catch (error) {
            console.warn('Spark community cache could not be saved locally', error);
        }
        const write = communityPersistenceQueueRef.current.then(
            () => DB.saveAsset('spark_community_state', serialized),
            () => DB.saveAsset('spark_community_state', serialized),
        );
        communityPersistenceQueueRef.current = write.catch(error => console.error('Spark community persistence failed', error));
        return next;
    };

    useEffect(() => {
        if (communityCachePresentRef.current) {
            setCommunityLoaded(true);
            const serialized = JSON.stringify(communityStateRef.current);
            void DB.saveAsset('spark_community_state', serialized).catch(error => console.error(error));
            return;
        }
        let active = true;
        const versionAtStart = communityMutationVersionRef.current;
        DB.getAsset('spark_community_state').then(raw => {
            if (!active || !raw) return;
            let persisted: SparkCommunityState;
            try {
                persisted = normalizeSparkCommunityState(JSON.parse(raw));
            } catch {
                persisted = createEmptySparkCommunityState();
            }
            if (communityMutationVersionRef.current === versionAtStart) {
                communityStateRef.current = persisted;
                setCommunityState(persisted);
                try { localStorage.setItem('spark_community_state', JSON.stringify(persisted)); } catch { /* cache is optional */ }
            } else {
                updateCommunityState(mergeSparkCommunityStates(persisted, communityStateRef.current, true));
            }
        }).catch(error => {
            console.warn('Spark community state could not be loaded', error);
        }).finally(() => {
            if (active) setCommunityLoaded(true);
        });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            refreshRequestRef.current?.abort();
            commentRequestRef.current?.controller.abort();
            replyRequestRef.current?.controller.abort();
            refreshRequestRef.current = null;
            commentRequestRef.current = null;
            replyRequestRef.current = null;
            replyQueueRef.current = [];
        };
    }, []);

    useEffect(() => {
        try {
            if (newPostTitle.trim() || newPostContent.trim()) {
                localStorage.setItem('spark_post_draft', JSON.stringify({ title: newPostTitle, content: newPostContent, emoji: newPostEmoji, updatedAt: Date.now() }));
            } else {
                localStorage.removeItem('spark_post_draft');
            }
        } catch (error) {
            console.warn('Spark draft could not be saved locally', error);
        }
    }, [newPostTitle, newPostContent, newPostEmoji]);

    useEffect(() => {
        const loadGeneration = feedLoadGenerationRef.current;
        DB.getSocialPosts().then(posts => {
            if (!mountedRef.current || feedLoadGenerationRef.current !== loadGeneration) return;
            if (posts.length > 0) {
                let nextCommunity = communityStateRef.current;
                const normalizedLive = feedRef.current.map(post => {
                    const result = normalizeAndRegisterPost(post, nextCommunity);
                    nextCommunity = result.state;
                    return result.post;
                });
                const sorted = [...posts].sort((a, b) => b.timestamp - a.timestamp);
                const normalizedSaved = sorted.map(post => {
                    const result = normalizeAndRegisterPost(post, nextCommunity);
                    nextCommunity = result.state;
                    return result.post;
                });
                // Keep live versions of posts changed while the IndexedDB read was pending.
                const liveIds = new Set(normalizedLive.map(post => post.id));
                const next = [...normalizedLive, ...normalizedSaved.filter(post => !liveIds.has(post.id))];
                feedRef.current = next;
                setFeed(next);
                if (nextCommunity !== communityStateRef.current) updateCommunityState(nextCommunity);
                const originalById = new Map(posts.map(post => [post.id, post]));
                normalizedSaved.forEach(post => {
                    const original = originalById.get(post.id);
                    if (original && JSON.stringify(original) !== JSON.stringify(post)) {
                        void enqueueSocialPersistence(() => DB.saveSocialPost(post)).catch(error => console.error(error));
                    }
                });
            }
        }).catch(error => {
            if (mountedRef.current) addToast('读取 Spark 帖子失败：' + (error?.message || error), 'error');
        });
        
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
                    name: userProfile.name,
                    avatar: userProfile.avatar,
                    bio: userProfile.bio || '这个人很懒，什么都没写。'
                });
            }
        };
        loadAssets();

        // Load Handles
        const savedHandles = localStorage.getItem('spark_char_handles');
        let initialHandles: Record<string, SubAccount[]> = {};
        if (savedHandles) {
            try { initialHandles = JSON.parse(savedHandles); } catch(e) {}
        }
        
        // Ensure every character has at least one default handle
        characters.forEach(c => {
            if (!initialHandles[c.id] || initialHandles[c.id].length === 0) {
                initialHandles[c.id] = [{ 
                    id: 'default', 
                    handle: c.socialProfile?.handle || c.name, 
                    note: '主账号' 
                }];
            }
        });
        setCharacterHandles(initialHandles);

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

    const enqueueSocialPersistence = (operation: () => Promise<void>): Promise<void> => {
        const next = socialPersistenceQueueRef.current.then(operation, operation);
        socialPersistenceQueueRef.current = next.catch(error => {
            console.error('Spark persistence failed', error);
        });
        return next;
    };

    const persistCommentDrafts = () => {
        try {
            const saved = Object.fromEntries(Object.entries(commentDraftsRef.current).filter(([, draft]) =>
                draft.content.trim() || draft.replyToCommentId
            ));
            if (Object.keys(saved).length) localStorage.setItem('spark_comment_drafts', JSON.stringify(saved));
            else localStorage.removeItem('spark_comment_drafts');
        } catch (error) {
            console.warn('Spark comment draft could not be saved locally', error);
        }
    };

    const accountCandidateFor = (
        authorName: string,
        authorAvatar?: string,
        authorType?: SocialPost['authorType'] | SocialComment['authorType'],
        authorCharId?: string,
        authorId?: string,
    ) => {
        const normalizedName = normalizeSparkName(authorName || '');
        const matchesUser = normalizedName === normalizeSparkName(socialProfile.name) ||
            normalizedName === normalizeSparkName(userProfile.name);
        const matchedChar = (authorCharId ? characters.find(char => char.id === authorCharId) : undefined) ||
            characters.find(char => getSparkHandles(char, characterHandles).some(handle =>
                normalizeSparkName(handle.handle) === normalizedName
            ));
        if (authorType === 'user' || (!authorType && matchesUser)) {
            return { id: 'user', type: 'user' as const, displayName: authorName, avatar: authorAvatar };
        }
        if (authorType === 'character' || authorCharId || (!authorType && matchedChar)) {
            const ownerCharId = authorCharId || matchedChar?.id;
            if (ownerCharId) {
                const handle = matchedChar
                    ? getSparkHandles(matchedChar, characterHandles).find(item => normalizeSparkName(item.handle) === normalizedName)
                    : undefined;
                const parsedHandleId = authorId && authorId.includes(':handle:')
                    ? authorId.split(':handle:').slice(1).join(':')
                    : undefined;
                return {
                    id: authorId,
                    type: 'character' as const,
                    ownerCharId,
                    handleId: handle?.id || parsedHandleId || ('legacy-' + normalizedName),
                    displayName: authorName,
                    avatar: authorAvatar,
                };
            }
        }
        return { id: authorId, type: 'stranger' as const, displayName: authorName, avatar: authorAvatar };
    };

    const normalizeAndRegisterPost = (post: SocialPost, state: SparkCommunityState) => {
        const normalized = normalizeSparkPost(post, [socialProfile.name, userProfile.name]);
        const authorCandidate = accountCandidateFor(
            normalized.authorName, normalized.authorAvatar, post.authorType, normalized.authorCharId, normalized.authorId,
        );
        const authorResult = ensureSparkAccount(state, authorCandidate, () => createSparkId('account'), normalized.timestamp || Date.now());
        let nextState = authorResult.state;
        const comments = normalized.comments.map(comment => {
            const candidate = accountCandidateFor(
                comment.authorName, comment.authorAvatar, comment.authorType, comment.authorCharId, comment.authorId,
            );
            const result = ensureSparkAccount(nextState, candidate, () => createSparkId('account'), comment.timestamp || normalized.timestamp || Date.now());
            nextState = result.state;
            return {
                ...comment,
                authorType: result.account.type,
                authorId: result.account.id,
                ...(result.account.ownerCharId ? { authorCharId: result.account.ownerCharId } : {}),
            };
        });
        return {
            post: {
                ...normalized,
                authorType: authorResult.account.type,
                authorId: authorResult.account.id,
                ...(authorResult.account.ownerCharId ? { authorCharId: authorResult.account.ownerCharId } : {}),
                comments,
            } as SocialPost,
            state: nextState,
        };
    };

    const registerSparkComments = (comments: SocialComment[]): SocialComment[] => {
        let nextState = communityStateRef.current;
        const registered = comments.map(comment => {
            const candidate = accountCandidateFor(comment.authorName, comment.authorAvatar, comment.authorType, comment.authorCharId, comment.authorId);
            const result = ensureSparkAccount(nextState, candidate, () => createSparkId('account'), comment.timestamp || Date.now());
            nextState = result.state;
            return {
                ...comment,
                authorType: result.account.type,
                authorId: result.account.id,
                ...(result.account.ownerCharId ? { authorCharId: result.account.ownerCharId } : {}),
            };
        });
        if (nextState !== communityStateRef.current) updateCommunityState(nextState);
        return registered;
    };

    useEffect(() => {
        if (!communityLoaded) return;
        const result = ensureSparkAccount(communityStateRef.current, {
            id: 'user',
            type: 'user',
            displayName: socialProfile.name,
            avatar: socialProfile.avatar,
            bio: socialProfile.bio,
        }, () => createSparkId('account'), Date.now());
        if (JSON.stringify(result.state.accounts) !== JSON.stringify(communityStateRef.current.accounts)) {
            updateCommunityState(result.state);
        }
    }, [communityLoaded, socialProfile.name, socialProfile.avatar, socialProfile.bio]);

    const recordCommunityEvent = (
        type: SparkEventType,
        actorAccountId: string,
        fields: { targetAccountId?: string; postId?: string; commentId?: string; metadata?: Record<string, string | number | boolean | null> } = {},
    ) => {
        updateCommunityState(state => appendSparkEvent(state, {
            ...fields,
            id: createSparkId('event'),
            type,
            actorAccountId,
            createdAt: Date.now(),
        }));
    };

    const notifyUser = (
        type: SparkNotificationType,
        actorAccountId: string,
        message: string,
        postId?: string,
        commentId?: string,
    ) => {
        updateCommunityState(state => addSparkNotification(state, {
            id: createSparkId('notification'),
            type,
            actorAccountId,
            targetAccountId: 'user',
            message,
            createdAt: Date.now(),
            ...(postId ? { postId } : {}),
            ...(commentId ? { commentId } : {}),
        }));
    };

    const toggleFollowAccount = (accountId: string, displayName: string) => {
        if (!accountId || accountId === 'user') return;
        const result = toggleSparkFollow(communityStateRef.current, 'user', accountId, Date.now(), createSparkId('event'));
        if (result.action === 'noop') return;
        updateCommunityState(result.state);
        addToast(result.action === 'follow' ? '已关注 @' + displayName : '已取消关注 @' + displayName, 'success');
        trackEvent('Spark 关注关系变化', { action: result.action, accountId });
    };

    const handleToggleTopicInterest = (topic: string) => {
        const result = toggleSparkInterest(communityStateRef.current, topic, Date.now(), createSparkId('event'));
        if (result.action === 'noop') return;
        updateCommunityState(result.state);
        addToast(result.action === 'follow' ? '已关注话题 #' + topic : '已取消关注话题 #' + topic, 'success');
    };

    const recordGeneratedComments = (post: SocialPost, comments: SocialComment[], isReply = false) => {
        let nextState = communityStateRef.current;
        const createdAt = Date.now();
        comments.forEach(comment => {
            nextState = appendSparkEvent(nextState, {
                id: createSparkId('event'),
                type: 'comment_created',
                actorAccountId: comment.authorId || 'unknown',
                targetAccountId: post.authorId,
                postId: post.id,
                commentId: comment.id,
                createdAt,
            });
            if (isReply || post.authorId === 'user' || post.authorType === 'user') {
                nextState = addSparkNotification(nextState, {
                    id: createSparkId('notification'),
                    type: isReply ? 'reply' : 'comment',
                    actorAccountId: comment.authorId || 'unknown',
                    targetAccountId: 'user',
                    postId: post.id,
                    commentId: comment.id,
                    message: isReply
                        ? '@' + comment.authorName + ' 回复了你的评论'
                        : '@' + comment.authorName + ' 评论了你的帖子',
                    createdAt,
                });
            }
        });
        if (nextState !== communityStateRef.current) updateCommunityState(nextState);
    };

    const handleCommentInputChange = (value: string) => {
        setCommentInput(value);
        if (!selectedPost) return;
        const current = commentDraftsRef.current[selectedPost.id] || { content: '' };
        commentDraftsRef.current = {
            ...commentDraftsRef.current,
            [selectedPost.id]: { ...current, content: value, ...(replyTarget ? { replyToCommentId: replyTarget.id } : {}) },
        };
        persistCommentDrafts();
    };

    const handleSetReplyTarget = (comment: SocialComment | null) => {
        setReplyTarget(comment);
        if (!selectedPost) return;
        const current = commentDraftsRef.current[selectedPost.id] || { content: commentInput };
        const next: SparkCommentDraft = { ...current };
        if (comment) next.replyToCommentId = comment.id;
        else delete next.replyToCommentId;
        commentDraftsRef.current = { ...commentDraftsRef.current, [selectedPost.id]: next };
        persistCommentDrafts();
    };

    const prependPostsToFeed = (newPosts: SocialPost[]) => {
        const existingIds = new Set(feedRef.current.map(post => post.id));
        let nextCommunity = communityStateRef.current;
        const normalizedPosts = newPosts.map(post => {
            const result = normalizeAndRegisterPost(post, nextCommunity);
            nextCommunity = result.state;
            return result.post;
        });
        const fresh = normalizedPosts.filter(post => !existingIds.has(post.id));
        const eventTime = Date.now();
        fresh.forEach(post => {
            nextCommunity = appendSparkEvent(nextCommunity, {
                id: createSparkId('event'),
                type: 'post_created',
                actorAccountId: post.authorId || 'unknown',
                postId: post.id,
                createdAt: eventTime,
            });
        });
        if (nextCommunity !== communityStateRef.current) updateCommunityState(nextCommunity);
        const next = prependUniqueSocialPosts(feedRef.current, normalizedPosts);
        feedRef.current = next;
        setFeed(next);
        // Serialize writes so a late save cannot resurrect a post after Clear Feed.
        fresh.forEach(post => {
            void enqueueSocialPersistence(() => DB.saveSocialPost(post)).catch(error => console.error(error));
        });
    };

    const updatePostInFeed = (postId: string, updater: (post: SocialPost) => SocialPost): SocialPost | undefined => {
        const result = updateSocialPost(feedRef.current, postId, updater);
        if (!result.post) return undefined;
        feedRef.current = result.feed;
        setFeed(result.feed);
        setSelectedPost(current => (current?.id === postId ? result.post! : current));
        void enqueueSocialPersistence(() => DB.saveSocialPost(result.post!)).catch(error => console.error(error));
        return result.post;
    };

    const removePostFromFeed = (postId: string) => {
        const next = feedRef.current.filter(p => p.id !== postId);
        feedRef.current = next;
        setFeed(next);
        void enqueueSocialPersistence(() => DB.deleteSocialPost(postId)).catch(error => {
            addToast('删除帖子失败：' + (error?.message || error), 'error');
        });
        setSelectedPost(current => (current?.id === postId ? null : current));
    };

    // --- AI Logic (Updated for Multi-Handle) ---
    const buildGenerationContext = async (participants: CharacterProfile[]) => {
        const recent = await Promise.all(participants.map(async char =>
            [char.id, await loadCharacterContextMessages(char)] as const));
        return buildSparkGenerationContext(participants.map(char => ({ ...char, mountedWorldbooks: [] })), userProfile, socialProfile, characterHandles, Object.fromEntries(recent));
    };

    const buildGenerationMessages = (members: CharacterProfile[], context: string, prompt: string) => {
        const history = [{ role: 'user', content: prompt }];
        return ContextBuilder.buildGroupWorldbookRequest({ members, user: userProfile, history,
            render: (slots, turns) => [{ role: 'system', content: slots.before + context + slots.after }, ...turns],
        });
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

            const prompt = `### 任务: 模拟社交APP "Spark" 的推荐流
你需要生成 6-8 条新的社交媒体帖子。

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
    "tags": ["与正文相关的话题1", "与正文相关的话题2"]
  },
  ...
]`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: buildGenerationMessages(selectedChars, context, prompt), temperature: 0.8, max_tokens: 8000 }),
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
                if (!author || typeof item.content !== 'string' || !item.content.trim()) return [];
                item = { ...item, authorName: author.name };
                let avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${item.authorName}`;
                const matchedChar = author.character;
                if (matchedChar) avatar = matchedChar.avatar;
                const isCharacterPost = !!matchedChar;
                if (!isCharacterPost) {
                    const seeds = ['micah', 'avataaars', 'bottts', 'notionists'];
                    avatar = `https://api.dicebear.com/7.x/${seeds[Math.floor(Math.random() * seeds.length)]}/svg?seed=${item.authorName + Math.random()}`;
                }
                // Normalize emoji content. AI usually returns real emoji chars; fall back to a ✨ char (not codepoint) for safety.
                const rawEmojis = Array.isArray(item.emojis) && item.emojis.length > 0 ? item.emojis : ['✨'];
                const images = rawEmojis.map((e: any) => codepointToEmoji(String(e ?? '✨')));
                const tags = Array.isArray(item.tags)
                    ? [...new Set(item.tags.filter((tag: any) => typeof tag === 'string').map((tag: string) => tag.trim().replace(/^#/, '').slice(0, 20)).filter(Boolean))].slice(0, 4)
                    : [];
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
                    comments: [],
                    timestamp: Date.now(),
                    tags: tags.length ? tags : ['日常'],
                    bgStyle: getRandomStyle().bg,
                    authorType: isCharacterPost ? 'character' as const : 'stranger' as const,
                    authorCharId: matchedChar?.id,
                    authorId: author.accountId,
                    source: 'ai',
                }];
            });
            if (!newPosts.length) throw new Error('模型返回的作者身份不匹配，未添加帖子');
            prependPostsToFeed(newPosts);
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

    const generateComments = async (post: SocialPost) => {

        if (!post || !apiConfig.apiKey) return;
        const livePost = feedRef.current.find(item => item.id === post.id) || post;
        if (livePost.comments.length > 0) return;
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

请基于上面的【标题 + 正文】生成 4-6 条评论，评论要切实回应正文里提到的内容，不要只对着标题空泛地说。混合使用 **选定角色** 和 **随机路人**。
角色评论时，请选择一个符合语境的马甲身份。

### 禁令
- **绝对禁止** 生成 \`author\` 等于或近似 "${socialProfile.name}" (用户) 的评论。
- 路人评论的 \`author\` 必须是全新的网名，绝对不能与上方【角色身份库】中列出的任何马甲网名重合。

### 输出格式 (JSON Array)
[
  { "author": "网名 (Handle) 或 路人昵称", "charId": "角色ID或null", "content": "评论内容..." }
]`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: buildGenerationMessages(selectedChars, context, prompt), temperature: 0.8 }),
                signal: controller.signal,
                __sullyMeta: { appId: 'social', appName: 'Spark', purpose: '生成帖子评论' },
            } as RequestInit);
            if (!response.ok) throw new Error(await apiErrorMessage(response));
            const data = await safeResponseJson(response);
            if (controller.signal.aborted) return;
            const json = safeParseJSON(extractContent(data));
            if (Array.isArray(json)) {
                const comments: SocialComment[] = json
                    .flatMap((c: any) => {
                        const author = resolveSparkAuthor(c, selectedChars, characters, characterHandles, [socialProfile.name, userProfile.name]);
                        if (!author || typeof c.content !== 'string' || !c.content.trim()) return [];
                        const authorName = author.name;
                        let avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${authorName}`;
                        const char = author.character;
                        if (char) avatar = char.avatar;
                        return [{
                            id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                            authorName: authorName,
                            authorAvatar: avatar,
                            content: c.content || '...',
                            likes: 0,
                            isCharacter: !!char,
                            authorType: char ? 'character' : 'stranger',
                            authorCharId: char?.id,
                            authorId: author.accountId,
                            timestamp: Date.now(),
                        } as SocialComment];
                    });
                if (!comments.length) throw new Error('模型返回的评论身份不匹配，未添加评论');
                const registeredComments = registerSparkComments(comments);
                const updatedPost = updatePostInFeed(post.id, current => ({
                    ...current,
                    comments: mergeSocialComments(current.comments || [], registeredComments),
                }));
                if (updatedPost) recordGeneratedComments(updatedPost, registeredComments);
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

    const generateRepliesToUser = async (postId: string, userCommentId: string, userContent: string) => {
        if (!apiConfig.apiKey) {
            addToast('请先配置 API Key；你的评论已保存，之后可以继续互动。', 'error');
            return;
        }
        let post = feedRef.current.find(item => item.id === postId);
        let userComment = post?.comments.find(comment => comment.id === userCommentId);
        if (!post || !userComment) return;
        const controller = new AbortController();
        replyRequestRef.current = { postId, controller };
        try {
            const selectedChars = selectSparkParticipants(post, [...characters].sort(() => 0.5 - Math.random()), characterHandles);
            const context = await buildGenerationContext(selectedChars);
            if (controller.signal.aborted) return;
            const latestPost = feedRef.current.find(item => item.id === postId);
            if (!latestPost) return;
            post = latestPost;
            const latestUserComment = post.comments.find(comment => comment.id === userCommentId);
            if (!latestUserComment) return;
            userComment = latestUserComment;

            const parentComment = userComment.parentCommentId
                ? post.comments.find(comment => comment.id === userComment.parentCommentId)
                : undefined;
            const prompt = [
                '### 任务：在 Spark 评论区继续真实、连贯的对话',
                '帖子楼主：' + post.authorName + '（' + (post.authorType || 'legacy') + '）',
                '帖子标题：' + post.title,
                '帖子正文：' + (post.content || '（无正文）'),
                parentComment ? '用户正在回复 @' + parentComment.authorName + ' 的评论：' + parentComment.content : '用户正在发表顶层评论。',
                '用户刚发表的评论 ID：' + userCommentId,
                '用户评论内容：' + userContent,
                '已有评论与回复历史（必须结合上下文，不要复述已有回复）：',
                buildSparkCommentHistory(post),
                '请生成 1-3 条真正回应这条新评论的回复。可以由楼主或此前参与对话的角色继续回复；同一个角色可以在不同轮次继续发言，但不得重复回答同一条评论。',
                '每条回复必须属于本次角色档案中的正确身份，不能冒充用户，不能把私聊内容公开，也不能编造没有记录的共同经历。',
                '输出 JSON 数组，每项包含 author、charId（路人填 null）、content。不要生成 likes、粉丝数或其他虚构互动计数。',
            ].join('\n');

            const response = await fetch(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
                body: JSON.stringify({ model: apiConfig.model, messages: buildGenerationMessages(selectedChars, context, prompt), temperature: 0.8 }),
                signal: controller.signal,
                __sullyMeta: { appId: 'social', appName: 'Spark', purpose: '回复用户评论' },
            } as RequestInit);
            if (!response.ok) throw new Error(await apiErrorMessage(response));
            const data = await safeResponseJson(response);
            if (controller.signal.aborted) return;
            const json = safeParseJSON(extractContent(data));
            if (Array.isArray(json)) {
                const newReplies: SocialComment[] = json
                    .flatMap((c: any, index: number) => {
                        const author = resolveSparkAuthor(c, selectedChars, characters, characterHandles, [socialProfile.name, userProfile.name]);
                        if (!author || typeof c.content !== 'string' || !c.content.trim()) return [];
                        const authorName = author.name;
                        const char = author.character;
                        const avatar = char ? char.avatar : 'https://api.dicebear.com/7.x/notionists/svg?seed=' + authorName;
                        return [{
                            id: 'cmt-reply-' + userCommentId + '-' + (index + 1),
                            authorName,
                            authorAvatar: avatar,
                            content: c.content.trim(),
                            likes: 0,
                            isCharacter: !!char,
                            authorType: char ? 'character' as const : 'stranger' as const,
                            authorCharId: char?.id,
                            authorId: author.accountId,
                            timestamp: Date.now() + index,
                            parentCommentId: userCommentId,
                            replyToAuthorName: socialProfile.name,
                        } as SocialComment];
                    });
                if (!newReplies.length) throw new Error('模型返回的回复身份不匹配，未添加回复');
                const registeredReplies = registerSparkComments(newReplies);
                const updatedPost = updatePostInFeed(postId, current => ({
                    ...current,
                    comments: mergeSocialComments(current.comments || [], registeredReplies),
                }));
                if (updatedPost) recordGeneratedComments(updatedPost, registeredReplies, true);
                addToast('收到 ' + registeredReplies.length + ' 条新回复', 'info');
            }
        } catch (error: any) {
            if (error?.name !== 'AbortError') addToast('回复生成失败：' + (error?.message || error), 'error');
        } finally {
            if (replyRequestRef.current?.controller === controller) replyRequestRef.current = null;
        }
    };

    const processReplyQueue = async () => {
        if (replyWorkerRunningRef.current) return;
        replyWorkerRunningRef.current = true;
        if (mountedRef.current) setIsReplyingToUser(true);
        try {
            while (replyQueueRef.current.length && mountedRef.current) {
                const item = replyQueueRef.current.shift();
                if (!item) continue;
                const post = feedRef.current.find(candidate => candidate.id === item.postId);
                if (!post) continue;
                // Idempotency guard: a retried queue item must not answer the same comment twice.
                if (post.comments.some(comment => comment.parentCommentId === item.commentId && comment.authorType !== 'user')) continue;
                await generateRepliesToUser(item.postId, item.commentId, item.content);
            }
        } finally {
            replyWorkerRunningRef.current = false;
            if (mountedRef.current) setIsReplyingToUser(false);
            if (replyQueueRef.current.length && mountedRef.current) void processReplyQueue();
        }
    };

    const enqueueReplyRequest = (item: { postId: string; commentId: string; content: string }) => {
        replyQueueRef.current.push(item);
        void processReplyQueue();
    };

    const handleShare = async (targetId: string, isGroup: boolean) => {
        if (!selectedPost) return;
        try {
            await DB.saveMessage({ charId: isGroup ? 'user' : targetId, groupId: isGroup ? targetId : undefined, role: 'user', type: 'social_card', content: '[分享帖子]', metadata: { post: selectedPost } });
            setShowShareModal(false);
            addToast('分享成功', 'success');
            trackEvent('分享帖子到聊天');
        } catch (e) { addToast('分享失败', 'error'); }
    };

    const handleCreatePost = () => {
        if (createPostLockRef.current || !newPostContent.trim()) return;
        createPostLockRef.current = true;
        try {
            const post: SocialPost = {
                id: 'user-post-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                authorName: socialProfile.name,
                authorAvatar: socialProfile.avatar,
                title: newPostTitle.trim() || '无标题',
                content: newPostContent.trim(),
                images: [codepointToEmoji(newPostEmoji)],
                likes: 0,
                isCollected: false,
                isLiked: false,
                comments: [],
                timestamp: Date.now(),
                tags: ['User'],
                bgStyle: getRandomStyle().bg,
                authorType: 'user',
                authorId: 'user',
                source: 'user',
            };
            prependPostsToFeed([post]);
            setNewPostContent('');
            setNewPostTitle('');
            setIsCreateOpen(false);
            setActiveTab('home');
            addToast('发布成功', 'success');
        } finally {
            createPostLockRef.current = false;
        }
    };

    const handleDeletePost = (postId: string) => {
        const post = feedRef.current.find(item => item.id === postId);
        if (!post || !canDeleteSocialPost(post, socialProfile.name)) {
            addToast('只能删除自己发布的帖子', 'error');
            return;
        }
        recordCommunityEvent('post_deleted', 'user', { targetAccountId: post.authorId, postId });
        removePostFromFeed(postId);
        addToast('帖子已删除', 'success');
        trackEvent('删除一条帖子');
    };

    const handleLike = (e: any, post: SocialPost) => {
        e.stopPropagation();
        const updated = updatePostInFeed(post.id, current => {
            const likedBy = new Set(current.likedByAccountIds || []);
            const wasLiked = current.isLiked === true || likedBy.has('user');
            if (wasLiked) likedBy.delete('user');
            else likedBy.add('user');
            return {
                ...current,
                isLiked: !wasLiked,
                likedByAccountIds: [...likedBy],
                likes: likedBy.size,
            };
        });
        if (updated) {
            recordCommunityEvent(updated.isLiked ? 'post_liked' : 'post_unliked', 'user', { targetAccountId: updated.authorId, postId: updated.id });
            trackEvent('点赞一条帖子', { action: updated.isLiked ? 'like' : 'unlike' });
        }
    };

    const handleToggleCollection = (postId: string) => {
        const updated = updatePostInFeed(postId, current => {
            const collectedBy = new Set(current.collectedByAccountIds || []);
            const wasCollected = current.isCollected === true || collectedBy.has('user');
            if (wasCollected) collectedBy.delete('user');
            else collectedBy.add('user');
            return { ...current, isCollected: collectedBy.has('user'), collectedByAccountIds: [...collectedBy] };
        });
        if (updated) {
            recordCommunityEvent(updated.isCollected ? 'post_collected' : 'post_uncollected', 'user', { targetAccountId: updated.authorId, postId: updated.id });
            trackEvent('收藏一条帖子', { action: updated.isCollected ? 'collect' : 'uncollect' });
        }
    };

    const handleCommentLike = (e: any, postId: string, commentId: string) => {
        e.stopPropagation();
        const updated = updatePostInFeed(postId, current => toggleSocialCommentLike(current, commentId));
        const comment = updated?.comments.find(item => item.id === commentId);
        if (comment) {
            recordCommunityEvent(comment.isLiked ? 'comment_liked' : 'comment_unliked', 'user', {
                targetAccountId: comment.authorId, postId, commentId,
            });
            trackEvent('点赞一条 Spark 评论', { action: comment.isLiked ? 'like' : 'unlike' });
        }
    };

    const handleSendComment = () => {
        if (!selectedPost || !commentInput.trim() || commentSubmitLockRef.current) return;
        commentSubmitLockRef.current = true;
        try {
            const postId = selectedPost.id;
            const contentToSend = commentInput.trim();
            const target = replyTarget;
            const userComment: SocialComment = {
                id: 'cmt-user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                authorName: socialProfile.name,
                authorAvatar: socialProfile.avatar,
                content: contentToSend,
                likes: 0,
                isCharacter: false,
                authorType: 'user',
                authorId: 'user',
                timestamp: Date.now(),
                ...(target ? { parentCommentId: target.id, replyToAuthorName: target.authorName } : {}),
            };
            const updatedPost = updatePostInFeed(postId, current => ({
                ...current,
                comments: mergeSocialComments(current.comments || [], [userComment]),
            }));
            if (!updatedPost) return;
            recordCommunityEvent('comment_created', 'user', {
                targetAccountId: updatedPost.authorId, postId, commentId: userComment.id,
            });
            setCommentInput('');
            setReplyTarget(null);
            commentDraftsRef.current = { ...commentDraftsRef.current, [postId]: { content: '' } };
            persistCommentDrafts();
            // Save the comment immediately; AI replies are queued separately and never block typing/sending.
            enqueueReplyRequest({ postId, commentId: userComment.id, content: contentToSend });
        } finally {
            commentSubmitLockRef.current = false;
        }
    };

    const handleOpenPost = (post: SocialPost) => {
        setActivePostMenuId(null);
        const livePost = feedRef.current.find(item => item.id === post.id) || post;
        const draft = commentDraftsRef.current[livePost.id];
        setCommentInput(draft?.content || '');
        setReplyTarget(draft?.replyToCommentId
            ? livePost.comments.find(comment => comment.id === draft.replyToCommentId) || null
            : null);
        if (!communityStateRef.current.seenPostIds.includes(livePost.id)) {
            updateCommunityState(state => markSparkPostSeen(state, livePost.id));
        }
        setSelectedPost(livePost);
        generateComments(livePost);
    };

    const handleClosePost = () => {
        commentRequestRef.current?.controller.abort();
        setActivePostMenuId(null);
        commentRequestRef.current = null;
        setLoadingComments(false);
        setCommentInput('');
        setReplyTarget(null);
        setSelectedPost(null);
    };

    const handleClearFeed = () => {
        feedLoadGenerationRef.current += 1;
        refreshRequestRef.current?.abort();
        commentRequestRef.current?.controller.abort();
        replyRequestRef.current?.controller.abort();
        refreshRequestRef.current = null;
        commentRequestRef.current = null;
        replyRequestRef.current = null;
        replyQueueRef.current = [];
        setIsRefreshing(false);
        setLoadingComments(false);
        setIsReplyingToUser(false);
        feedRef.current = [];
        setFeed([]);
        setSelectedPost(null);
        setCommentInput('');
        setReplyTarget(null);
        commentDraftsRef.current = {};
        persistCommentDrafts();
        void enqueueSocialPersistence(() => DB.clearSocialPosts()).catch(error => {
            addToast('清空 Spark 数据失败：' + (error?.message || error), 'error');
        });
        setShowSettings(false);
        addToast('推荐流已清空', 'success');
        trackEvent('清空 Spark 推荐流');
    };

    const handleToggleFollowPost = (post: SocialPost) => {
        if (post.authorId === 'user' || post.authorType === 'user') return;
        if (!post.authorId) {
            const registered = normalizeAndRegisterPost(post, communityStateRef.current);
            updateCommunityState(registered.state);
            updatePostInFeed(post.id, () => registered.post);
            toggleFollowAccount(registered.post.authorId || '', post.authorName);
            return;
        }
        toggleFollowAccount(post.authorId, post.authorName);
    };

    const handleHidePost = (post: SocialPost) => {
        const next = setSparkPostHidden(
            communityStateRef.current, post.id, 'user', true, Date.now(), createSparkId('event'),
        );
        updateCommunityState(next);
        if (selectedPost?.id === post.id) setSelectedPost(null);
        addToast('已减少这类内容的推荐；帖子没有被删除。', 'success');
    };

    const handleMutePostAuthor = (post: SocialPost) => {
        const accountId = post.authorId;
        if (!accountId || accountId === 'user' || post.authorType === 'user') return;
        const muted = communityStateRef.current.mutedAccountIds.includes(accountId);
        const next = setSparkAccountMuted(
            communityStateRef.current, accountId, 'user', !muted, Date.now(), createSparkId('event'),
        );
        updateCommunityState(next);
        if (!muted && selectedPost?.id === post.id) setSelectedPost(null);
        addToast(muted ? '已取消屏蔽 @' + post.authorName : '已屏蔽 @' + post.authorName, 'success');
    };

    const handleOpenNotification = (notification: SparkCommunityState['notifications'][number]) => {
        updateCommunityState(state => markSparkNotificationsRead(state, Date.now(), notification.id));
        setShowNotifications(false);
        if (!notification.postId) {
            addToast(notification.message, 'info');
            return;
        }
        const target = feedRef.current.find(post => post.id === notification.postId);
        if (!target) {
            addToast('这条通知关联的帖子已不存在。', 'info');
            return;
        }
        setActiveTab('home');
        setFeedMode('discover');
        setSearchQuery('');
        setSelectedAccountId(null);
        setActiveTopic(null);
        handleOpenPost(target);
    };

    const handleMarkAllNotificationsRead = () => {
        updateCommunityState(state => markSparkNotificationsRead(state));
    };

    // --- Renderers ---

    // 1. Feed Item (Glassmorphism)
    const renderFeedItem = (post: SocialPost) => (
        <div key={post.id} onClick={() => handleOpenPost(post)} className="min-w-0 bg-white/70 backdrop-blur-md rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer active:scale-[0.98] border border-white/50 relative group">
            <div className="aspect-[4/5] w-full flex items-center justify-center relative overflow-hidden" style={{ background: post.bgStyle }}>
                {/* Decorative Overlay for "Premium" look */}
                <div className="absolute inset-0 bg-white/5 backdrop-blur-[1px]"></div>
                <div className="relative z-10 text-6xl drop-shadow-xl filter saturate-150 transform transition-transform group-hover:scale-110 duration-500">{codepointToEmoji(post.images[0])}</div>
                {post.title && (
                    <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-black/50 via-black/20 to-transparent">
                        <h3 className="text-white font-bold text-sm line-clamp-2 drop-shadow-md leading-tight">{post.title}</h3>
                    </div>
                )}
            </div>
            <div className="p-3">
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
            <button
                onClick={(e) => { e.stopPropagation(); setActivePostMenuId(current => current === post.id ? null : post.id); }}
                aria-label="帖子操作"
                className="absolute top-2 right-2 z-20 w-7 h-7 bg-black/25 text-white rounded-full flex items-center justify-center text-base backdrop-blur-md"
            >···</button>
            {activePostMenuId === post.id && (
                <div onClick={e => e.stopPropagation()} className="absolute top-10 right-2 z-30 min-w-32 bg-white rounded-xl shadow-xl border border-slate-100 p-1.5 flex flex-col gap-0.5">
                    {post.authorId !== 'user' && post.authorType !== 'user' && (
                        <button onClick={() => { handleToggleFollowPost(post); setActivePostMenuId(null); }} className="text-left px-3 py-2 text-xs text-slate-700 rounded-lg hover:bg-slate-50">
                            {communityState.follows.some(follow => follow.followerId === 'user' && follow.followedId === post.authorId) ? '取消关注' : '关注作者'}
                        </button>
                    )}
                    <button onClick={() => { handleHidePost(post); setActivePostMenuId(null); }} className="text-left px-3 py-2 text-xs text-slate-700 rounded-lg hover:bg-slate-50">不感兴趣</button>
                    {post.authorId !== 'user' && post.authorType !== 'user' && (
                        <button onClick={() => { handleMutePostAuthor(post); setActivePostMenuId(null); }} className="text-left px-3 py-2 text-xs text-slate-700 rounded-lg hover:bg-slate-50">屏蔽作者</button>
                    )}
                </div>
            )}
            {canDeleteSocialPost(post, socialProfile.name) && (
                <button onClick={(e) => { e.stopPropagation(); handleDeletePost(post.id); }} aria-label="删除自己的帖子" className="absolute top-2 right-10 z-20 w-6 h-6 bg-black/20 text-white rounded-full flex items-center justify-center text-xs backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80">×</button>
            )}
        </div>
    );

    // 2. Detail Overlay (Glassmorphism)
    // FIX: Using a fixed container for backdrop to prevent layout gaps.
    // REMOVED 'key={selectedPost.id}' to prevent re-mounting jitter.
    // SEPARATED scrollable container from animation wrapper.
    const renderDetail = () => {
        if (!selectedPost) return null;
        const allComments = selectedPost.comments || [];
        const renderedCommentIds = new Set<string>();
        const renderCommentTree = (comment: SocialComment, depth = 0): React.ReactNode => {
            if (renderedCommentIds.has(comment.id)) return null;
            renderedCommentIds.add(comment.id);
            const children = allComments.filter(candidate => candidate.parentCommentId === comment.id);
            return (
                <React.Fragment key={comment.id}>
                    <div className={'flex gap-3 animate-fade-in group ' + (depth > 0 ? 'ml-3 pl-3 border-l border-slate-100' : '')}>
                        <TokenImg value={comment.authorAvatar} className="w-9 h-9 rounded-full object-cover shrink-0 border border-slate-100" />
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-2">
                                <span className={'text-xs font-bold ' + (comment.isCharacter ? 'text-slate-800' : 'text-slate-500')}>{comment.authorName}</span>
                                <div className="flex items-center gap-1 text-slate-400">
                                    <button onClick={(e) => handleCommentLike(e, selectedPost.id, comment.id)} aria-label={comment.isLiked ? '取消评论点赞' : '点赞评论'} className="flex items-center gap-1 hover:text-[#ff2442]">
                                        <Icons.Heart filled={comment.isLiked === true} className="w-3.5 h-3.5" />
                                        <span className="text-[10px]">{comment.likes}</span>
                                    </button>
                                </div>
                            </div>
                            {comment.replyToAuthorName && <div className="text-[10px] text-slate-400 mt-0.5">回复 @{comment.replyToAuthorName}</div>}
                            <p className="text-[13px] text-slate-700 mt-0.5 leading-normal font-light whitespace-pre-wrap">{comment.content}</p>
                            <button onClick={() => handleSetReplyTarget(comment)} className="mt-1 text-[10px] text-slate-400 hover:text-[#ff2442]">回复</button>
                        </div>
                    </div>
                    {children.map(child => renderCommentTree(child, depth + 1))}
                </React.Fragment>
            );
        };
        const commentRoots = allComments.filter(comment =>
            !comment.parentCommentId || !allComments.some(candidate => candidate.id === comment.parentCommentId)
        );
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
                            <TokenImg value={selectedPost.authorAvatar} className="w-8 h-8 rounded-full object-cover border border-white/50" />
                            <span className="text-sm font-bold text-slate-800">{selectedPost.authorName}</span>
                        </div>
                        <button onClick={() => { setShowShareModal(true); trackEvent('打开分享帖子面板'); }} className="p-2 -m-2 active:opacity-60"><Icons.Share onClick={() => setShowShareModal(true)} className="w-6 h-6 text-slate-800 cursor-pointer hover:text-[#ff2442]" /></button>
                    </div>

                    {/* Scrollable Area */}
                    <div ref={detailScrollRef} className="flex-1 overflow-y-auto no-scrollbar pb-24">
                        {/* Main Visual */}
                        <div className="w-full aspect-square flex items-center justify-center text-[8rem] relative overflow-hidden" style={{ background: selectedPost.bgStyle }}>
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/10"></div>
                            {/* Removed animate-bounce-slow to prevent reflow jitter */}
                            <div className="relative z-10 drop-shadow-2xl filter saturate-125">{codepointToEmoji(selectedPost.images[0])}</div>
                        </div>

                        <div className="p-6 space-y-4">
                            <h1 className="text-2xl font-black text-slate-900 leading-snug tracking-tight">{selectedPost.title}</h1>
                            <p className="text-[15px] text-slate-700 leading-relaxed whitespace-pre-wrap font-light">{selectedPost.content}</p>
                            
                            <div className="flex gap-2 flex-wrap pt-2">
                                {selectedPost.tags.map(t => <button key={t} onClick={() => { setActiveTopic(t); setSearchQuery(''); setSelectedAccountId(null); setFeedMode('discover'); setSelectedPost(null); }} className="text-xs font-bold text-blue-600 bg-blue-50/50 backdrop-blur-sm border border-blue-100 px-2.5 py-1 rounded-full">#{t}</button>)}
                            </div>
                            <div className="text-xs text-slate-400 font-medium border-b border-slate-100/50 pb-6">{new Date(selectedPost.timestamp).toLocaleDateString()}</div>
                        </div>

                        {/* Comments Section */}
                        <div className="px-6 pb-6">
                            <div className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                                <span>共 {selectedPost.comments.length} 条评论</span>
                                {(loadingComments || isReplyingToUser) && <div className="w-3 h-3 border-2 border-slate-300 border-t-[#ff2442] rounded-full animate-spin"></div>}
                            </div>
                            
                            <div className="space-y-4">
                                {allComments.length === 0 && !loadingComments && <div className="text-center text-slate-300 text-xs py-10">快来抢沙发...</div>}
                                {commentRoots.map(comment => renderCommentTree(comment))}
                                {allComments.filter(comment => !renderedCommentIds.has(comment.id)).map(comment => renderCommentTree(comment))}
                                <div ref={commentsEndRef} />
                            </div>
                        </div>
                    </div>

                    {/* Bottom Input Bar - Absolute to sit on top of scroll area at bottom */}
                    <div className="absolute bottom-0 w-full pb-[var(--safe-bottom,0px)] z-30 pointer-events-none">
                        <div className="pointer-events-auto bg-white/90 backdrop-blur-xl border-t border-white/40 px-4 py-2 flex flex-col gap-2 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
                            {replyTarget && (
                                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                    <span className="truncate">回复 @{replyTarget.authorName}</span>
                                    <button onClick={() => handleSetReplyTarget(null)} className="shrink-0 text-slate-400">取消</button>
                                </div>
                            )}
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex-1 bg-slate-100/70 rounded-full px-4 py-2.5 flex items-center gap-2 focus-within:bg-white focus-within:ring-1 focus-within:ring-slate-200 transition-all border border-transparent focus-within:border-slate-200">
                                    <input
                                        value={commentInput}
                                        onChange={(e) => handleCommentInputChange(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendComment()}
                                        placeholder="说点什么..."
                                        className="bg-transparent text-sm w-full outline-none text-slate-800 placeholder:text-slate-400"
                                    />
                                    {commentInput.trim() && <button onClick={handleSendComment} className="text-[#ff2442] font-bold text-sm animate-fade-in">发送</button>}
                                </div>
                                <div className="flex gap-5 text-slate-600 shrink-0 items-center">
                                    <div className="flex flex-col items-center gap-0.5">
                                        <Icons.Heart filled={selectedPost.isLiked} onClick={(e) => handleLike(e, selectedPost)} className="w-6 h-6" />
                                        <span className="text-[10px] font-medium">{selectedPost.likes}</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-0.5">
                                        <Icons.Star filled={selectedPost.isCollected} onClick={() => handleToggleCollection(selectedPost.id)} className="w-6 h-6" />
                                        <span className="text-[10px] font-medium">{selectedPost.isCollected ? '已收藏' : '收藏'}</span>
                                    </div>
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
        <div className="h-full w-full bg-gradient-to-br from-rose-50 via-slate-50 to-teal-50 flex flex-col font-sans relative text-slate-900 overflow-hidden">
            
            {/* --- Modals (Settings, Share) --- */}
            <Modal isOpen={showSettings} title="身份管理" onClose={() => setShowSettings(false)}>
                <div className="space-y-6">
                    <div className="max-h-[50vh] overflow-y-auto no-scrollbar space-y-6 px-1">
                        <p className="text-xs text-slate-400 bg-slate-50 p-2 rounded-lg">
                            为角色添加“马甲”(Sub-Accounts)。AI 发帖时会根据内容选择合适的身份。
                        </p>
                        {/* 分组筛选（没建分组时不渲染） */}
                        <CharacterGroupFilterBar characters={characters} groups={characterGroups} value={identityGroupId} onChange={setIdentityGroupId} className="!mt-3 -mx-1 px-1" />
                        {filterCharactersByGroup(characters, characterGroups, identityGroupId).map(c => (
                            <div key={c.id} className="space-y-3 pb-4 border-b border-slate-50">
                                <div className="flex items-center gap-2">
                                    <TokenImg value={c.avatar} className="w-6 h-6 rounded-full object-cover" />
                                    <span className="text-sm font-bold text-slate-700">{c.name}</span>
                                    <button onClick={() => addSubAccount(c.id)} className="ml-auto text-[10px] bg-[#ff2442] text-white px-2 py-1 rounded-full shadow-sm active:scale-95 transition-transform">+ 添加马甲</button>
                                </div>
                                
                                <div className="space-y-2 pl-4 border-l-2 border-slate-100">
                                    {(characterHandles[c.id] || []).map((acct) => (
                                        <div key={acct.id} className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm space-y-2 relative group">
                                            <div className="flex gap-2">
                                                <div className="flex-1">
                                                    <label className="text-[9px] text-slate-400 uppercase font-bold">网名 (Handle)</label>
                                                    <input 
                                                        value={acct.handle} 
                                                        onChange={(e) => updateSubAccount(c.id, acct.id, 'handle', e.target.value)} 
                                                        className="w-full text-sm font-bold text-slate-800 border-b border-dashed border-slate-200 focus:border-[#ff2442] outline-none py-1" 
                                                    />
                                                </div>
                                                <button 
                                                    onClick={() => deleteSubAccount(c.id, acct.id)}
                                                    className="text-slate-300 hover:text-red-400 p-1"
                                                    title="删除"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                            <div>
                                                <label className="text-[9px] text-slate-400 uppercase font-bold">备注 (Context Note)</label>
                                                <input 
                                                    value={acct.note} 
                                                    onChange={(e) => updateSubAccount(c.id, acct.id, 'note', e.target.value)} 
                                                    placeholder="例如: 吐槽号 / 认真模式"
                                                    className="w-full text-xs text-slate-500 bg-slate-50 rounded px-2 py-1 focus:bg-white transition-colors outline-none" 
                                                />
                                            </div>
                                        </div>
                                    ))}
                                    {(characterHandles[c.id]?.length || 0) === 0 && (
                                        <div className="text-[10px] text-red-400 italic flex items-center gap-1"><Warning size={12} weight="bold" /> 请至少保留一个身份</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    {communityState.mutedAccountIds.length > 0 && (
                        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
                            <h3 className="text-xs font-bold text-slate-700">已屏蔽账号</h3>
                            {communityState.mutedAccountIds.map(accountId => {
                                const account = communityState.accounts.find(item => item.id === accountId);
                                return (
                                    <div key={accountId} className="flex items-center gap-2 text-xs">
                                        <span className="flex-1 truncate text-slate-600">{account?.displayName || accountId}</span>
                                        <button onClick={() => {
                                            updateCommunityState(state => setSparkAccountMuted(state, accountId, 'user', false, Date.now(), createSparkId('event')));
                                            addToast('已取消屏蔽', 'success');
                                        }} className="text-[#ff2442] font-bold">取消屏蔽</button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {communityState.hiddenPostIds.length > 0 && (
                        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
                            <h3 className="text-xs font-bold text-slate-700">已隐藏帖子</h3>
                            {communityState.hiddenPostIds.map(postId => {
                                const post = feed.find(item => item.id === postId);
                                if (!post) return null;
                                return (
                                    <div key={postId} className="flex items-center gap-2 text-xs">
                                        <span className="flex-1 truncate text-slate-600">{post.title}</span>
                                        <button onClick={() => {
                                            updateCommunityState(state => setSparkPostHidden(state, postId, 'user', false, Date.now(), createSparkId('event')));
                                            addToast('已恢复推荐', 'success');
                                        }} className="text-[#ff2442] font-bold">恢复推荐</button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <div className="flex gap-3 pt-2">
                        <button onClick={handleClearFeed} className="flex-1 py-3 bg-white border border-slate-200 text-slate-500 font-bold rounded-xl text-xs active:bg-slate-50">清空推荐流</button>
                        <button onClick={() => setShowSettings(false)} className="flex-1 py-3 bg-[#ff2442] text-white font-bold rounded-xl text-xs shadow-lg shadow-red-200 active:scale-95 transition-transform">完成</button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={showNotifications} title="消息通知" onClose={() => setShowNotifications(false)}>
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400">评论、回复和关注等站内事件</span>
                        <button onClick={handleMarkAllNotificationsRead} disabled={unreadNotifications.length === 0} className="text-xs font-bold text-[#ff2442] disabled:text-slate-300">全部已读</button>
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto space-y-2">
                        {[...communityState.notifications]
                            .filter(notification => notification.targetAccountId === 'user')
                            .sort((a, b) => b.createdAt - a.createdAt)
                            .map(notification => (
                                <button key={notification.id} onClick={() => handleOpenNotification(notification)} className={`w-full text-left p-3 rounded-xl border transition-colors ${notification.readAt ? 'bg-white border-slate-100' : 'bg-rose-50 border-rose-100'}`}>
                                    <div className="flex items-start gap-2">
                                        <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${notification.readAt ? 'bg-slate-200' : 'bg-[#ff2442]'}`} />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm text-slate-700">{notification.message}</p>
                                            <p className="text-[10px] text-slate-400 mt-1">{new Date(notification.createdAt).toLocaleString()}</p>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        {communityState.notifications.filter(notification => notification.targetAccountId === 'user').length === 0 && (
                            <div className="py-12 text-center text-slate-400 text-sm">暂时没有通知</div>
                        )}
                    </div>
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
                            <button onClick={() => setIsCreateOpen(false)} className="text-slate-600 text-sm font-bold px-2 py-1">取消</button>
                            <span className="text-sm font-bold text-slate-800">发布笔记</span>
                            <button
                                onClick={handleCreatePost}
                                disabled={!newPostContent.trim()}
                                className={`px-4 py-1.5 rounded-full text-xs font-bold text-white transition-all ${newPostContent.trim() ? 'bg-[#ff2442] shadow-md shadow-red-200' : 'bg-slate-200 text-slate-400'}`}
                            >
                                发布
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
                        
                        {/* Sticker Selector - Flowing after text */}
                        <div className="mt-4 pt-4 border-t border-slate-50">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">添加心情贴纸 (Sticker)</p>
                            <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                                {STICKER_OPTIONS.map(sticker => (
                                    <button
                                        key={sticker.code}
                                        onClick={() => setNewPostEmoji(sticker.code)}
                                        className={`w-12 h-12 rounded-xl border flex items-center justify-center transition-all shrink-0 ${newPostEmoji === sticker.code ? 'border-[#ff2442] bg-red-50' : 'border-slate-100'}`}
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
                        <div className="flex gap-6 text-base font-bold text-slate-300">
                            <button className={`${activeTab === 'home' ? 'text-slate-800 scale-110 border-b-2 border-[#ff2442] pb-1' : 'hover:text-slate-500'} transition-all`} onClick={() => { setActiveTab('home'); trackEvent('切换 Spark 主标签', { tab: 'home' }); }}>发现</button>
                            <button className={`${activeTab === 'me' ? 'text-slate-800 scale-110 border-b-2 border-[#ff2442] pb-1' : 'hover:text-slate-500'} transition-all`} onClick={() => { setActiveTab('me'); trackEvent('切换 Spark 主标签', { tab: 'me' }); }}>我的</button>
                        </div>
                        <div className="flex items-center gap-3">
                            <button onClick={() => setShowNotifications(true)} aria-label="打开消息通知" className="relative text-slate-700 p-1">
                                <Bell size={19} />
                                {unreadNotifications.length > 0 && <span className="absolute -top-0.5 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#ff2442] text-white text-[9px] flex items-center justify-center">{unreadNotifications.length > 99 ? '99+' : unreadNotifications.length}</span>}
                            </button>
                            <button onClick={() => { setShowSettings(true); trackEvent('打开身份管理面板'); }} className="text-slate-800 font-bold text-sm">管理</button>
                        </div>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    
                    {activeTab === 'home' && (
                        <div className="p-2 min-h-full">
                            <div className="flex items-center justify-between gap-2 px-1 py-2">
                                <div className="flex items-center gap-1 bg-white/70 border border-white rounded-full p-1 shadow-sm">
                                    <button onClick={() => { setFeedMode('discover'); setSelectedAccountId(null); }} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${feedMode === 'discover' ? 'bg-[#ff2442] text-white shadow-sm' : 'text-slate-500'}`}>发现</button>
                                    <button onClick={() => { setFeedMode('following'); setSelectedAccountId(null); }} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${feedMode === 'following' ? 'bg-[#ff2442] text-white shadow-sm' : 'text-slate-500'}`}>关注</button>
                                </div>
                                <button onClick={() => setShowNotifications(true)} className="flex items-center gap-1 text-xs font-bold text-slate-500 px-3 py-2 bg-white/70 rounded-full border border-white">
                                    <Bell size={15} /> 消息{unreadNotifications.length > 0 ? ' · ' + unreadNotifications.length : ''}
                                </button>
                            </div>
                            <div className="relative px-1 mb-2">
                                <MagnifyingGlass size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSelectedAccountId(null); setActiveTopic(null); }} placeholder="搜索帖子、账号或话题" className="w-full rounded-xl bg-white/80 border border-white shadow-sm py-2.5 pl-9 pr-9 text-sm outline-none focus:ring-1 focus:ring-rose-200" />
                                {searchQuery && <button onClick={() => setSearchQuery('')} aria-label="清除搜索" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 px-1">×</button>}
                            </div>
                            {selectedAccountId && (
                                <div className="flex items-center gap-2 px-2 py-1.5 mb-2 bg-white/70 rounded-lg text-xs">
                                    <span className="text-slate-500">账号动态：{communityState.accounts.find(account => account.id === selectedAccountId)?.displayName || '已选账号'}</span>
                                    <button onClick={() => setSelectedAccountId(null)} className="ml-auto text-[#ff2442]">清除</button>
                                </div>
                            )}
                            {activeTopic && (
                                <div className="flex items-center gap-2 px-2 py-1.5 mb-2 bg-blue-50 rounded-lg text-xs text-blue-700">
                                    <span>话题：#{activeTopic}</span>
                                    <button onClick={() => setActiveTopic(null)} className="ml-auto">清除</button>
                                </div>
                            )}
                            {searchQuery.trim() && (matchingAccounts.length > 0 || matchingTopics.length > 0) && (
                                <div className="mx-1 mb-2 bg-white/80 rounded-xl border border-white p-2 space-y-1">
                                    {matchingAccounts.map(account => (
                                        <button key={account.id} onClick={() => { setSelectedAccountId(account.id); setSearchQuery(''); setActiveTopic(null); setFeedMode('discover'); }} className="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between text-xs">
                                            <span><span className="text-slate-400 mr-2">账号</span>{account.displayName}</span><span className="text-slate-400">查看动态 ›</span>
                                        </button>
                                    ))}
                                    {matchingTopics.map(topic => (
                                        <button key={topic} onClick={() => { setActiveTopic(topic); setSearchQuery(''); setSelectedAccountId(null); setFeedMode('discover'); }} className="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-50 text-xs text-blue-700">话题 #{topic}</button>
                                    ))}
                                </div>
                            )}
                            {!searchQuery.trim() && !activeTopic && availableTopics.length > 0 && (
                                <div className="flex gap-2 overflow-x-auto no-scrollbar px-1 pb-2">
                                    {availableTopics.slice(0, 8).map(topic => (
                                        <div key={topic} className="shrink-0 flex items-center bg-white/70 border border-white rounded-full text-xs">
                                            <button onClick={() => { setActiveTopic(topic); setSelectedAccountId(null); setFeedMode('discover'); }} className="px-3 py-1.5 text-slate-600">#{topic}</button>
                                            <button onClick={() => handleToggleTopicInterest(topic)} aria-label={communityState.interests.some(item => normalizeSparkName(item) === normalizeSparkName(topic)) ? '取消关注话题' : '关注话题'} className="px-2 py-1.5 border-l border-slate-100 text-[#ff2442]">
                                                {communityState.interests.some(item => normalizeSparkName(item) === normalizeSparkName(topic)) ? '★' : '＋'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {/* Refresh Button - Above Posts */}
                            <div className="flex items-center justify-center py-3">
                                {isRefreshing ? (
                                    <div className="text-center text-xs text-[#ff2442] font-bold animate-pulse flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-[#ff2442] border-t-transparent rounded-full animate-spin"></div> 正在获取新鲜事...
                                    </div>
                                ) : (
                                    <button onClick={handleRefresh} className="px-6 py-2 bg-white/80 backdrop-blur-md rounded-full text-xs font-bold text-slate-500 shadow-sm border border-white hover:text-[#ff2442] active:scale-95 transition-all">
                                        点击刷新推荐流
                                    </button>
                                )}
                            </div>
                            {/* 完整卡片占一个网格单元，避免多栏分片与 backdrop-filter/裁切组合丢失作者栏。 */}
                            <div className="grid grid-cols-2 items-start gap-x-2 gap-y-3 pb-24">
                                {visibleFeed.map(post => renderFeedItem(post))}
                            </div>
                            {visibleFeed.length === 0 && (
                                <div className="mx-2 my-8 rounded-2xl bg-white/70 border border-white p-6 text-center text-slate-400">
                                    <Package size={34} className="mx-auto mb-2 opacity-40" />
                                    <p className="text-sm font-bold text-slate-600">{searchQuery.trim() ? '没有找到匹配的内容' : activeTopic ? '这个话题暂时没有帖子' : feedMode === 'following' ? '关注的账号还没有发布动态' : '暂时没有可展示的动态'}</p>
                                    <p className="text-xs mt-1">{feedMode === 'following' && !searchQuery.trim() ? '去发现页关注喜欢的账号，后续动态会出现在这里。' : '可以调整搜索条件，或刷新推荐流。'}</p>
                                    {feedMode === 'following' && <button onClick={() => setFeedMode('discover')} className="mt-3 text-xs font-bold text-[#ff2442]">去发现页</button>}
                                </div>
                            )}
                        </div>
                    )}

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

                                <div className="flex gap-6 mt-5 bg-white/40 p-4 rounded-2xl border border-white/50 shadow-sm">
                                    <div className="text-center"><span className="block font-bold text-slate-800">{profileStats.following.toLocaleString()}</span><span className="text-[10px] text-slate-400">关注</span></div>
                                    <div className="text-center"><span className="block font-bold text-slate-800">{profileStats.followers.toLocaleString()}</span><span className="text-[10px] text-slate-400">粉丝</span></div>
                                    <div className="text-center"><span className="block font-bold text-slate-800">{profileStats.likesAndCollections.toLocaleString()}</span><span className="text-[10px] text-slate-400">获赞与收藏</span></div>
                                </div>
                            </div>

                            {/* Sticky Tabs */}
                            <div className="sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-slate-100 flex">
                                <button onClick={() => { setProfileTab('notes'); trackEvent('切换个人主页子标签', { tab: 'notes' }); }} className={`flex-1 py-3 text-sm font-bold transition-colors ${profileTab === 'notes' ? 'text-slate-900 border-b-2 border-[#ff2442]' : 'text-slate-400'}`}>笔记</button>
                                <button onClick={() => { setProfileTab('collects'); trackEvent('切换个人主页子标签', { tab: 'collects' }); }} className={`flex-1 py-3 text-sm font-bold transition-colors ${profileTab === 'collects' ? 'text-slate-900 border-b-2 border-[#ff2442]' : 'text-slate-400'}`}>收藏</button>
                            </div>

                            <div className="p-2 min-h-[300px] bg-slate-50/50 pb-24">
                                <div className="columns-2 gap-2 space-y-2">
                                    {feed.filter(p => profileTab === 'notes' ? (p.authorType === 'user' || (!p.authorType && p.authorName === socialProfile.name)) : p.isCollected).map(post => (
                                        <div key={post.id} onClick={() => handleOpenPost(post)} className="break-inside-avoid bg-white rounded-xl overflow-hidden shadow-sm border border-slate-100 cursor-pointer">
                                            <div className="aspect-[4/5] flex items-center justify-center text-4xl" style={{ background: post.bgStyle }}>{codepointToEmoji(post.images[0])}</div>
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

                {/* Bottom Navigation - Floating Glass Island (Only shown when not creating) */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] h-16 bg-white/80 backdrop-blur-2xl rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-white/50 flex items-center justify-around z-40">
                    <button onClick={() => { setActiveTab('home'); trackEvent('切换 Spark 主标签', { tab: 'home' }); }} className={`text-sm font-medium flex flex-col items-center justify-center gap-0.5 transition-all w-12 h-12 rounded-full ${activeTab === 'home' ? 'text-slate-900 bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        <House size={24} weight={activeTab === 'home' ? 'fill' : 'regular'} />
                    </button>
                    <button onClick={() => { setIsCreateOpen(true); trackEvent('打开发布笔记面板'); }} className="w-12 h-12 bg-[#ff2442] text-white rounded-full flex items-center justify-center shadow-lg shadow-red-200 active:scale-95 transition-transform text-2xl font-light -mt-6 border-4 border-white/50">+</button>
                    <button onClick={() => { setActiveTab('me'); trackEvent('切换 Spark 主标签', { tab: 'me' }); }} className={`text-sm font-medium flex flex-col items-center justify-center gap-0.5 transition-all w-12 h-12 rounded-full ${activeTab === 'me' ? 'text-slate-900 bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        <User size={24} />
                    </button>
                </div>
            </div>

            {selectedPost && renderDetail()}
        </div>
    );
};

export default SocialApp;
import { useAppShortcut } from '../utils/appShortcutLaunch';
import { AppID as ShortcutAppID } from '../types';
