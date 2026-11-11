/**
 * Online alchemy HTML keeps the author's actual CSS/controls/layout inside an
 * opaque-origin iframe. This is NOT the story appendix sanitizer: that safe
 * reader deliberately strips many features needed by the original six cards.
 * Imported scripts and event handlers cannot execute, and the frame has no
 * network access or access to the parent app.
 */
export interface AlchemySandboxDocument {
    srcDoc: string;
    hasVisibleContent: boolean;
}
const MAX_TEMPLATE_HTML = 150000;
const escapeAttr = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const BRIDGE = "(() => {\n const postSize = () => {\n  const height = Math.ceil(Math.max(document.documentElement.scrollHeight,\n   document.body.scrollHeight,document.body.getBoundingClientRect().bottom)+2);\n  parent.postMessage({type:'sully-alchemy-template-height',height},'*');\n };\n const update=()=>requestAnimationFrame(postSize);\n document.addEventListener('click',update);\n document.addEventListener('change',update);\n addEventListener('load',update);\n if('ResizeObserver' in window){\n  const resize=new ResizeObserver(update);resize.observe(document.body);\n }\n for(const canvas of document.querySelectorAll('canvas[data-alchemy-scratch]')){\n  const ctx=canvas.getContext('2d');\n  if(!ctx||canvas.width<40||canvas.height<40)continue;\n  const w=canvas.width,h=canvas.height;\n  ctx.fillStyle='#bdc3c7';ctx.fillRect(0,0,w,h);\n  ctx.fillStyle='#7f8c8d';ctx.font='bold 18px sans-serif';\n  ctx.textAlign='center';ctx.textBaseline='middle';\n  ctx.fillText('刮开涂层',w/2,h/2);\n  canvas.style.touchAction='none';\n  let drawing=false;\n  const scratch=(event)=>{\n   if(!drawing)return;\n   const box=canvas.getBoundingClientRect();\n   if(!box.width||!box.height)return;\n   const x=(event.clientX-box.left)*w/box.width;\n   const y=(event.clientY-box.top)*h/box.height;\n   ctx.globalCompositeOperation='destination-out';\n   ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.fill();\n  };\n  canvas.addEventListener('pointerdown',(event)=>{\n   drawing=true;\n   try{canvas.setPointerCapture(event.pointerId);}catch{}\n   scratch(event);\n  });\n  canvas.addEventListener('pointermove',scratch);\n  const finish=()=>{\n   if(!drawing)return;drawing=false;\n   const data=ctx.getImageData(0,0,w,h).data;\n   let empty=0,total=0;\n   for(let index=3;index<data.length;index+=16){\n    total++;if(data[index]===0)empty++;\n   }\n   if(empty/Math.max(total,1)>0.43){\n    canvas.style.opacity='0';canvas.style.pointerEvents='none';\n   }\n   update();\n  };\n  canvas.addEventListener('pointerup',finish);\n  canvas.addEventListener('pointercancel',finish);\n }\n update();\n})();";


export function buildAlchemySandboxDocument(source: string): AlchemySandboxDocument {
    if (!source.trim() || source.length > MAX_TEMPLATE_HTML || typeof DOMParser === 'undefined')
        return { srcDoc: '', hasVisibleContent: false };
    const document = new DOMParser().parseFromString(source, 'text/html');
    // Never execute author-supplied scripts. Reject nested browsing contexts.
    document.querySelectorAll('script, iframe, frame, frameset, object, embed, applet, form, base, meta, link')
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
    // Inline event attributes are not allowed in the opaque frame. CSS-only
    // radio tabs, animations, styling, buttons and authored SVG stay intact.
    for (const element of document.querySelectorAll('*')) {
        for (const attr of Array.from(element.attributes)) {
            if (/^on/i.test(attr.name)) element.removeAttribute(attr.name);
        }
    }

    const body = document.body.innerHTML;
    const styles = Array.from(document.head.querySelectorAll('style'))
        .map(node => node.outerHTML).join('');
    // Dynamic nonce; imported markup cannot supply its own executable script.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const nonce = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    const csp = [
        "default-src 'none'", "base-uri 'none'", "frame-src 'none'",
        "object-src 'none'", "connect-src 'none'", "form-action 'none'",
        "img-src data: blob:", "font-src data: blob:",
        "style-src 'unsafe-inline'", "script-src 'nonce-" + nonce + "'",
    ].join('; ');
    const srcDoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta http-equiv="Content-Security-Policy" content="' + escapeAttr(csp) + '">'
        + '<style>html,body{margin:0;padding:0;background:transparent;}body{overflow-x:hidden;}</style>'
        + styles + '</head><body>' + body
        + '<script nonce="' + nonce + '">' + BRIDGE + '</script></body></html>';
    return { srcDoc, hasVisibleContent: Boolean(body.trim()) };
}
