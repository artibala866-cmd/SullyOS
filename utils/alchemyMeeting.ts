import { alchemyInstructions, loadAlchemyRules, type AlchemyDomain } from './alchemyRegex';
import { storyRegexApplies, type StoryRegexContext, type StoryRegexInput, type StoryRegexRule } from './storyRegex';
import { runStoryRegex } from './storyRegexRunner';

export interface AlchemyRequestMessage {
    role: string;
    content: any;
}

/** Apply prompt/history-stage regex on a temporary request array, not to
 * DB messages, saved histories or reusable source objects. No LLM calls. */
export async function applyAlchemyRequestHistoryRules<T extends AlchemyRequestMessage>(
    messages: T[], rules: StoryRegexRule[],
): Promise<void> {
    if (!rules.length) return;
    const floors = messages.flatMap((message, index) => {
        if (message.role !== 'user' && message.role !== 'assistant') return [];
        if (typeof message.content !== 'string') return [];
        const input: StoryRegexInput = {
            text: message.content, role: message.role, depth: messages.length - 1 - index,
        };
        return rules.some(rule => storyRegexApplies(rule, 'history', input))
            ? [{ index, input }] : [];
    });
    if (!floors.length) return;
    const converted = await runStoryRegex(floors.map(floor => floor.input), rules, 'history');
    floors.forEach((floor, index) => {
        // Replace the request array element, not the existing object: the model
        // might be supplied a reference to a message from a state snapshot.
        messages[floor.index] = {
            ...messages[floor.index], content: converted[index].text,
        };
    });
}

export async function applyAlchemyRequestHistory<T extends AlchemyRequestMessage>(
    domain: AlchemyDomain, messages: T[],
): Promise<void> {
    await applyAlchemyRequestHistoryRules(messages, await loadAlchemyRules(domain));
}

/** Offline rules run within the existing meeting completion. */
export async function applyMeetingAlchemyRequest<T extends AlchemyRequestMessage>(
    messages: T[], recentText: string, context: StoryRegexContext,
): Promise<void> {
    const rules = await loadAlchemyRules('offline');
    if (!rules.length) return;
    await applyAlchemyRequestHistoryRules(messages, rules);
    const guides = alchemyInstructions(rules, 'offline', context, recentText);
    if (guides.length) messages.unshift({ role: 'system', content: guides.join('\n\n') } as T);
}
