import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildAlchemySandboxDocument } from '../../utils/alchemyHtml';

/** Automatically renders an imported HTML card in private/group messages.
 * No manual preview, extra API call, app-origin script or saved-text rewrite. */
export default function AlchemyHtmlFrame({
    html, fallback, title,
}: { html: string; fallback: string; title: string }) {
    const safe = useMemo(() => buildAlchemySandboxDocument(html), [html]);
    const frame = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(safe.estimatedHeight);
    useEffect(() => { setHeight(safe.estimatedHeight); }, [safe.estimatedHeight, safe.srcDoc]);
    useEffect(() => {
        if (!safe.hasVisibleContent) return;
        const handler = (event: MessageEvent) => {
            if (event.source !== frame.current?.contentWindow ||
                event.data?.type !== 'sully-alchemy-template-height') return;
            const pixels = event.data.height;
            if (typeof pixels !== 'number' || !Number.isFinite(pixels)) return;
            setHeight(Math.max(76, Math.min(1100, Math.ceil(pixels))));
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [safe.hasVisibleContent]);
    if (!safe.hasVisibleContent) return <span className="whitespace-pre-wrap">{fallback}</span>;
    return <iframe ref={frame} title={title} srcDoc={safe.srcDoc}
        sandbox="allow-scripts" referrerPolicy="no-referrer" loading="eager"
        className="block w-full border-0 bg-transparent"
        style={{ height, minHeight: 76, maxWidth: '100%' }}/>;
}
