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
 * Story-opening payloads sometimes contain an auxiliary XML-like data panel:
 * <wb_lore> ... account records, generation rules, state ... </wb_lore>.
 * Drop the WHOLE panel (not only its wrapper), without touching source-card
 * bytes, ordinary HTML content, dialogue/XML scene tags, or user messages.
 *
 * Treat well-known non-story wrapper names as auxiliary. For unfamiliar names,
 * require strongly structured status/rule content instead of a per-card list.
 */
export const stripNonStoryOpeningBlocks = (source: string): string => {
    let text = String(source || '');
    // These standalone comments are routing/component metadata, not dialogue.
    // Author comments inside actual prose, including title/desc, stay intact.
    text = text.replace(/^[ \t]*(?:<!--[ \t]*(?:route|routing|tag|slot|widget-id|panel-id)[ \t]*[:：=][^\r\n]*-->|<!--[ \t]*note[ \t]*[:：][ \t]*-->|!--[ \t]*note[ \t]*[:：][ \t]*-->)[ \t]*$/gim, '');

    // Skip standard HTML and narrative tags so nested status blocks are still
    // discoverable (and story prose wrapped in <scene> is not swallowed).
    const auxiliary = /<(?!\/)(?!(?:a|article|aside|b|blockquote|body|br|button|canvas|center|code|dd|details|div|dl|dt|em|figcaption|figure|font|footer|form|h[1-6]|head|header|hr|html|i|iframe|img|input|label|li|link|main|mark|meta|nav|ol|option|p|picture|pre|script|section|select|small|source|span|strong|style|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|u|ul|video|audio|scene|dialogue|narration|speech|quote|thought|action)\b)([a-z][a-z0-9_-]{1,60})\b(?:"[^"]*"|'[^']*'|[^'">]){0,600}>([\s\S]{0,80000}?)<\/\1\s*>/gi;
    const isAuxiliaryName = /(?:^|[_-])(?:wb|lore|worldbook|status|state|stats|meta|metadata|config|settings|init|hud|sidebar|panel|schema|registry|account|profile|social|routing|route|display|template)(?:$|[_-])/i;
    const looksStructured = (body: string): boolean => {
        const lines = body.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        if (lines.length < 3) return false;
        const records = lines.filter(line =>
            /^[\[【][^\]】\r\n]{1,150}[|｜][^\]】\r\n]{1,300}[\]】]$/.test(line)).length;
        const headings = lines.filter(line =>
            /^【[^】\r\n]{1,60}(?:要求|配置|初始化|设定|规则|状态|数据|记录|资料)[^】\r\n]*】$/.test(line)).length;
        const fields = lines.filter(line =>
            /^(?:[-*]\s*)?(?:[\w\u4e00-\u9fff]{1,24})\s*[:：=]/.test(line)).length;
        return (records >= 2 || headings >= 2) && (records + headings + fields) / lines.length >= 0.6;
    };
    // Multiple nested custom tags are possible. Re-run with a strict bound so
    // one retained (narrative) outer wrapper cannot suppress an inner panel.
    for (let pass = 0; pass < 4; pass++) {
        const next = text.replace(auxiliary, (whole, name: string, body: string) =>
            isAuxiliaryName.test(name) || looksStructured(body) ? '' : whole);
        if (next === text) break;
        text = next;
    }
    return text;
};

/**
 * Story-only plain-body extraction for imported greeting formats.
 *
 * Anything explicitly wrapped in a paired tag or decorated bracket block is
 * NOT the outside prose requested by the user. Remove the full contents,
 * regardless of the author's tag name, language, schema or asset URLs.
 *
 * This is read-time only: raw Tavern/Link cards are never mutated, nor are
 * user-authored greetings or ordinary chat messages. Unclosed structures
 * only lose their marker, never an unbounded tail of story text.
 */
export const stripWrappedOpeningPayloads = (source: string): string => {
    const input = String(source || '');
    if (!input) return '';
    const spans: Array<{ start: number; end: number }> = [];
    const add = (start: number, end: number) => {
        if (end > start) spans.push({ start, end });
    };

    // Code fences carry an embedded format, not the free-standing story.
    for (const fence of [
        /^[ \t]*\x60{3}[^\r\n]*\r?\n[\s\S]*?^[ \t]*\x60{3}[ \t]*$/gm,
        /^[ \t]*~{3}[^\r\n]*\r?\n[\s\S]*?^[ \t]*~{3}[ \t]*$/gm,
    ]) {
        for (const match of input.matchAll(fence)) add(match.index!, match.index! + match[0].length);
    }

    // Markdown links/images are wrapped external material too. Removing only
    // their [label] would leave stray (https://...) in the opening.
    for (const match of input.matchAll(/!?\[[^\]\r\n]{0,1000}\]\([^\r\n)]{0,4000}\)/g)) {
        add(match.index!, match.index! + match[0].length);
    }

    // All paired XML/HTML/custom tags, comments, instructions and declarations.
    // This is a structural rule, NOT a list of specific "wb_lore" authors.
    const tagToken = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>\r\n]{0,4096}>|<\?[\s\S]{0,4096}?\?>|<\/?[a-z][\w:.-]*(?:\s+(?:"[^"]*"|'[^']*'|[^'"><])*)?\s*\/?>|<[a-z][\w-]*\s*[:：][^>\r\n]{0,4096}>/gi;
    const opened: Array<{ name: string; start: number; end: number }> = [];
    const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    for (const match of input.matchAll(tagToken)) {
        const token = match[0], start = match.index!, end = start + token.length;
        const tag = /^<\/?([a-z][\w:.-]*)/i.exec(token);
        if (!tag || /^<request\s*[:：]/i.test(token) || /^<[a-z][\w-]*\s*[:：]/i.test(token)) {
            add(start, end); continue;
        }
        const name = tag[1].toLowerCase();
        if (token.startsWith('</')) {
            const index = opened.findLastIndex(item => item.name === name);
            if (index >= 0) {
                add(opened[index].start, end);
                opened.splice(index);
            } else add(start, end);
        } else if (/\/\s*>$/.test(token) || voidTags.has(name)) add(start, end);
        else opened.push({ name, start, end });
    }
    // Missing a closing tag is not permission to erase the rest of a novel.
    for (const item of opened) add(item.start, item.end);

    // Paired ornamental brackets and [shortcodes], including nested/wrapped
    // multiline media/status panels. Do NOT touch Chinese quote marks,
    // parentheses or literal curly braces such as {{char}}.
    const bracketPairs: Record<string, string> = {
        '【': '】', '〖': '〗', '〔': '〕', '［': '］', '[': ']',
    };
    const closing = new Set(Object.values(bracketPairs));
    const stack: Array<{ char: string; start: number }> = [];
    for (let offset = 0; offset < input.length; offset++) {
        const char = input[offset];
        if (bracketPairs[char]) stack.push({ char, start: offset });
        else if (closing.has(char)) {
            const index = stack.findLastIndex(item => bracketPairs[item.char] === char);
            if (index < 0) continue;
            add(stack[index].start, offset + 1);
            stack.splice(index);
        }
    }

    if (!spans.length) return input;
    spans.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: typeof spans = [];
    for (const span of spans) {
        const previous = merged[merged.length - 1];
        if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
        else merged.push({ ...span });
    }
    const parts: string[] = [];
    let cursor = 0;
    for (const span of merged) {
        parts.push(input.slice(cursor, span.start));
        parts.push(/[\r\n]/.test(input.slice(span.start, span.end)) ? '\n' : '');
        cursor = span.end;
    }
    parts.push(input.slice(cursor));
    return parts.join('');
};

/**
 * Discard third-party *display widgets*, not narrative links. This is format-
 * based: new authors/domains need no special-case list. Never fetch URLs.
 * A meaningful Markdown link keeps its label; prose and XML story tags survive.
 */
export const stripUnsupportedTavernOpeningEmbeds = (source: string): string => {
    let text = stripNonStoryOpeningBlocks(source);
    const mediaLabel = /(?:spotify|(?:^|[_ -])(?:music|soundtrack|playlist|song|audio|video|player|image|img|gif|picture|map|maps|location|iframe|embed|widget)(?:$|[_ -])|音乐|歌曲|音频|视频|图片|地图|播放器|外链组件)/i;
    const externalUrl = /(?:https?:\/\/|data:(?:image|audio|video)\/)/i;
    const mediaFile = /\.(?:png|jpe?g|gif|webp|svg|avif|mp3|m4a|wav|ogg|flac|aac|mp4|webm|mov)(?:[?#\s|]|$)/i;

    // A family of third-party cards uses pipe-separated fields rather than
    // the [spotify:...] shortcode:
    // 【音乐|track|caption|
    //   https://some-host/song.mp3|】 (also 〖...〗 / 〔...〕 / ［...］).
    // Classify the STRUCTURE and media payload, not a track name, host,
    // author's label or single-line layout. Bounded, paired delimiters keep
    // narrative and neighboring tags safe even when the author wraps lines.
    const closeFor: Record<string, string> = {
        '【': '】', '〖': '〗', '〔': '〕', '［': '］', '[': ']',
    };
    text = text.replace(
        /([【〖〔［\[])\s*([^|｜\r\n【】〖〗〔〕［］\[\]]{1,60})\s*[|｜]([^【】〖〗〔〕［］\[\]]{0,3500})([】〗〕］\]])/g,
        (full, open: string, rawLabel: string, fields: string, close: string) => {
            if (closeFor[open] !== close || (fields.match(/\n/g) || []).length > 8) return full;
            const label = rawLabel.trim();
            const parts = fields.split(/[|｜]/).map(part => part.trim());
            const hasRemoteResource = externalUrl.test(fields);
            // Require an actual media resource, not just a bracketed line
            // containing a URL that could be a genuine plot clue.
            const hasMediaResource = /(?:https?:\/\/|data:(?:image|audio|video)\/)[^\s|｜]{0,1800}\.(?:png|jpe?g|gif|webp|svg|avif|mp3|m4a|wav|ogg|flac|aac|mp4|webm|mov)(?:[?#\s|｜]|$)/i.test(fields)
                || /data:(?:image|audio|video)\//i.test(fields);
            const playerOrMap = /https?:\/\/[^\s|｜]+\/(?:maps?|embed|player|widget)(?:[/?#]|$)/i.test(fields);
            const knownComponent = mediaLabel.test(label)
                && hasRemoteResource && (parts.length >= 2 || hasMediaResource || playerOrMap);
            const mediaFields = parts.length >= 3 && hasRemoteResource && hasMediaResource;
            return knownComponent || mediaFields ? '' : full;
        },
    );

    // Some Tavern cards wrap external players in a Chinese decorated
    // shortcode: 【音乐|track|caption|[url|】](url|】). Its malformed-looking
    // Markdown link must be consumed *together* with the wrapper, otherwise
    // a dangling MP3 URL and "|】" remain in the first floor.
    // A line-bounded match protects prose before/after the widget and avoids
    // consuming neighboring paragraphs, even if an author's widget is broken.
    text = text.replace(
        /【\s*(音乐|背景音乐|音乐播放器|歌曲|音频|播放器|bgm|music|audio|song)\s*[|｜]([^\r\n【】]{0,3500})】(?:\]\(\s*https?:\/\/[^\r\n)]{1,4000}\))?/gi,
        (full, _kind: string, payload: string) =>
            /https?:\/\/|data:(?:image|audio|video)\//i.test(payload) || /\]\(\s*https?:\/\//i.test(full)
                ? '' : full,
    );

    // [spotify: title | decoration | cover.gif | song.mp3] and similar
    // third-party status widgets, including unknown names carrying multiple
    // external media assets. Ordinary [线索: ...] stays intact.
    text = text.replace(/\[([^\]\[\r\n:：|]{1,50})[ \t]*[:：]([^\]\[]{0,4000})\]/g,
        (full, rawLabel: string, payload: string) => {
            const label = rawLabel.trim();
            const urls = (payload.match(/https?:\/\//gi) || []).length;
            const mediaWidget = mediaLabel.test(label)
                && (externalUrl.test(payload) || payload.includes('|') || /^spotify$/i.test(label));
            const unknownMediaWidget = urls >= 2 && payload.includes('|') && mediaFile.test(payload);
            const inferredMediaWidget = urls > 0 && payload.includes('|')
                && /(?:maps?|player|music|audio|video|embed|widget|image|soundtrack|photo|地图|音乐|视频|播放)/i.test(label);
            const urlEmbeddedWidget = urls > 0 && payload.includes('|')
                && /https?:\/\/[^\s|]+\/(?:maps|embed|player|widget)(?:[/?#]|$)/i.test(payload);
            // Ordinary story metadata is never erased just for containing
            // a colon. Only verified external-media widget shapes are dropped.
            return mediaWidget || unknownMediaWidget || inferredMediaWidget || urlEmbeddedWidget ? '' : full;
        });

    // Inline/fenced media is presentation code, not a playable SullyOS item.
    text = text.replace(/<(audio|video|picture|iframe|object|embed|canvas|svg|map|form|button|select|textarea)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi, '');
    text = text.replace(/<(?:audio|video|source|track|picture|iframe|object|embed|canvas|svg|area|param|input|link|meta)\b(?:"[^"]*"|'[^']*'|[^'">])*\/?>/gi, '');

    // Inline images contribute no usable story text without the external
    // image renderer; ordinary hyperlinks preserve their visible label.
    text = text.replace(/!\[[^\]\r\n]{0,300}\]\(\s*(?:https?:\/\/|data:image\/)[^\r\n)]{1,4000}\)/gi, '');
    text = text.replace(/\[([^\]\r\n]{1,300})\]\(\s*https?:\/\/[^\r\n)]{1,4000}\)/gi, '');

    // Raw standalone direct media URLs are decorative assets. Do NOT remove
    // normal URLs mentioned in a dialogue sentence or a source note.
    text = text.replace(/^[ \t]*https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|svg|avif|mp3|m4a|wav|ogg|flac|aac|mp4|webm|mov)(?:[?#][^\s]*)?[ \t]*$/gim, '');
    text = text.replace(/^[ \t]*https?:\/\/[^\s<>"']+\/(?:maps|embed|player|widget)(?:[/?#][^\s]*)?[ \t]*$/gim, '');
    return stripWrappedOpeningPayloads(text);
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
    let text = stripUnsupportedTavernOpeningEmbeds(content);
    // Imported Tavern cards may prefix status widgets with metadata-only
    // comments. These aren't plot prose. Do not strip arbitrary comments
    // embedded in the narrative or instructions in the author's actual note.
    text = text.replace(/^[ \t]*(?:<!--\s*tag\s*:[^\r\n]*-->|<!--\s*note\s*:\s*-->|!--\s*note\s*:\s*-->)[ \t]*(?:\r?\n|$)/gim, '');
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
    const layoutTag = /<\/?(div|span|p|br|hr|h[1-6]|section|article|main|header|footer|aside|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|strong|b|em|i|u|small|mark|blockquote|figure|figcaption|center|font|a|pre|html|head|body|img|details|summary)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
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
    // The request marker may be nested inline in an author's layout,
    // including on the same line as story text after a decorative wrapper.
    text = text.replace(/<request[ \t]*[:：][^\r\n>]{0,4096}>/gi, '');
    return text.replace(/[ \t]+\r?\n/g, '\n').replace(/\r\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

/** A Tavern author note is not a dialogue line or a title. Bound its size
 * and pass it separately as scene background, never into visible first-floor text.
 */
export const tavernOpeningAuthorNote = (content: string): string => {
    const scene = adaptTavernOpeningGreeting({ id: '', title: '', content }).content;
    const rows: string[] = [];
    for (const match of scene.matchAll(/<request[ \t]*[:：]([^\r\n>]{1,1600})>/gim)) {
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
    adaptTavernOpeningGreeting({ id: '', title: '',
        content: tavernOpeningReadableText(adaptTavernOpeningGreeting({ id: '', title: '', content }).content),
    }).content;


/** Legacy first-floor messages may predate the source label. Do not flatten
 * Link or handwritten HTML when cleaning Tavern presentation artifacts.
 */
export const storyOpeningReadingText = (content: string, greetingId?: string, source?: string): string =>
    source === 'custom' || /^story-custom-/.test(greetingId || '')
        ? String(content || '')
        : source === 'link' || /^(?:babylink-opening-|link-)/.test(greetingId || '')
            ? stripUnsupportedTavernOpeningEmbeds(String(content || '')).replace(/\n{3,}/g, '\n\n').trim()
            : tavernOpeningSceneText(content);
