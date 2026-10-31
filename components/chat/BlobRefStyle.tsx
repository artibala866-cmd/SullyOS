import React, {useEffect, useState} from 'react';
import {resolveCssImageUrls} from '../../utils/cssImageAssets';
import silentLetter from '../../presets/chat/silent-letter-dark.json';
import weixinBaiyu from '../../presets/chat/weixin-baiyu.json';
import friendRequestRain from '../../presets/chat/friend-request-rain.json';

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
const SILENT_LETTER_V3 = '/* 12. 无声回信原生交互与原作细节补齐 v3';
const SILENT_LETTER_V4 = '/* 13. 无声回信独立引用条适配 v4';
export function resolveLegacySilentLetterCss(css: string): string {
    if (css.includes(SILENT_LETTER_V1) && css.includes('.sully-chat-message-avatar:not(.sully-chat-avatar-wrap)')) {
        return silentLetter.parts.css;
    }
    if (!css.includes(SILENT_LETTER_V2) || !css.includes('.sully-chat-actions-button')) return css;
    let upgraded = css;
    if (!upgraded.includes(ICON_REPLACEMENT_START)) {
        const from = silentLetter.parts.css.indexOf(ICON_REPLACEMENT_START);
        const to = silentLetter.parts.css.indexOf(ICON_REPLACEMENT_END, from);
        if (from >= 0 && to >= from) upgraded += '\n' + silentLetter.parts.css.slice(from, to);
    }
    if (!upgraded.includes(SILENT_LETTER_V3)) {
        const from = silentLetter.parts.css.indexOf(SILENT_LETTER_V3);
        if (from >= 0) upgraded += '\n' + silentLetter.parts.css.slice(from);
    }
    if (!upgraded.includes(SILENT_LETTER_V4)) {
        const from = silentLetter.parts.css.indexOf(SILENT_LETTER_V4);
        if (from >= 0) upgraded += '\n' + silentLetter.parts.css.slice(from);
    }
    return upgraded;
}


/** Already-applied whitebox CSS lives on the character/theme, not in the preset.
 * Bring the original reply lightning back without discarding custom additions or cached images.
 * The repaired built-in does not need migration; only the recognizable older copies do.
 */
const WEIXIN_BAIYU_SIGNATURE = '/* 微信 by 白榆 · SullyOS 原生白框整套转换';
const WEIXIN_HEADER_FIX = '/* 白榆顶栏原生闪电修复 v2';
const WEIXIN_NATIVE_FIX = '/* 微信 by 白榆 · 糯米机真实组件深度适配 v3';
const WEIXIN_DARK_FIX = '/* 微信 by 白榆 · 深色对比度补丁 v4';
export function isWeixinBaiyuCss(css?: string): boolean {
    return !!css?.includes(WEIXIN_BAIYU_SIGNATURE);
}
/** Persisted character and group CSS is a snapshot of the original whitebox.
 * Add only missing version patches, preserving user changes, blobrefs and other themes.
 */
export function resolveLegacyWeixinBaiyuCss(css: string): string {
    if (!isWeixinBaiyuCss(css) || css.includes(WEIXIN_DARK_FIX)) return css;
    const latest = weixinBaiyu.parts.css;
    const missing = [WEIXIN_HEADER_FIX, WEIXIN_NATIVE_FIX, WEIXIN_DARK_FIX].find(marker => !css.includes(marker));
    if (!missing) return css;
    const index = latest.indexOf(missing);
    if (index < 0) return css;
    return css + '\n' + latest.slice(index);
}


/** Upgrade previously applied Friend Rain CSS without replacing user additions or cached blobref images. */
const FRIEND_RAIN_SIGNATURE='/* 请求添加好友 · 雨梦 by 池谕 | SullyOS 原生整套白框适配';
const FRIEND_RAIN_V4='/* 请求添加好友 · 池谕原稿视觉补全 v4';
export function resolveLegacyFriendRequestRainCss(css:string):string {
 if(!css.includes(FRIEND_RAIN_SIGNATURE)||css.includes(FRIEND_RAIN_V4))return css;
 const full=friendRequestRain.parts.css;
 const from=full.indexOf(FRIEND_RAIN_V4);
 return from===-1?css:css+'\n'+full.slice(from);
}

/** Keep persisted CSS independent of the short-lived browser object URLs. */
export default function BlobRefStyle({css}: {css: string}) {
    const effectiveCss = resolveLegacyFriendRequestRainCss(resolveLegacyWeixinBaiyuCss(resolveLegacySilentLetterCss(css)));
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
