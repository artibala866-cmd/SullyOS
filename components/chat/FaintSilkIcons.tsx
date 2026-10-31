import React, { useEffect, useState } from 'react';

/**
 * Original artwork from "Faint Silk 浅丝 by 落吟".
 * Attach it to EXISTING functional controls only; never create a second clickable icon.
 * An external image must decode successfully before its matching native SVG is hidden.
 * On broken links/offline, leave the original functional icon visible.
 */
export const FAINT_SILK_ICON_IMAGES = {
    back: 'https://i.postimg.cc/x1x7X8xD/image.png',
    actions: 'https://i.postimg.cc/qMGWdjyD/image.png',
    emoji: 'https://i.postimg.cc/rwnbDsnc/image.png',
    send: 'https://nos.netease.com/ysf/bb1d139e620cc60c93f39405314e1a77.png',
    generate: 'https://i.postimg.cc/VkGTJv7j/image.png',
} as const;

export type FaintSilkIconKey = keyof typeof FAINT_SILK_ICON_IMAGES;

/**
 * Header's original "info" sticker (0y2F5DCz) is deliberately not mapped to
 * the Lightning/stop control, which is NOT an info button.
 * Phone, voice and Stop remain recognizable native controls.
 */
const ICON_HOOKS: ReadonlyArray<{
    id: FaintSilkIconKey;
    target: string;
    size: string;
}> = [
    {id: 'back', target: '.sully-chat-back', size: '19px 19px'},
    {id: 'actions', target: '.sully-chat-actions-button', size: '21px 21px'},
    {id: 'emoji', target: '.sully-chat-input-wrap button[aria-label="表情面板"]', size: '18px 18px'},
    {id: 'send', target: '.sully-chat-send-button[aria-label="发送文字"]', size: '21px 21px'},
    {id: 'generate', target: '.sully-chat-trigger[title="触发 AI"]', size: '19px 19px'},
];

/** A successful image gets ONE visible icon; all others retain their SVG fallback. */
export function faintSilkLoadedIconCss(loaded: ReadonlyArray<FaintSilkIconKey>): string {
    const enabled = new Set(loaded);
    return ICON_HOOKS.filter(({id}) => enabled.has(id)).map(({id,target,size}) => {
        const selector = '.sully-chat-root ' + target;
        return `${selector} {
            background-image:url("${FAINT_SILK_ICON_IMAGES[id]}")!important;
            background-position:center!important;
            background-repeat:no-repeat!important;
            background-size:${size}!important;
        }
        ${selector} > svg { visibility:hidden!important;opacity:0!important; }
        /* This hides only the icon drawing, never the button or its click target. */`;
    }).join('\n');
}

/**
 * Mount INSIDE chat's root after the user theme CSS.
 * Do not write to storage, mutate the DOM or change click handlers.
 */
export function FaintSilkIcons(): React.ReactElement | null {
    const [loaded, setLoaded] = useState<FaintSilkIconKey[]>([]);

    useEffect(() => {
        let active = true;
        const pictures: HTMLImageElement[] = [];
        (Object.entries(FAINT_SILK_ICON_IMAGES) as [FaintSilkIconKey, string][]).forEach(([id, url]) => {
            const picture = new Image();
            pictures.push(picture);
            picture.onload = () => {
                if (active && picture.naturalWidth > 0) {
                    setLoaded(previous => previous.includes(id) ? previous : [...previous, id]);
                }
            };
            picture.onerror = () => {
                // A failed external asset must never leave the original button blank.
                if (active) setLoaded(previous => previous.filter(key => key !== id));
            };
            picture.src = url;
        });
        return () => {
            active = false;
            pictures.forEach(picture => { picture.onload = null; picture.onerror = null; });
        };
    }, []);

    return loaded.length ? <style data-faint-silk-icons="loaded">{faintSilkLoadedIconCss(loaded)}</style> : null;
}
