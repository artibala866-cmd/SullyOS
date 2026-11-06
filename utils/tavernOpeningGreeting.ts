import type { TavernOpeningGreeting } from '../types';

/**
 * Tavern opening cards may prefix the scene with descriptive HTML comments:
 *
 *   <!-- title: 第一幕 -->
 *   <!-- desc:
 *     雨夜的候车室
 *   -->
 *   正文……
 *
 * These are library metadata, NOT the character's spoken opening. Only
 * consecutive, complete title/desc comments at the START are extracted.
 * HTML/Markdown/code fences and arbitrary comments inside the scene are
 * intentionally left unchanged. This function is pure and idempotent, so it
 * also adapts cards already saved in IndexedDB without a destructive migration.
 */
export const adaptTavernOpeningGreeting = (greeting: TavernOpeningGreeting): TavernOpeningGreeting => {
    if (!greeting || typeof greeting.content !== 'string') return greeting;
    const source = greeting.content;
    let offset = 0;
    let title: string | undefined;
    let description: string | undefined;
    let count = 0;

    // Bounded work; an opening may contain lots of actual HTML comments.
    while (count < 8) {
        const remaining = source.slice(offset);
        const match = /^(?:\uFEFF)?[ \t\r\n]*<!--[ \t]*(title|desc|description)[ \t]*[:：]([\s\S]*?)-->/i.exec(remaining);
        if (!match) break;
        const value = match[2].trim();
        const key = match[1].toLowerCase();
        if (key === 'title') title = value || title;
        else description = value || description;
        offset += match[0].length;
        count++;
    }

    if (count === 0) return greeting;
    const body = source.slice(offset).replace(/^(?:[ \t]*\r?\n)+/, '');
    return {
        ...greeting,
        title: title || greeting.title,
        ...(description !== undefined ? { description } : {}),
        content: body,
    };
};

/** Use the same text identity for legacy and newly normalized imports. */
export const tavernOpeningBodyKey = (greeting: TavernOpeningGreeting): string =>
    adaptTavernOpeningGreeting(greeting).content.trim();

/** Runtime-only compatibility for story messages already written before the adapter. */
export const tavernOpeningSceneText = (content: string): string =>
    adaptTavernOpeningGreeting({ id: '', title: '', content }).content;
