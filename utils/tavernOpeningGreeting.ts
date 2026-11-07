import type { TavernOpeningGreeting } from '../types';

/**
 * Tavern opening cards may prefix the scene with descriptive HTML comments:
 *
 *   <!-- title: 第一幕 -->
 *   <!-- desc:
 *     雨夜的候车室
 *   -->
 *   正文……
 *
 * These are library metadata, NOT the character's spoken opening. Only
 * consecutive, complete title/desc comments at the START are extracted.
 * HTML/Markdown/code fences and arbitrary comments inside the scene are
 * intentionally left unchanged. This function is pure and idempotent, so it
 * also adapts cards already saved in IndexedDB without a destructive migration.
 */
export const adaptTavernOpeningGreeting = (greeting: TavernOpeningGreeting): TavernOpeningGreeting => {
    if (!greeting || typeof greeting.content !== 'string') return greeting;
    const source = greeting.content;
    let offset = 0;
    let title: string | undefined;
    let description: string | undefined;
    let count = 0;

    // Bounded work; an opening may contain lots of actual HTML comments.
    while (count < 8) {
        const remaining = source.slice(offset);
        const match = /^(?:\uFEFF)?[ \t\r\n]*<!--[ \t]*(title|desc|description)[ \t]*[:：]([\s\S]*?)-->/i.exec(remaining);
        if (!match) break;
        const value = match[2].trim();
        const key = match[1].toLowerCase();
        if (key === 'title') title = value || title;
        else description = value || description;
        offset += match[0].length;
        count++;
    }

    if (count === 0) return greeting;
    const body = source.slice(offset).replace(/^(?:[ \t]*\r?\n)+/, '');
    return {
        ...greeting,
        title: title || greeting.title,
        ...(description !== undefined ? { description } : {}),
        content: body,
    };
};

/**
 * Presentation-only adapter for authored Tavern greeting scenes.
 * Keep the original card bytes in IndexedDB; callers use this for the Story
 * editor, the first floor and the old first-floor reader. Never run imported
 * regex/JS/CSS. Retain the prose inside ordinary HTML formatting tags.
 *
 * This deliberately does not handle Link greetings, custom stories or regular
 * user messages, and it does not reinterpret arbitrary XML narrative tags.
 */
export const tavernOpeningReadableText = (content: string): string => {
    let text = String(content || '');
    // Inline author requests are not a title, dialogue, or a story status bar.
    // Their raw text remains available in the imported source card.
    text = text.replace(/^[ \t]*<request[ \t]*[:：][^\r\n>]{0,4096}>[ \t]*(?:\r?\n|$)/gim, '');
    text = text.replace(/^[ \t]*<request[ \t]*[:：][^\r\n>]{0,4096}>[ \t]*/i, '');

    // Fenced HTML is authored presentation; fenced CSS is purely visual.
    text = text.replace(/^[ \t]*\x60{3}(?:css|scss)\s*\r?\n[\s\S]*?^[ \t]*\x60{3}[ \t]*$/gim, '');
    text = text.replace(/^[ \t]*\x60{3}(?:html|htm)\s*\r?\n([\s\S]*?)\r?\n[ \t]*\x60{3}[ \t]*$/gim, '$1');

    // Never expose executable/style-only material to the opening editor or AI.
    text = text.replace(/<(script|style|noscript|template|svg|canvas|iframe|object|embed)\b(?:"[^"]*"|'[^']*'|[^'">])*>\s*[\s\S]*?<\/\1\s*>/gi, '');
    text = text.replace(/<!doctype\s+html[^>]*>/gi, '');

    // Remove just HTML presentation markup. This is quote-aware so CSS
    // attributes containing > do not leave broken fragments. The text nodes
    // remain intact, including dialogue, names and macro placeholders.
    const layoutTag = /<\/?(div|span|p|br|hr|h[1-6]|section|article|main|header|footer|aside|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|strong|b|em|i|u|small|mark|blockquote|figure|figcaption|center|font|a|pre|html|head|body|img)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
    const block = /^(?:div|p|br|hr|h[1-6]|section|article|main|header|footer|aside|ul|ol|li|table|thead|tbody|tfoot|tr|blockquote|figure|figcaption|pre|body|html)$/i;
    text = text.replace(layoutTag, (_whole, tag: string) => block.test(tag) ? '\n' : '');

    // A handful of common entities need decoding even without DOMParser
    // (the archive and background tests run outside a browser).
    text = text.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39|#x27);/gi, entity => {
        const table: Record<string, string> = {
            '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
            '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'",
        };
        return table[entity.toLowerCase()] ?? entity;
    });
    // An author request may appear *inside* a decorative HTML wrapper.
    text = text.replace(/^[ \t]*<request[ \t]*[:：][^\r\n>]{0,4096}>[ \t]*(?:\r?\n|$)/gim, '');
    return text.replace(/[ \t]+\r?\n/g, '\n').replace(/\r\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

/** A Tavern author note is not a dialogue line or a title. Bound its size
 * and pass it separately as scene background, never into visible first-floor text.
 */
export const tavernOpeningAuthorNote = (content: string): string => {
    const scene = adaptTavernOpeningGreeting({ id: '', title: '', content }).content;
    const rows: string[] = [];
    for (const match of scene.matchAll(/^[ \t]*<request[ \t]*[:：]([^\r\n>]{1,1600})>/gim)) {
        const note = match[1].trim();
        if (note && rows.length < 3) rows.push(note);
    }
    return rows.join('\n').slice(0, 1600);
};

/** Use the same text identity for legacy and newly normalized imports. */
export const tavernOpeningBodyKey = (greeting: TavernOpeningGreeting): string =>
    adaptTavernOpeningGreeting(greeting).content.trim();

/** Runtime-only compatibility for story messages already written before the adapter. */
export const tavernOpeningSceneText = (content: string): string =>
    tavernOpeningReadableText(adaptTavernOpeningGreeting({ id: '', title: '', content }).content);


/** Legacy first-floor messages may predate the source label. Do not flatten
 * Link or handwritten HTML when cleaning Tavern presentation artifacts.
 */
export const storyOpeningReadingText = (content: string, greetingId?: string, source?: string): string =>
    source === 'link' || source === 'custom'
    || /^(?:babylink-opening-|link-opening:|story-custom-)/.test(greetingId || '')
        ? String(content || '')
        : tavernOpeningSceneText(content);
