import React, {useEffect, useState} from 'react';
import {resolveCssImageUrls} from '../../utils/cssImageAssets';
import silentLetter from '../../presets/chat/silent-letter-dark.json';
import weixinBaiyu from '../../presets/chat/weixin-baiyu.json';

/** Previously applied whitebox CSS is persisted per character or globally. Changing
 * a bundled preset does not update that copy. Upgrade only CSS bearing the known
 * SullyOS adaptation signatures; other imported/user themes stay untouched.
 * v2 keeps its cached blobref images and custom CSS; only the missing original
 * icon-replacement rules are appended (not another copy of the full outfit).
 */
const SILENT_LETTER_V1 = '/* 【糯叽机】无声回信（黑）by黛 — SullyOS 白框适配';
const SILENT_LETTER_V2 = '/* 【糯叽机】无声回信（黑）by黛 · 原版完整界面 SullyOS 适配 v2';
const ICON_REPLACEMENT_START = '/* 11. 贴图是真正的替换图标';
const ICON_REPLACEMENT_END = '/* 辅助功能：动态文字';
export function resolveLegacySilentLetterCss(css: string): string {
    if (css.includes(SILENT_LETTER_V1) && css.includes('.sully-chat-message-avatar:not(.sully-chat-avatar-wrap)')) {
        return silentLetter.parts.css;
    }
    if (!css.includes(SILENT_LETTER_V2) || !css.includes('.sully-chat-actions-button')) return css;
    if (css.includes(ICON_REPLACEMENT_START)) return css;
    const from = silentLetter.parts.css.indexOf(ICON_REPLACEMENT_START);
    const to = silentLetter.parts.css.indexOf(ICON_REPLACEMENT_END, from);
    if (from < 0 || to < from) return css;
    return css + '\n' + silentLetter.parts.css.slice(from, to);
}


/** Already-applied whitebox CSS lives on the character/theme, not in the preset.
 * Bring the original reply lightning back without discarding custom additions or cached images.
 * The repaired built-in does not need migration; only the recognizable older copies do.
 */
const WEIXIN_BAIYU_SIGNATURE = '/* 微信 by 白榆 · SullyOS 原生白框整套转换';
const WEIXIN_HEADER_FIX = '/* 白榆顶栏原生闪电修复 v2';
const WEIXIN_NATIVE_FIX = '/* 微信 by 白榆 · 糯米机真实组件深度适配 v3';
export function isWeixinBaiyuCss(css?: string): boolean {
    return !!css?.includes(WEIXIN_BAIYU_SIGNATURE);
}
/** Persisted character and group CSS is a snapshot of the original whitebox.
 * Add only missing version patches, preserving user changes, blobrefs and other themes.
 */
export function resolveLegacyWeixinBaiyuCss(css: string): string {
    if (!isWeixinBaiyuCss(css) || css.includes(WEIXIN_NATIVE_FIX)) return css;
    const latest = weixinBaiyu.parts.css;
    const missingFrom = latest.indexOf(css.includes(WEIXIN_HEADER_FIX) ? WEIXIN_NATIVE_FIX : WEIXIN_HEADER_FIX);
    if (missingFrom < 0) return css;
    return css + '\n' + latest.slice(missingFrom);
}

/** Keep persisted CSS independent of the short-lived browser object URLs. */
export default function BlobRefStyle({css}: {css: string}) {
    const effectiveCss = resolveLegacyWeixinBaiyuCss(resolveLegacySilentLetterCss(css));
    const [resolved, setResolved] = useState<{source: string; css: string; alive: () => boolean} | null>(null);
    useEffect(() => {
        if (!effectiveCss.includes('blobref:')) return;
        let alive = true; let dispose: (() => void) | undefined;
        void resolveCssImageUrls(effectiveCss, true).then(result => {
            if (!alive) {result.dispose(); return;}
            dispose = result.dispose; setResolved({source: effectiveCss, css: result.css, alive: () => alive});
        }).catch(() => { /* Keep ordinary layout CSS usable if the asset store is unavailable. */ });
        return () => {alive = false; dispose?.();};
    }, [effectiveCss]);
    return <style>{resolved?.source === effectiveCss && resolved.alive() ? resolved.css : effectiveCss}</style>;
}
