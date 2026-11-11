import { parseStoryDisplayBlocks, type StoryDisplayBlock } from './storyTheater';
import type { StoryRegexResult } from './storyRegex';

export type StoryRegexDisplayBlock = StoryDisplayBlock & { regexTemplate?: true };

export function splitStoryRegexOutput(result: StoryRegexResult) {
    if (!result.cards.length) return [result.text];
    const cards = new Map(result.cards.map(card => [card.token, card]));
    const tokens = new RegExp('(' + result.cards.map(card => card.token).join('|') + ')', 'g');
    return result.text.split(tokens).map(part => cards.get(part) ?? part);
}

export function parseStoryRegexDisplay(result: StoryRegexResult, fromTavern: boolean): StoryRegexDisplayBlock[] {
    const blocks = parseStoryDisplayBlocks(result.text, fromTavern);
    if (!result.cards.length) return blocks;
    const cards = new Map(result.cards.map(card => [card.token, card]));
    const tokens = new RegExp('(' + result.cards.map(card => card.token).join('|') + ')', 'g');
    return blocks.flatMap<StoryRegexDisplayBlock>(block => {
        const parts = block.text.split(tokens);
        const asCard = (part: string): StoryRegexDisplayBlock[] => {
            const card = cards.get(part);
            return card ? [{ kind: 'html', title: card.title, text: card.fallback, htmlSource: card.html, regexTemplate: true }] : [];
        };
        if (block.kind === 'story') return parts.flatMap(part => cards.has(part)
            ? asCard(part) : part.trim() ? [{ ...block, text: part.trim() }] : []);
        const structuredText = [block.theater?.title, block.theater?.system,
            ...(block.theater?.messages.flatMap(message => [message.name, message.text]) || [])].join('\n');
        const found = new Set((block.text + '\n' + (block.htmlSource || '') + '\n' + structuredText).match(tokens) || []);
        if (!found.size) return [block];
        const strip = (value: string) => value.replace(tokens, '').trim();
        const text = strip(block.text);
        const theater = block.theater && {
            ...block.theater,
            title: strip(block.theater.title || ''),
            system: strip(block.theater.system || ''),
            messages: block.theater.messages.map(message => ({
                ...message, name: strip(message.name), text: strip(message.text),
            })).filter(message => message.text),
        };
        return [
            ...(text ? [{ ...block, text, htmlSource: block.htmlSource?.replace(tokens, ''), theater }] : []),
            ...Array.from(found).flatMap(asCard),
        ];
    });
}
