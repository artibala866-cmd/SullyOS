import { applyStoryRegex, type StoryRegexInput, type StoryRegexRule, type StoryRegexContext } from './storyRegex';

self.onmessage = (event: MessageEvent<{
    texts: (string | StoryRegexInput)[]; rules: StoryRegexRule[]; stage: 'display' | 'history'; context: StoryRegexContext;
}>) => {
    const { texts, rules, stage, context } = event.data;
    try {
        self.postMessage({ results: texts.map(text => applyStoryRegex(text, rules, stage, context)) });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : '正则处理失败' });
    }
};
