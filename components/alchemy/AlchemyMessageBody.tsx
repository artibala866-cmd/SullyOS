import React from 'react';
import { splitStoryRegexOutput } from '../../utils/storyRegexDisplay';
import type { StoryRegexResult } from '../../utils/storyRegex';
import { SafeStoryHtml } from '../date/story/StoryTheaterSession';

export default function AlchemyMessageBody({ result }: { result: StoryRegexResult }) {
    return <div className="min-w-0 max-w-full whitespace-pre-wrap break-words" data-alchemy-rendered="online">
        {splitStoryRegexOutput(result).map((part, index) => typeof part === 'string'
            ? <React.Fragment key={index}>{part}</React.Fragment>
            : <div key={part.token} className="my-1 w-full max-w-[340px]" onClick={event => event.stopPropagation()}>
                <SafeStoryHtml source={part.html} fallback={part.fallback} title={part.title} template />
              </div>)}
    </div>;
}
