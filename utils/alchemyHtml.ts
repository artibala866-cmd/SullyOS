/**
 * Online alchemy HTML keeps the author's actual CSS/controls/layout inside an
 * opaque-origin iframe. This is NOT the story appendix sanitizer: that safe
 * reader deliberately strips many features needed by the original six cards.
 * Imported scripts and event handlers run only inside a sandboxed, opaque-origin
 * frame. CSP blocks network, external scripts, navigation and form submission;
 * the authored local interactions must not be silently reduced to decoration.
 */
export interface AlchemySandboxDocument {
    srcDoc: string;
    hasVisibleContent: boolean;
    estimatedHeight: number;
}
const MAX_TEMPLATE_HTML = 150000;
const escapeAttr = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const BRIDGE = `(() => {
  let queued = false;
  let lastHeight = 0, lastWidth = 0;
  const postSize = () => {
    // The iframe viewport itself grows when the parent changes its height.
    // Measuring html/body.scrollHeight feeds that new height back forever and
    // can clip, jump or balloon cards when a tab/accordion is opened.
    let bottom = 0, right = 0, checked = 0;
    for (const element of document.body.querySelectorAll('*')) {
      if (++checked > 1600) break;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.position === 'fixed') continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      bottom = Math.max(bottom, rect.bottom + window.scrollY,
        rect.top + window.scrollY + Math.max(rect.height, element.scrollHeight || 0));
      right = Math.max(right, rect.right + window.scrollX,
        rect.left + window.scrollX + Math.max(rect.width, element.scrollWidth || 0));
    }
    // Plain text outside tags also needs a real content measurement.
    for (const child of document.body.childNodes) {
      if (child.nodeType !== 3 || !child.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const rect of range.getClientRects()) {
        bottom = Math.max(bottom, rect.bottom + window.scrollY);
        right = Math.max(right, rect.right + window.scrollX);
      }
    }
    let measured = Math.max(76, Math.ceil(bottom + 2));
    if (Math.abs(measured - window.innerHeight) <= 4)
      measured = Math.round(window.innerHeight);
    const measuredWidth = Math.max(1, Math.ceil(right));
    if (Math.abs(measured - lastHeight) <= 2 &&
        Math.abs(measuredWidth - lastWidth) <= 2) return;
    lastHeight = measured;
    lastWidth = measuredWidth;
    parent.postMessage({ type: 'sully-alchemy-template-height', height: measured, width: measuredWidth }, '*');
  };
  const update = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; postSize(); });
  };
  const afterInteraction = () => {
    update();
    setTimeout(update, 120);
    setTimeout(update, 400);
  };
  for (const eventName of ['click', 'change', 'input', 'pointerup', 'transitionend', 'animationend']) {
    document.addEventListener(eventName, afterInteraction, true);
  }
  document.addEventListener('toggle', afterInteraction, true);
  window.addEventListener('resize', afterInteraction);
  window.addEventListener('load', afterInteraction);
  document.addEventListener('load', afterInteraction, true);
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    observer.observe(document.body);
  }
  if ('MutationObserver' in window) {
    new MutationObserver(update).observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open'],
    });
  }
  for (const image of document.images) image.addEventListener('load', afterInteraction);
  for (const canvas of document.querySelectorAll('canvas[data-alchemy-scratch]')) {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width < 40 || canvas.height < 40) continue;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#bdc3c7'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7f8c8d'; ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('刮开涂层', w / 2, h / 2);
    canvas.style.touchAction = 'none';
    let drawing = false;
    const scratch = event => {
      if (!drawing) return;
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x = (event.clientX - box.left) * w / box.width;
      const y = (event.clientY - box.top) * h / box.height;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill();
    };
    canvas.addEventListener('pointerdown', event => {
      drawing = true;
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      scratch(event);
    });
    canvas.addEventListener('pointermove', scratch);
    const finish = () => {
      if (!drawing) return;
      drawing = false;
      const data = ctx.getImageData(0, 0, w, h).data;
      let empty = 0, total = 0;
      for (let index = 3; index < data.length; index += 16) {
        total++; if (data[index] === 0) empty++;
      }
      if (empty / Math.max(total, 1) > 0.43) {
        canvas.style.opacity = '0'; canvas.style.pointerEvents = 'none';
      }
      afterInteraction();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
  }
  afterInteraction();
})();`;


export function buildAlchemySandboxDocument(source: string): AlchemySandboxDocument {
    if (!source.trim() || source.length > MAX_TEMPLATE_HTML || typeof DOMParser === 'undefined')
        return { srcDoc: '', hasVisibleContent: false, estimatedHeight: 220 };
    const document = new DOMParser().parseFromString(source, 'text/html');
    // Keep user-imported local scripts, inline interactions, forms and CSS:
    // an opaque-origin sandbox plus restrictive CSP isolates them from the app.
    // Nested frames, external stylesheets, plugins and base URLs remain blocked.
    document.querySelectorAll('iframe, frame, frameset, object, embed, applet, base, meta, link')
        .forEach(node => node.remove());

    // Preserve the original WeChat packet's checkbox/label interaction.
    let toggleIndex = 0;
    for (const label of document.querySelectorAll('label:not([for])')) {
        const input = label.previousElementSibling;
        if (input?.tagName.toLowerCase() !== 'input'
            || !['radio', 'checkbox'].includes(input.getAttribute('type') || '')) continue;
        const id = input.id || 'alchemy-toggle-' + (++toggleIndex);
        input.id = id;
        label.setAttribute('for', id);
    }

    // The source scratch-card uses an image-onerror JS bootstrap. Substitute
    // only that bootstrap with first-party drawing gestures on the same canvas.
    for (const img of document.querySelectorAll('img[onerror]')) {
        const handler = img.getAttribute('onerror') || '';
        const canvas = img.parentElement?.querySelector('canvas');
        if (canvas && /getContext|canvas/i.test(handler)) {
            canvas.setAttribute('data-alchemy-scratch', '1');
            img.remove();
        }
    }
    // Authored onclick/change handlers may power real controls (not decoration).
    // They stay in the isolated document; remote fetch and navigation are blocked.

    // Layout fidelity while a lazy/mobile browser has not yet delivered
    // the iframe height message. The first authored element's explicit height
    // takes precedence; larger CSS tab-panels and scratch canvases are next.
    const rootStyle = document.body.firstElementChild?.getAttribute('style') || '';
    const rootPixels = Number(/(?:^|;)\s*height\s*:\s*(\d+)px/i.exec(rootStyle)?.[1] || 0);
    const cssText = Array.from(document.querySelectorAll('style'))
        .map(node => node.textContent || '').join(' ');
    const cssHeights = [...cssText.matchAll(/(?:^|[;{])\s*height\s*:\s*(\d+)px/gi)]
        .map(match => Number(match[1])).filter(value => value > 250 && value < 850);
    const panelPixels = cssHeights.length ? Math.max(...cssHeights) + 42 : 0;
    const estimatedHeight = Math.max(110, Math.min(900,
        rootPixels ? rootPixels + 24 : panelPixels || (document.querySelector('canvas') ? 360 : 220)));

    const body = document.body.innerHTML;
    const styles = Array.from(document.head.querySelectorAll('style,script'))
        .map(node => node.outerHTML).join('');
     const csp = [
        "default-src 'none'", "base-uri 'none'", "frame-src 'none'",
        "object-src 'none'", "connect-src 'none'", "form-action 'none'",
        "img-src data: blob: https:", "font-src data: blob: https:",
        "style-src 'unsafe-inline'", "script-src 'unsafe-inline'",
    ].join('; ');
    const srcDoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta http-equiv="Content-Security-Policy" content="' + escapeAttr(csp) + '">'
        + '<style>html,body{margin:0;padding:0;background:transparent;}body{overflow-x:auto;overflow-y:visible;max-width:100%;}</style>'
        + styles + '</head><body>' + body
        + '<script>' + BRIDGE + '</script></body></html>';
    return { srcDoc, hasVisibleContent: Boolean(body.trim()), estimatedHeight };
}
