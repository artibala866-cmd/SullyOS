import React, {useEffect, useState} from 'react';
import {resolveCssImageUrls} from '../../utils/cssImageAssets';
import silentLetter from '../../presets/chat/silent-letter-dark.json';

/** Previous built-in Silent Letter version incorrectly painted empty avatar placeholders
 * and dropped the author's header/input layout. Upgrade only that identifiable v1
 * visual stylesheet when it is already applied in an existing conversation. */
export function resolveLegacySilentLetterCss(css: string): string {
    return css.includes('/* 【糯叽机】无声回信（黑）by黛 — SullyOS 白框适配')
        && css.includes('.sully-chat-message-avatar:not(.sully-chat-avatar-wrap)')
        ? silentLetter.parts.css : css;
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
