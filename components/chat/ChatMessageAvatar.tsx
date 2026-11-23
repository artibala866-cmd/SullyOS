import React, { useEffect, useMemo, useState } from 'react';
import TokenImg from '../os/TokenImg';

type Props = {
    src?: string | null;
    fallbackSrc?: string | null;
    label: string;
    shapeClass: string;
};

/**
 * Private-chat avatar with a real-image fallback chain.
 * Keep a visible initials tile underneath while BlobRef URLs resolve; if an
 * imported/stale avatar URL fails, try the character/user's base profile photo
 * before falling back to the participant's initial.
 */
const ChatMessageAvatar: React.FC<Props> = ({ src, fallbackSrc, label, shapeClass }) => {
    const candidates = useMemo(
        () => Array.from(new Set([src, fallbackSrc].filter((value): value is string =>
            typeof value === 'string' && value.trim().length > 0))),
        [src, fallbackSrc],
    );
    const [failedSources, setFailedSources] = useState<string[]>([]);

    useEffect(() => {
        setFailedSources([]);
    }, [src, fallbackSrc]);

    const activeSource = candidates.find(candidate => !failedSources.includes(candidate));
    const initial = Array.from(label.trim())[0] || '·';

    return (
        <div
            className={`sully-chat-avatar-content absolute inset-0 flex items-center justify-center overflow-hidden ${shapeClass}`}
            role="img"
            aria-label={label}
        >
            <span className="sully-chat-avatar-fallback absolute inset-0 flex items-center justify-center" aria-hidden="true">
                {initial}
            </span>
            {activeSource && (
                <TokenImg
                    value={activeSource}
                    alt=""
                    aria-hidden="true"
                    loading="eager"
                    decoding="async"
                    className={`sully-chat-message-avatar-img absolute inset-0 block w-full h-full ${shapeClass} object-cover shadow-sm ring-1 ring-black/5 z-0`}
                    onError={() => setFailedSources(current =>
                        current.includes(activeSource) ? current : [...current, activeSource]
                    )}
                />
            )}
        </div>
    );
};

export default ChatMessageAvatar;
