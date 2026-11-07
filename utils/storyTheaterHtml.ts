/**
 * Display-only HTML adapter for Tavern story appendices.
 * It must never run imported JS, regex scripts, plugin code or user HTML in
 * SullyOS's document. The result is rendered in a scriptless sandboxed iframe.
 */
export interface SafeStoryHtml {
    srcDoc: string;
    text: string;
    hasVisibleContent: boolean;
    /** Conservative height estimate; long appendices scroll inside the sandbox. */
    estimatedHeight: number;
}

const ALLOWED_ELEMENTS = new Set(
    'a abbr article aside b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img kbd li main mark ol p pre q s samp section small span strong sub summary sup table tbody td th thead time tr u ul'.split(' '),
);
const DROP_SUBTREE = new Set(
    'script noscript iframe frame frameset object embed applet form input button select textarea svg math canvas audio video source link meta base portal template'.split(' '),
);
const SAFE_CSS_PROPERTIES = new Set(
    'color background background-color background-image background-position background-size background-repeat opacity font font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration text-transform text-shadow white-space word-break overflow-wrap display flex flex-direction flex-wrap align-items align-content justify-content gap row-gap column-gap grid grid-template-columns grid-template-rows grid-column grid-row width min-width max-width height min-height max-height padding padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left border border-width border-style border-color border-radius border-top border-bottom border-left border-right border-collapse box-shadow vertical-align list-style list-style-type list-style-position overflow overflow-x overflow-y object-fit'.split(' '),
);

const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeCssValue = (value: string): boolean =>
    value.length <= 350
    && !/url\s*\(|@|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding|\\|[<>]|[\u0000-\u0008]/i.test(value);

const cleanDeclarations = (value: string): string => value.split(';')
    .map(part => {
        const index = part.indexOf(':');
        if (index < 1) return '';
        const prop = part.slice(0, index).trim().toLowerCase();
        const raw = part.slice(index + 1).trim();
        // Preserve readable text even when imported styles try to hide it.
        if (['display', 'visibility', 'opacity', 'width', 'height', 'max-height', 'font-size', 'line-height']
            .includes(prop) && /^(?:none|hidden|collapse|transparent|0(?:px|em|rem|%)?)$/i.test(raw)) return '';
        return SAFE_CSS_PROPERTIES.has(prop) && safeCssValue(raw) ? prop + ':' + raw : '';
    }).filter(Boolean).join(';');

export const sanitizeStoryScopedCss = (source: string): string => {
    const css = String(source || '').slice(0, 24000).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules: string[] = [];
    const matches = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
    for (const match of matches) {
        if (rules.length >= 80) break;
        const rawSelector = match[1].trim();
        if (!rawSelector || /@|[{}<>\\]|:has\s*\(|:host|:root/i.test(rawSelector)) continue;
        const declarations = cleanDeclarations(match[2]);
        if (!declarations) continue;
        const selectors = rawSelector.split(',').map(s => s.trim()).filter(s =>
            s.length <= 150 && /^[\w\s.#:[\]=~>"'()+*|-]+$/.test(s)
            && !/^(?:html|body|:root)\b/i.test(s));
        if (!selectors.length) continue;
        rules.push(selectors.map(s => '.story-theater-html-content ' + s).join(',') + '{' + declarations + '}');
    }
    return rules.join('\n');
};

const sanitizeNode = (node: Node): string => {
    if (node.nodeType === 3) return escapeHtml(node.textContent || '');
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (DROP_SUBTREE.has(tag)) return '';
    const children = Array.from(element.childNodes).map(sanitizeNode).join('');
    if (tag === 'style') return '';
    if (!ALLOWED_ELEMENTS.has(tag)) return children;
    const attributes: string[] = [];
    for (const attr of Array.from(element.attributes)) {
        const key = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (/^on/i.test(key) || value.length > 180000) continue;
        if (tag === 'details' && key === 'open') {
            attributes.push('open');
            continue;
        }
        if (key === 'style') {
            const styles = cleanDeclarations(value);
            if (styles) attributes.push('style="' + escapeHtml(styles) + '"');
        } else if (['class', 'id', 'title', 'alt', 'role', 'aria-label', 'dir'].includes(key)) {
            if (!/[<>\u0000-\u001f]/.test(value)) attributes.push(key + '="' + escapeHtml(value) + '"');
        } else if (['width', 'height', 'colspan', 'rowspan'].includes(key)) {
            if (/^\d{1,4}$/.test(value)) attributes.push(key + '="' + value + '"');
        } else if (tag === 'img' && key === 'src') {
            // Only embedded images: external URLs would leak the user's
            // browsing IP/referrer to arbitrary author-controlled hosts.
            if (value.length < 150000 && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
                attributes.push('src="' + escapeHtml(value) + '"');
            }
        }
        // No href, srcdoc, custom events or executable protocols.
    }
    if (tag === 'img') attributes.push('loading="lazy"');
    if (['br', 'hr', 'img', 'col'].includes(tag)) return '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '') + '>';
    return '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '') + '>' + children + '</' + tag + '>';
};

export const hasStoryHtmlLayout = (source: string): boolean =>
    /<(?:div|section|article|table|thead|tbody|tr|td|th|style|img|figure|figcaption|p|h[1-6]|ul|ol|li|blockquote|pre|details|summary)\b/i.test(source);

export const sanitizeStoryTheaterHtml = (source: string): SafeStoryHtml => {
    // A Tavern display-regex often produces fenced ```html blocks.
    // The regex executor is deliberately absent, but the renderer can safely
    // parse HTML already present inside a code fence without showing the ticks.
    const raw = String(source || '').slice(0, 150000)
        .replace(/```html\s*\r?\n([\s\S]*?)\r?\n```/gi, (_whole, inner: string) =>
            hasStoryHtmlLayout(inner) ? inner : _whole);
    if (typeof DOMParser === 'undefined') {
        const escaped = escapeHtml(raw.replace(/<[^>]*>/g, ' ').trim());
        return {
            srcDoc: '<!doctype html><html><body><pre>' + escaped + '</pre></body></html>',
            text: raw.replace(/<[^>]*>/g, ' ').trim(),
            hasVisibleContent: Boolean(escaped),
            estimatedHeight: 220,
        };
    }
    const document = new DOMParser().parseFromString(raw, 'text/html');
    const styles = Array.from(document.querySelectorAll('style')).map(element => element.textContent || '').join('\n');
    const css = sanitizeStoryScopedCss(styles);
    const html = Array.from(document.body.childNodes).map(sanitizeNode).join('');
    // Fallback text comes from the sanitized subtree, never script/style text.
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() || '';
    const hasVisibleContent = Boolean(html.replace(/<[^>]*>/g, '').trim() || /<(?:img|hr|table)\b/i.test(html));
    // A sandboxed iframe cannot execute resize scripts, and its opaque origin
    // forbids parent-side DOM measurements. Estimate the *visible* height from
    // sanitized content, excluding unopened nested <details> bodies. This
    // avoids a half-screen blank area for short appendices on mobile.
    const visibleDoc = new DOMParser().parseFromString(html, 'text/html');
    for (const closed of Array.from(visibleDoc.querySelectorAll('details:not([open])'))) {
        const summary = closed.querySelector('summary');
        closed.replaceWith(summary ? summary.cloneNode(true) : visibleDoc.createTextNode('折叠附录'));
    }
    const visibleChars = (visibleDoc.body.textContent || '').replace(/\s+/g, ' ').trim().length;
    const viewport = typeof window === 'undefined' ? 390 : window.innerWidth;
    const charsPerLine = Math.max(22, Math.min(58, Math.floor((viewport - 64) / 13)));
    const lines = Math.ceil(visibleChars / charsPerLine);
    const blockLines = visibleDoc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,tr,summary,blockquote,pre').length;
    const images = visibleDoc.querySelectorAll('img').length;
    const estimatedHeight = Math.max(180, Math.min(520,
        76 + lines * 22 + blockLines * 15 + images * 145));
    const baseCss = [
        'html,body{margin:0;padding:0;background:transparent;color:#334155;font:13px/1.7 system-ui,sans-serif;overflow-wrap:anywhere}',
        '.story-theater-html-content{box-sizing:border-box;max-width:100%;overflow-x:auto;padding:8px 2px}',
        '.story-theater-html-content *{box-sizing:border-box;max-width:100%}',
        '.story-theater-html-content img{display:inline-block;max-width:100%;height:auto}',
        '.story-theater-html-content table{border-collapse:collapse;width:100%}',
        '.story-theater-html-content td,.story-theater-html-content th{padding:6px;border:1px solid #ddd6fe}',
        '.story-theater-html-content details{border:1px solid #ddd6fe;border-radius:8px;padding:8px;margin:6px 0}',
        '.story-theater-html-content summary{cursor:pointer;font-weight:600}',
        '.story-theater-html-content pre{white-space:pre-wrap;overflow-wrap:anywhere}',
        css,
    ].join('\n');
    const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    const srcDoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta http-equiv="Content-Security-Policy" content="' + escapeHtml(csp) + '">'
        + '<style>' + baseCss + '</style></head><body><main class="story-theater-html-content">'
        + html + '</main></body></html>';
    return { srcDoc, text, hasVisibleContent, estimatedHeight };
};
