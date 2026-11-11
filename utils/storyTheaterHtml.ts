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
    'a abbr article aside b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img kbd label li main mark ol p pre q s samp section small span strong sub summary sup table tbody td th thead time tr u ul'.split(' '),
);
const DROP_SUBTREE = new Set(
    'script noscript iframe frame frameset object embed applet form button select textarea math audio video source link meta base portal template foreignobject animate animatemotion animatetransform set use image'.split(' '),
);
const SAFE_CSS_PROPERTIES = new Set(
    'color background background-color background-image background-position background-size background-repeat opacity font font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration text-transform text-shadow white-space word-break overflow-wrap display flex flex-direction flex-wrap align-items align-content justify-content gap row-gap column-gap grid grid-template-columns grid-template-rows grid-column grid-row width min-width max-width height min-height max-height padding padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left border border-width border-style border-color border-radius border-top border-bottom border-left border-right border-collapse box-shadow vertical-align list-style list-style-type list-style-position overflow overflow-x overflow-y object-fit'.split(' '),
);

const TEMPLATE_CSS_PROPERTIES = new Set(
    'position inset inset-block inset-inline top right bottom left z-index aspect-ratio box-sizing transform transform-origin flex-grow flex-shrink flex-basis grid-auto-flow grid-auto-rows grid-auto-columns align-self justify-self place-items place-content border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius object-position filter backdrop-filter -webkit-backdrop-filter animation animation-name animation-duration animation-delay animation-timing-function animation-iteration-count animation-direction animation-fill-mode transition transition-property transition-duration transition-timing-function cursor pointer-events text-overflow overscroll-behavior touch-action writing-mode -webkit-line-clamp -webkit-box-orient content'.split(' '),
);
const SAFE_SVG_ELEMENTS = new Set('svg g path rect circle ellipse line polyline polygon'.split(' '));
const SAFE_SVG_ATTRIBUTES = new Set('viewbox width height x y x1 y1 x2 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray opacity transform'.split(' '));

const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeCssValue = (value: string): boolean =>
    value.length <= 350
    && !/url\s*\(|@|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding|\\|[<>]|[\u0000-\u0008]/i.test(value);

const cleanDeclarations = (value: string, template: boolean): string => value.split(';')
    .map(part => {
        const index = part.indexOf(':');
        if (index < 1) return '';
        const prop = part.slice(0, index).trim().toLowerCase();
        const raw = part.slice(index + 1).trim();
        // Preserve readable text even when imported styles try to hide it.
        if (!template && ['display', 'visibility', 'opacity', 'width', 'height', 'max-height', 'font-size', 'line-height']
            .includes(prop) && /^(?:none|hidden|collapse|transparent|0(?:px|em|rem|%)?)$/i.test(raw)) return '';
        const allowed = SAFE_CSS_PROPERTIES.has(prop) || (template && (TEMPLATE_CSS_PROPERTIES.has(prop) || /^--[\w-]+$/.test(prop)));
        return allowed && safeCssValue(raw) ? prop + ':' + raw : '';
    }).filter(Boolean).join(';');

export const sanitizeStoryScopedCss = (source: string, template = false): string => {
    const css = String(source || '').slice(0, 24000).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules: string[] = [];
    // A small, CSS-only animation grammar: imported @import/@media and arbitrary
    // at-rules never execute. Keep template keyframes so marquee/danmaku can move.
    const keyframePattern = /@keyframes\s+([a-zA-Z_][\w-]{0,48})\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    const withoutFrames = template ? css.replace(keyframePattern, (_whole, name: string, body: string) => {
        const frames: string[] = [];
        const stepPattern = /(from|to|(?:100|[1-9]?\d)%)\s*\{([^{}]*)\}/g;
        const rest = body.replace(stepPattern, (_step, stop: string, declarations: string) => {
            const cleaned = cleanDeclarations(declarations, true);
            if (cleaned) frames.push(stop + '{' + cleaned + '}');
            return '';
        });
        if (!rest.trim() && frames.length && rules.length < 80) rules.push('@keyframes ' + name + '{' + frames.join('') + '}');
        return '';
    }) : css;
    for (const match of withoutFrames.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (rules.length >= 80) break;
        const rawSelector = match[1].trim();
        if (!rawSelector || /@|[{}<>\\]|:has\s*\(|:host/i.test(rawSelector) || (!template && /:root/i.test(rawSelector))) continue;
        const declarations = cleanDeclarations(match[2], template);
        if (!declarations) continue;
        const selectors = rawSelector.split(',').map(value => value.trim()).flatMap(selector => {
            if (selector.length > 150 || !/^[\w\s.#:[\]=~>"'()+*|-]+$/.test(selector)) return [];
            const root = /^(?:html|body|:root|\.ta-tpl-scope)(?=\s|[>.:#\[]|$)/i;
            if (root.test(selector)) {
                if (!template) return [];
                const child = selector.replace(root, '').replace(/^\s+body(?=\s|[>.:#\[]|$)/i, '');
                return ['.story-theater-html-content' + child];
            }
            if (/:root/i.test(selector)) return [];
            return ['.story-theater-html-content ' + selector];
        });
        if (selectors.length) rules.push(selectors.join(',') + '{' + declarations + '}');
    }
    return rules.join('\n');
};
const sanitizeNode = (node: Node, template: boolean): string => {
    if (node.nodeType === 3) return escapeHtml(node.textContent || '');
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (DROP_SUBTREE.has(tag)) return '';
    const children = Array.from(element.childNodes).map(child => sanitizeNode(child, template)).join('');
    if (tag === 'style') return '';

    // HTML templates only: inert native toggle controls allow CSS :checked
    // page switches without importing executable author-supplied JavaScript.
    if (tag === 'input') {
        if (!template) return '';
        const type = (element.getAttribute('type') || '').toLowerCase();
        if (type !== 'checkbox' && type !== 'radio') return '';
        const attrs = ['type="' + type + '"'];
        for (const key of ['id', 'name', 'class']) {
            const value = element.getAttribute(key) || '';
            if (/^[a-zA-Z0-9_ -]{1,100}$/.test(value)) attrs.push(key + '="' + escapeHtml(value) + '"');
        }
        const style = cleanDeclarations(element.getAttribute('style') || '', true);
        if (style) attrs.push('style="' + escapeHtml(style) + '"');
        if (element.hasAttribute('checked')) attrs.push('checked');
        return '<input ' + attrs.join(' ') + '>';
    }

    // Only a tiny vector-graphic whitelist is supported, with no SVG links,
    // foreignObject, animation, script or event attributes.
    if (SAFE_SVG_ELEMENTS.has(tag)) {
        if (!template) return '';
        const attrs: string[] = [];
        for (const attr of Array.from(element.attributes)) {
            const key = attr.name.toLowerCase();
            const value = attr.value.trim();
            if (!SAFE_SVG_ATTRIBUTES.has(key) || value.length > 3500 || /[<>\\]|url\s*\(|javascript:|[\u0000-\u001f]/i.test(value)) continue;
            if (key === 'd' && !/^[a-zA-Z0-9., +\-]+$/.test(value)) continue;
            if (key === 'points' && !/^[0-9., +\-]+$/.test(value)) continue;
            if (key === 'viewbox' && !/^[0-9., +\-]+$/.test(value)) continue;
            if (!['d', 'points', 'viewbox'].includes(key) && !safeCssValue(value)) continue;
            attrs.push((key === 'viewbox' ? 'viewBox' : key) + '="' + escapeHtml(value) + '"');
        }
        return '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>' + children + '</' + tag + '>';
    }

    // A blank canvas from an imported scratch-card is painted only by our
    // trusted, locally bundled iframe runtime, never by its onerror executor.
    if (tag === 'canvas') {
        if (!template) return '';
        const width = Number(element.getAttribute('width'));
        const height = Number(element.getAttribute('height'));
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 40 || height < 40
            || width > 512 || height > 512) return '';
        const style = cleanDeclarations(element.getAttribute('style') || '', true);
        return '<canvas data-story-scratch="1" width="' + width + '" height="' + height + '"'
            + (style ? ' style="' + escapeHtml(style) + '"' : '') + '></canvas>';
    }

    if (!ALLOWED_ELEMENTS.has(tag)) return children;
    const attributes: string[] = [];
    for (const attr of Array.from(element.attributes)) {
        const key = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (/^on/i.test(key) || value.length > (tag === 'img' && key === 'src' ? 150000 : 600)) continue;
        if (tag === 'details' && key === 'open') {
            attributes.push('open');
            continue;
        }
        if (key === 'style') {
            const styles = cleanDeclarations(value, template);
            if (styles) attributes.push('style="' + escapeHtml(styles) + '"');
        } else if (['class', 'id', 'title', 'alt', 'role', 'aria-label', 'dir'].includes(key)) {
            if (!/[<>\u0000-\u001f]/.test(value)) attributes.push(key + '="' + escapeHtml(value) + '"');
        } else if (tag === 'label' && key === 'for') {
            if (/^[a-zA-Z0-9_-]{1,100}$/.test(value)) attributes.push('for="' + value + '"');
        } else if (['width', 'height', 'colspan', 'rowspan'].includes(key)) {
            if (/^\d{1,4}$/.test(value)) attributes.push(key + '="' + value + '"');
        } else if (tag === 'img' && key === 'src') {
            if (value.length < 150000 && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
                attributes.push('src="' + escapeHtml(value) + '"');
            }
        }
        // No href, srcdoc, custom events or executable protocols.
    }
    if (tag === 'img') {
        if (!attributes.some(attribute => attribute.startsWith('src="'))) {
            // Script-driven dummy images are not visible artwork.
            if (template && element.hasAttribute('onerror') && !element.getAttribute('alt')) return '';
            const alt = (element.getAttribute('alt') || '').trim().slice(0, 120);
            return '<span class="story-html-image-fallback">['
                + escapeHtml(alt ? '图片：' + alt : '外部图片未加载')
                + ']</span>';
        }
        attributes.push('loading="lazy"');
    }
    if (['br', 'hr', 'img', 'col'].includes(tag)) return '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '') + '>';
    return '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '') + '>' + children + '</' + tag + '>';
};
/**
 * Ako's preset emits data blocks, and its *display-only regex* turns them
 * into a designed interlude. Implement the documented fields semantically,
 * not the user's regex executable. Unknown/partial variants return undefined
 * so no authored field disappears from the visible text fallback.
 */
export const adaptTavernWritingInterlude = (raw: string): string | undefined => {
    const names = ['Header', 'Tags', 'Meta', 'Content', 'Dialogue', 'Quote'];
    const required = [2, 3, 3, 1, 4, 2];
    const tokens = [...String(raw || '').matchAll(/\[(Header|Tags|Meta|Content|Dialogue|Quote)\|([\s\S]*?)\]/gi)];
    if (tokens.length !== names.length) return undefined;
    const fields: string[][] = [];
    for (let i = 0; i < names.length; i += 1) {
        if (tokens[i][1].toLowerCase() !== names[i].toLowerCase()) return undefined;
        const values = tokens[i][2].split('|');
        if (values.length !== required[i]) return undefined;
        fields.push(values.map(part => part.trim()));
    }
    if (raw.replace(/\[(Header|Tags|Meta|Content|Dialogue|Quote)\|[\s\S]*?\]/gi, '').trim()) {
        // Additional authored prose beyond the six blocks must not disappear.
        return undefined;
    }
    const escape = (value: string) => escapeHtml(value);
    const cells = (values: string[]): string =>
        values.map(value => '<span style="display:inline-block;padding:2px 5px">' + escape(value) + '</span>').join('');
    const [header, tags, meta, content, dialogue, quote] = fields;
    return '<article class="story-tavern-writing-interlude" style="padding:12px;border:1px solid #e5def1;border-radius:12px;background-color:#faf8ff">'
        + '<header><h3 style="font-size:19px;margin:0;color:#69428a">' + escape(header[0]) + '</h3>'
        + '<p style="font-size:12px;margin:3px 0">' + escape(header[1]) + '</p></header>'
        + '<div style="font-size:11px;color:#655e73">' + cells(tags) + '</div>'
        + '<hr><div style="display:flex;flex-wrap:wrap;font-size:11px">' + cells(meta) + '</div>'
        + '<p style="white-space:pre-wrap;font-size:13px">' + escape(content[0]) + '</p>'
        + '<section style="border-left:2px solid #dacbea;padding-left:10px">'
        + dialogue.map((value, index) => '<p style="margin:4px 0"><b>对话 ' + (index + 1) + '：</b>' + escape(value) + '</p>').join('')
        + '</section><blockquote style="font-style:italic;margin:10px 0 0;border-top:1px solid #e5def1;padding-top:8px">'
        + escape(quote[0]) + '<p style="font-size:11px">' + escape(quote[1]) + '</p></blockquote></article>';
};

export const hasStoryHtmlLayout = (source: string): boolean =>
    /<(?:div|section|article|table|thead|tbody|tr|td|th|style|img|figure|figcaption|p|h[1-6]|ul|ol|li|blockquote|pre|details|summary)\b/i.test(source);

// First-party runtime shared by all sanitized story HTML frames. Author JS
// is stripped; only this nonce-authorized bridge runs in an opaque sandbox.
// It measures natural content (not the iframe viewport) and forwards vertical
// touch gestures to the one outer story scroller.
const TRUSTED_STORY_FRAME_RUNTIME = String.raw`
(() => {
    let lastHeight = 0;
    let sizeFrame = 0;
    const postSize = () => {
        sizeFrame = 0;
        const root = document.querySelector('.story-theater-html-content');
        if (!root) return;
        // body.scrollHeight is at least the iframe viewport when imported CSS
        // uses full-height layouts. Measuring it creates an ever-growing
        // ResizeObserver → iframe-height feedback loop in long stories.
        const rect = root.getBoundingClientRect();
        const bodyTop = document.body.getBoundingClientRect().top;
        const height = Math.ceil(Math.max(root.scrollHeight, rect.height)
            + Math.max(0, rect.top - bodyTop) + 3);
        if (height === lastHeight) return;
        lastHeight = height;
        window.parent.postMessage({ type: 'sully-story-template-height', height }, '*');
    };
    const schedule = () => {
        if (!sizeFrame) sizeFrame = window.requestAnimationFrame(postSize);
    };
    document.addEventListener('click', schedule);
    document.addEventListener('change', schedule);
    window.addEventListener('load', schedule);
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(schedule);
        const root = document.querySelector('.story-theater-html-content');
        if (root) observer.observe(root);
    }
    // Pointer events inside a sandboxed iframe never bubble to the parent
    // scrollport on Android WebView. Without a bridge, scrolling a large card
    // traps the finger inside the frame, leaving the story stuck between floors.
    let touch = null;
    let inertiaFrame = 0;
    const stopInertia = () => {
        if (inertiaFrame) window.cancelAnimationFrame(inertiaFrame);
        inertiaFrame = 0;
    };
    const forward = (deltaY) => {
        if (Number.isFinite(deltaY) && Math.abs(deltaY) > .05) {
            window.parent.postMessage({ type: 'sully-story-template-scroll', deltaY }, '*');
        }
    };
    document.addEventListener('touchstart', event => {
        stopInertia();
        if (event.touches.length !== 1 ||
            event.target.closest('canvas[data-story-scratch="1"], input, textarea, select')) {
            touch = null;
            return;
        }
        const point = event.touches[0];
        touch = { x: point.clientX, y: point.clientY, time: performance.now(), velocity: 0, axis: '' };
    }, { passive: true });
    document.addEventListener('touchmove', event => {
        if (!touch || event.touches.length !== 1) return;
        const point = event.touches[0];
        const dx = Math.abs(point.clientX - touch.x);
        const dy = Math.abs(point.clientY - touch.y);
        if (!touch.axis && Math.max(dx,dy) >= 4) touch.axis = dy > dx ? 'y' : 'x';
        if (touch.axis !== 'y') return;
        event.preventDefault();
        const deltaY = touch.y - point.clientY;
        const time = performance.now();
        const elapsed = Math.max(8, time - touch.time);
        touch.velocity = touch.velocity * .35 + (deltaY / elapsed) * .65;
        touch.y = point.clientY;
        touch.time = time;
        forward(deltaY);
    }, { passive: false });
    const finishTouch = () => {
        if (!touch) return;
        const speed = touch.axis === 'y' && performance.now() - touch.time < 90 ? touch.velocity : 0;
        touch = null;
        if (Math.abs(speed) < .12) return;
        let previous = performance.now();
        let velocity = Math.max(-3, Math.min(3, speed));
        const tick = now => {
            const dt = Math.min(32, now - previous);
            previous = now;
            forward(velocity * dt);
            velocity *= Math.exp(-dt / 195);
            inertiaFrame = Math.abs(velocity) > .08 ? requestAnimationFrame(tick) : 0;
        };
        inertiaFrame = requestAnimationFrame(tick);
    };
    document.addEventListener('touchend', finishTouch, { passive: true });
    document.addEventListener('touchcancel', () => { touch = null; stopInertia(); }, { passive: true });
    document.addEventListener('wheel', event => {
        if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
        stopInertia();
        event.preventDefault();
        forward(event.deltaY);
    }, { passive: false });
    for (const canvas of document.querySelectorAll('canvas[data-story-scratch="1"]')) {
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = '#bdc3c7';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#7f8c8d';
        ctx.font = '900 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('刮开涂层', w / 2, h / 2);
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'crosshair';
        let drawing = false;
        const scratch = (event) => {
            if (!drawing) return;
            const bounds = canvas.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return;
            const x = (event.clientX - bounds.left) * w / bounds.width;
            const y = (event.clientY - bounds.top) * h / bounds.height;
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(x, y, 14, 0, Math.PI * 2);
            ctx.fill();
        };
        canvas.addEventListener('pointerdown', (event) => {
            drawing = true;
            canvas.setPointerCapture(event.pointerId);
            scratch(event);
        });
        canvas.addEventListener('pointermove', scratch);
        const end = () => {
            if (!drawing) return;
            drawing = false;
            const pixels = ctx.getImageData(0, 0, w, h).data;
            let empty = 0, count = 0;
            for (let i = 3; i < pixels.length; i += 16) {
                count++;
                if (pixels[i] === 0) empty++;
            }
            if (empty / count > 0.43) {
                canvas.style.transition = 'opacity .4s';
                canvas.style.opacity = '0';
                canvas.style.pointerEvents = 'none';
            }
            schedule();
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
    }
    schedule();
})();`;

export const sanitizeStoryTheaterHtml = (source: string, template = false): SafeStoryHtml => {
    // Do not silently truncate a large authored appendix. Keep all its text
    // in the existing plain-text fallback rather than showing a partial card.
    if (String(source || '').length > 150000) {
        return { srcDoc: '', text: 'HTML 附录过长，已使用完整文字展示', hasVisibleContent: false, estimatedHeight: 76 };
    }
    // A Tavern display-regex often produces fenced ```html blocks.
    // Accept fenced HTML from model output and user-authored templates.
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
    if (template) {
        // The exported WeChat packet uses an adjacent label without a "for"
        // attribute. Give it a scoped ID so click-to-open works without onclick.
        let toggleIndex = 0;
        for (const label of Array.from(document.querySelectorAll('label:not([for])'))) {
            const previous = label.previousElementSibling;
            if (!previous || previous.tagName.toLowerCase() !== 'input'
                || !['radio', 'checkbox'].includes((previous.getAttribute('type') || '').toLowerCase())) continue;
            const id = previous.id || 'sully-template-toggle-' + (++toggleIndex);
            previous.id = id;
            label.setAttribute('for', id);
        }
        // Separate scrolling lanes for densely stacked imported danmaku.
        const barrage = Array.from(document.querySelectorAll('.dm-i'));
        if (barrage.length >= 6 && barrage.length <= 16
            && barrage.every(item => item.parentElement === barrage[0].parentElement)) {
            const host = barrage[0].parentElement as HTMLElement;
            host.style.height = (barrage.length * 33 + 16) + 'px';
            barrage.forEach((row, index) => ((row as HTMLElement).style.top = (8 + index * 33) + 'px'));
        }
    }
    const styles = Array.from(document.querySelectorAll('style')).map(element => element.textContent || '').join('\n');
    const css = sanitizeStoryScopedCss(styles, template);
    const html = Array.from(document.body.childNodes).map(child => sanitizeNode(child, template)).join('');
    // Fallback text comes from the sanitized subtree, never script/style text.
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() || '';
    const hasVisibleContent = Boolean(html.replace(/<[^>]*>/g, '').trim() || /<(?:img|hr|table)\b/i.test(html));
    // A sandboxed iframe cannot execute resize scripts, and its opaque origin
    // forbids parent-side DOM measurements. Estimate the *visible* height from
    // sanitized content, excluding unopened nested <details> bodies. This
    // avoids a half-screen blank area for short appendices on mobile.
    const visibleDoc = new DOMParser().parseFromString(html, 'text/html');
    const visibleDetails = visibleDoc.querySelectorAll('details').length;
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
    // An open nested details wrapper needs room for its padded summary.
    // Otherwise the next (collapsed) details title can be clipped by the
    // iframe even though the content is still technically scrollable.
    // Closed <details> may show only a 1-line summary. Keep the sandbox
    // compact rather than reserving a tall empty panel for hidden content;
    // expanded content remains scrollable within the iframe.
    const estimatedHeight = Math.max(template ? 104 : 76, Math.min(520,
        (template ? 60 : 22) + lines * 22 + blockLines * 17 + visibleDetails * 32 + images * (template ? 220 : 145)));
    const baseCss = [
        'html,body{margin:0;padding:0;background:transparent;color:#334155;font:13px/1.7 system-ui,sans-serif;overflow-wrap:anywhere;overflow-y:hidden;overscroll-behavior-y:contain;touch-action:pan-x pinch-zoom}',
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
    const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-sully-story-template-runtime'"
        + "; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    const srcDoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta http-equiv="Content-Security-Policy" content="' + escapeHtml(csp) + '">'
        + '<style>' + baseCss + '</style></head><body><main class="story-theater-html-content">'
        + html + '</main>'
        + '<script nonce="sully-story-template-runtime">' + TRUSTED_STORY_FRAME_RUNTIME + '</script>'
        + '</body></html>';
    return { srcDoc, text, hasVisibleContent, estimatedHeight };
};
