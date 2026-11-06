// 独立 QQ 捏人器：与退役节日活动入口解耦，保留现有 iframe 协议和素材数据。
import React, { useEffect, useRef } from 'react';
import type { CharacterProfile } from '../../types';
import { DB } from '../../utils/db';
import { userSaveStoragePrefix } from '../../utils/userSaveScope';
import { creatorPartToBlobRefs, loadCreatorPartsForRender } from '../../utils/creatorPartsBlob';

export interface ChibiResult {
    dataUrl: string;
    frameDataUrl: string;
    transparentDataUrl: string;
    state?: any;
}

export const isSullyChar = (char: CharacterProfile): boolean => {
    return (char.name || '').toLowerCase().includes('sully');
};

export const sullyPresets = (): Record<string, string> => ({
    skin: 'skin_01',        // 新画风身体（内置素材包 parts/manifest.json；旧 skin_1 已被折叠）
    fronthair: 'fronthair_99',
    earhair: 'earhair_99',
    back1: 'back1_99',
    back2: 'back2_99',
    eyes: 'eyes_99',
});

export interface CreatorIframeProps {
    mode: 'char' | 'user';
    charName?: string;
    presets?: Record<string, any>;
    /** 捏人器导出的完整 state：整套还原选件+换色+翻转（草稿仍优先；比 presets 优先） */
    savedState?: any;
    isSully?: boolean;
    /** 唯一草稿键（如彼方按 char.id），让草稿按角色隔离、与 520 互不串 */
    draftKey?: string;
    /** 覆盖标题（彼方用来去掉「变得小小的 520」文案） */
    title?: string;
    /** 覆盖英文副标题 */
    subtitle?: string;
    onConfirm: (result: ChibiResult) => void;
}

const CHAR_CREATOR_URL = (((import.meta as any).env?.BASE_URL ?? '/') + 'like520/character_creator.html').replace(/\/+/g, '/');

export const CreatorIframe: React.FC<CreatorIframeProps> = ({ mode, charName, presets, savedState, isSully, draftKey, title, subtitle, onConfirm }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    // 自定义部件（开发模式上传）—— 异步从 DB 读出
    const extraItemsRef = useRef<any[]>([]);
    const readyRef = useRef(false);
    const initSentRef = useRef(false);

    // 最新参数 / 回调放 ref：让订阅与初始化的 effect 只跑一次，
    // 避免父组件重渲导致反复重发 init（会触发 applyLike520Init 重置当前选择 → "弹回上一个"）
    const paramsRef = useRef({ mode, charName, presets, savedState, isSully, draftKey, title, subtitle });
    paramsRef.current = { mode, charName, presets, savedState, isSully, draftKey, title, subtitle };
    const onConfirmRef = useRef(onConfirm);
    onConfirmRef.current = onConfirm;

    // init 只发一次（首次 ready）；之后绝不重发，保住用户的选择
    const postInit = () => {
        const w = iframeRef.current?.contentWindow;
        if (!w) return;
        const p = paramsRef.current;
        // iframe 内 env(safe-area-inset-bottom) 在 iOS standalone PWA 不可靠（多为 0），
        // 把外层 JS probe 写到 :root 的 --standalone-safe-area-bottom 透传进去。
        const rootStyles = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
        const safeBottomRaw = rootStyles?.getPropertyValue('--standalone-safe-area-bottom').trim() || '';
        const safeBottomPx = Number.parseFloat(safeBottomRaw) || 0;
        w.postMessage({
            type: 'like520_init',
            payload: {
                ...p,
                saveStoragePrefix: userSaveStoragePrefix(),
                isSully: !!p.isSully,
                extraItems: extraItemsRef.current,
                safeBottomPx,
            },
        }, '*');
        initSentRef.current = true;
    };
    // 自定义部件单独走 add_items：只合并、不重置选择
    const postAddItems = () => {
        const w = iframeRef.current?.contentWindow;
        if (!w || !extraItemsRef.current.length) return;
        w.postMessage({ type: 'like520_add_items', payload: { extraItems: extraItemsRef.current } }, '*');
    };

    // 载入自定义部件（一次）；若已就绪则补发 add_items（合并而非重置）
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // 部件在库里以 Blob 令牌存（省配额），这里解析回 base64 供 iframe 用；
                // 顺手把存量旧 base64 惰性迁移成令牌。
                const parts = await loadCreatorPartsForRender();
                if (cancelled) return;
                extraItemsRef.current = parts.map(p => ({ categoryKey: p.categoryKey, id: p.id, name: p.name, src: p.src, tintable: !!p.tintable, shadowSrc: p.shadowSrc }));
                if (readyRef.current) postAddItems();
            } catch { /* 没有自定义部件时静默 */ }
        })();
        return () => { cancelled = true; };
    }, []);

    // 消息订阅（一次）
    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            if (!e.data || typeof e.data !== 'object') return;
            const iframeWin = iframeRef.current?.contentWindow;
            if (e.source !== iframeWin) return;

            if (e.data.type === 'like520_ready') {
                readyRef.current = true;
                if (!initSentRef.current) postInit();
            } else if (e.data.type === 'like520_result' && e.data.payload) {
                onConfirmRef.current?.({
                    dataUrl: e.data.payload.dataUrl,
                    frameDataUrl: e.data.payload.frameDataUrl,
                    transparentDataUrl: e.data.payload.transparentDataUrl,
                    state: e.data.payload.state,
                });
            } else if (e.data.type === 'like520_save_custom_part' && e.data.payload?.part) {
                // 捏人器界面内上传的自定义部件 → 落库（IndexedDB），刷新/换 app 都还在。
                // 落库前把 base64 src/shadowSrc 转成 Blob 令牌（省配额）；内存里仍留 base64 喂 iframe。
                const p = e.data.payload.part;
                const part = {
                    id: p.id, categoryKey: p.categoryKey, name: p.name,
                    src: p.src, tintable: !!p.tintable, shadowSrc: p.shadowSrc, createdAt: Date.now(),
                };
                creatorPartToBlobRefs(part)
                    .then(stored => DB.saveCustomCreatorPart(stored))
                    .then(() => { extraItemsRef.current = [...extraItemsRef.current, { categoryKey: p.categoryKey, id: p.id, name: p.name, src: p.src, tintable: !!p.tintable, shadowSrc: p.shadowSrc }]; })
                    .catch(() => { /* 落库失败：内存里仍可用，仅本次会话有效 */ });
            } else if (e.data.type === 'like520_delete_custom_part' && e.data.payload?.id) {
                const id = e.data.payload.id;
                DB.deleteCustomCreatorPart(id)
                    .then(() => { extraItemsRef.current = extraItemsRef.current.filter(x => x.id !== id); })
                    .catch(() => {});
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    return (
        <iframe
            ref={iframeRef}
            src={CHAR_CREATOR_URL}
            title={mode === 'char' ? '捏 char chibi' : '捏 user chibi'}
            className="w-full h-full border-0"
            style={{ background: 'linear-gradient(180deg, #FFF1E6 0%, #FFE4EC 100%)' }}
        />
    );
};

