import { applyStoryRegex, type StoryRegexRule } from './storyRegex';

self.onmessage = (event: MessageEvent<{ texts: string[]; rules: StoryRegexRule[]; stage: 'display' | 'history' }>) => {
    const { texts, rules, stage } = event.data;
    try {
        self.postMessage({ results: texts.map(text => applyStoryRegex(text, rules, stage)) });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : '正则处理失败' });
    }
};
