import React from 'react';
import { splitStoryRegexOutput } from '../../utils/storyRegexDisplay';
import type { StoryRegexResult } from '../../utils/storyRegex';
import AlchemyHtmlFrame from './AlchemyHtmlFrame';

export default function AlchemyMessageBody({ result }: { result: StoryRegexResult }) {
    return <div className="min-w-0 max-w-full whitespace-pre-wrap break-words" data-alchemy-rendered="online">
        {splitStoryRegexOutput(result).map((part, index) => typeof part === 'string'
            ? <React.Fragment key={index}>{part}</React.Fragment>
            : part.renderMode === 'inline'
                ? <span key={part.token} className="inline-block max-w-full align-middle"
                    onClick={event => event.stopPropagation()}>
                    <AlchemyHtmlFrame html={part.html} fallback={part.fallback} title={part.title} />
                  </span>
                : <div key={part.token} className="my-1 w-full max-w-[360px]"
                    onClick={event => event.stopPropagation()}>
                    <AlchemyHtmlFrame html={part.html} fallback={part.fallback} title={part.title} />
                  </div>)}
    </div>;
}
