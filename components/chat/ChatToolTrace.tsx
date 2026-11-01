import React, {useLayoutEffect, useRef} from 'react';

/** Small geometry contract for the informational tool trace below an AI reply.
 * Unlike a negative -mt-N, the hint never pulls upward into a compact bubble,
 * an absolutely positioned timestamp, or a whitebox's custom message spacing.
 */
type Rect = Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>;
export function calculateToolTracePlacement(
    row: Rect,
    bubbleColumn: Pick<DOMRect, 'left'> | null,
    timestamp: Pick<DOMRect, 'bottom'> | null,
): {paddingLeft: number; paddingTop: number} {
    // The message column is the only reliable horizontal anchor: whiteboxes
    // can move avatars, change bubble width, and even center certain cards.
    const desiredLeft = bubbleColumn ? bubbleColumn.left - row.left : 48;
    const paddingLeft = Math.round(Math.min(Math.max(0, row.width - 80), Math.max(0, desiredLeft)));
    // Message timestamps are positioned outside their normal layout box.
    // Keep the trace below the real timestamp even if a preset removed the
    // bubble's bottom margin or put the timestamp under a quoted message.
    const paddingTop = timestamp ? Math.max(0, Math.ceil(timestamp.bottom - row.top + 4)) : 0;
    return {paddingLeft, paddingTop};
}

export default function ChatToolTrace({text}: {text:string}) {
    const traceRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const row = traceRef.current;
        const host = row?.parentElement;
        if (!row || !host) return;
        const column = host.querySelector<HTMLElement>('.sully-chat-message-content');
        const stamp = host.querySelector<HTMLElement>('.sully-chat-message-timestamp');
        const message = host.querySelector<HTMLElement>('.sully-chat-message');
        const measure = () => {
            if (!row.isConnected) return;
            const values = calculateToolTracePlacement(
                row.getBoundingClientRect(),
                column?.getBoundingClientRect() || null,
                stamp?.getBoundingClientRect() || null,
            );
            const left = values.paddingLeft + 'px';
            const top = values.paddingTop + 'px';
            if (row.style.paddingLeft !== left) row.style.paddingLeft = left;
            if (row.style.paddingTop !== top) row.style.paddingTop = top;
        };
        measure();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        if (observer) {
            if (message) observer.observe(message);
            if (column) observer.observe(column);
            observer.observe(row);
        }
        window.addEventListener('resize', measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [text]);

    return (
        <div ref={traceRef} className="sully-chat-tool-trace relative box-border w-full max-w-full min-w-0 mb-4 px-3" role="note">
            <div data-tool-trace-text className="min-w-0 text-[10px] leading-relaxed text-slate-400 break-words" style={{overflowWrap:'anywhere'}}>
                调用了工具：{text}
            </div>
        </div>
    );
}
