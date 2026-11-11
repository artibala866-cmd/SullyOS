import { alchemyInstructions, loadAlchemyRules } from './alchemyRegex';
import { storyRegexApplies, type StoryRegexContext, type StoryRegexInput } from './storyRegex';
import { runStoryRegex } from './storyRegexRunner';

export interface AlchemyRequestMessage {
    role: string;
    content: any;
}

/** Offline rules affect the model input copy only, never persisted memories or
 * messages. Every transformation stays inside the existing completion call. */
export async function applyMeetingAlchemyRequest<T extends AlchemyRequestMessage>(
    messages: T[], recentText: string, context: StoryRegexContext,
): Promise<void> {
    const rules = await loadAlchemyRules('offline');
    if (!rules.length) return;
    const floors = messages.flatMap((message, index) => {
        if (message.role !== 'user' && message.role !== 'assistant') return [];
        if (typeof message.content !== 'string') return [];
        const input: StoryRegexInput = { text: message.content, role: message.role,
            depth: messages.length - 1 - index };
        return rules.some(rule => storyRegexApplies(rule, 'history', input))
            ? [{ message, input }] : [];
    });
    if (floors.length) {
        const converted = await runStoryRegex(floors.map(floor => floor.input),
            rules, 'history');
        floors.forEach((floor, index) => {
            // Keep empty string as an empty message rather than inventing
            // text; if the source API validates nonempty history, omit it.
            floor.message.content = converted[index].text;
        });
    }
    const guides = alchemyInstructions(rules, 'offline', context, recentText);
    if (guides.length) messages.unshift({ role: 'system', content: guides.join('\n\n') } as T);
}
