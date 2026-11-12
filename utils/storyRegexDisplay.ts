import { parseStoryDisplayBlocks, type StoryDisplayBlock } from './storyTheater';
import type { StoryRegexResult } from './storyRegex';

export type StoryRegexDisplayBlock = StoryDisplayBlock & { regexTemplate?: true };

/**
 * Display-only: hide standalone Tavern status panels, not the authored
 * opening, saved floors, editor content, or model history. Nested {{user}}
 * macros are balanced rather than mistaken for the end of the panel.
 */
export function hideStoryStatusForDisplay(source: string): string {
    const value = String(source || '');
    if (!value.includes('{')) return value;
    const statusKeys = new Set(['时间', '地点', '纠缠', '状态', '衣着', '心声', '渴望', '备忘', '记账', '广阅']);
    let output = '';
    let cursor = 0;
    for (let index = 0; index < value.length; index++) {
        if (value[index] !== '{' || value[index + 1] === '{') continue;
        // A status panel is a standalone line/block, never part of dialogue.
        const lineStart = value.lastIndexOf('\n', index - 1) + 1;
        if (value.slice(lineStart, index).trim()) continue;
        if (!/^\s*(?:时间|地点|纠缠|状态|衣着|心声|渴望|备忘|记账|广阅)\s*[:：]/u.test(value.slice(index + 1, index + 40))) continue;
        let depth = 1;
        let close = -1;
        // Bounded scan: an unmatched brace cannot stall a long story.
        for (let at = index + 1; at < Math.min(value.length, index + 40000); at++) {
            if (value[at] === '{') depth++;
            else if (value[at] === '}' && --depth === 0) {
                close = at;
                break;
            }
        }
        if (close < 0) continue;
        const body = value.slice(index + 1, close);
        const fields: string[] = [];
        let partStart = 0;
        let nested = 0;
        for (let at = 0; at < body.length; at++) {
            if (body[at] === '{') nested++;
            else if (body[at] === '}') nested = Math.max(0, nested - 1);
            else if (nested === 0 && (body[at] === '|' || body[at] === '｜')) {
                fields.push(body.slice(partStart, at));
                partStart = at + 1;
            }
        }
        fields.push(body.slice(partStart));
        const labels = fields.map(field => /^\s*([\u4e00-\u9fff]{1,8})\s*[:：]/u.exec(field)?.[1])
            .filter((key): key is string => !!key && statusKeys.has(key));
        if (!labels.includes('时间') || !labels.includes('地点')) continue;
        output += value.slice(cursor, index);
        cursor = close + 1;
        index = close;
    }
    return cursor ? output + value.slice(cursor) : value;
}


export function splitStoryRegexOutput(result: StoryRegexResult) {
    if (!result.cards.length) return [result.text];
    const cards = new Map(result.cards.map(card => [card.token, card]));
    const tokens = new RegExp('(' + result.cards.map(card => card.token).join('|') + ')', 'g');
    return result.text.split(tokens).map(part => cards.get(part) ?? part);
}

export function parseStoryRegexDisplay(result: StoryRegexResult, fromTavern: boolean): StoryRegexDisplayBlock[] {
    const blocks = parseStoryDisplayBlocks(hideStoryStatusForDisplay(result.text), fromTavern);
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
