import React, {useEffect, useState} from 'react';
import {resolveCssImageUrls} from '../../utils/cssImageAssets';
import silentLetter from '../../presets/chat/silent-letter-dark.json';

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


/** Keep persisted CSS independent of the short-lived browser object URLs. */
export default function BlobRefStyle({css}: {css: string}) {
    const effectiveCss = resolveLegacySilentLetterCss(css);
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
