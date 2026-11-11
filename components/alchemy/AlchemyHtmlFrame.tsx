import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildAlchemySandboxDocument } from '../../utils/alchemyHtml';

/** Render actual author HTML controls inside a network-restricted opaque sandbox.
 * A fixed-width card is fitted as a whole on narrow phones, not cropped. */
export default function AlchemyHtmlFrame({
    html, fallback, title,
}: { html: string; fallback: string; title: string }) {
    const safe = useMemo(() => buildAlchemySandboxDocument(html), [html]);
    const shell = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(safe.estimatedHeight);
    const [contentWidth, setContentWidth] = useState(0);
    const [availableWidth, setAvailableWidth] = useState(0);
    useEffect(() => {
        setHeight(safe.estimatedHeight);
        setContentWidth(0);
    }, [safe.estimatedHeight, safe.srcDoc]);
    useEffect(() => {
        const element = shell.current;
        if (!element) return;
        const measure = () => setAvailableWidth(Math.max(1, element.clientWidth));
        measure();
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(measure);
            observer.observe(element);
            return () => observer.disconnect();
        }
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [safe.hasVisibleContent]);
    useEffect(() => {
        if (!safe.hasVisibleContent) return;
        const handler = (event: MessageEvent) => {
            if (event.source !== frame.current?.contentWindow ||
                event.data?.type !== 'sully-alchemy-template-height') return;
            const pixels = event.data.height;
            if (typeof pixels === 'number' && Number.isFinite(pixels))
                setHeight(Math.max(76, Math.min(48000, Math.ceil(pixels))));
            const width = event.data.width;
            if (typeof width === 'number' && Number.isFinite(width))
                setContentWidth(Math.max(0, Math.min(1600, Math.ceil(width))));
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [safe.hasVisibleContent]);
    if (!safe.hasVisibleContent) return <span className="whitespace-pre-wrap">{fallback}</span>;

    // Keep the iframe layout width large enough for the original author card;
    // transform only its presentation. Pointer targets scale along with it.
    const viewport = Math.max(1, availableWidth || 320);
    const frameWidth = Math.max(viewport, contentWidth);
    const scale = Math.min(1, viewport / frameWidth);
    return <div ref={shell} className="relative block w-full max-w-full"
        style={{ height: Math.ceil(height * scale), minHeight: Math.ceil(76 * scale) }}>
        <iframe ref={frame} title={title} srcDoc={safe.srcDoc}
            sandbox="allow-scripts" referrerPolicy="no-referrer" loading="eager"
            className="absolute left-0 top-0 block border-0 bg-transparent"
            style={{ width: frameWidth, height, transform: `scale(${scale})`,
                transformOrigin: 'top left' }}/>
    </div>;
}
