import type { CharacterProfile } from '../types';
import type { PreparedCharacterCard } from './sillyTavernCard';

/**
 * Optional sections for importing/re-importing Tavern, native and Link cards.
 * Defaults can follow availability, while disabled sections are never written.
 */
export interface CardImportSections {
    persona: boolean;
    worldbooks: boolean;
    greetings: boolean;
}

export const availableCardImportSections = (cards: PreparedCharacterCard[]): CardImportSections => ({
    persona: cards.some(card => Boolean(
        card.character.description?.trim() ||
        card.character.systemPrompt?.trim() ||
        card.character.worldview?.trim() ||
        card.character.avatar ||
        card.avatarFile ||
        card.imageProfile
    )),
    worldbooks: cards.some(card => card.worldbooks.length > 0),
    greetings: cards.some(card =>
        [...(card.character.tavernGreetings || []), ...(card.character.linkGreetings || [])]
            .some(greeting => greeting.content.trim())),
});

export const effectiveCardImportSections = (
    cards: PreparedCharacterCard[],
    selected: CardImportSections,
): CardImportSections => {
    const available = availableCardImportSections(cards);
    return {
        persona: selected.persona && available.persona,
        worldbooks: selected.worldbooks && available.worldbooks,
        greetings: selected.greetings && available.greetings,
    };
};

export const hasCardImportSelection = (sections: CardImportSections): boolean =>
    sections.persona || sections.worldbooks || sections.greetings;

/**
 * Keep the name solely for identity lookup when persona is not selected.
 * No inherited avatar, persona, openings or worldbook data may slip through.
 */
export const selectCardImportSections = (
    card: PreparedCharacterCard,
    selected: CardImportSections,
): { fields: Partial<CharacterProfile>; worldbooks: PreparedCharacterCard['worldbooks'] } => {
    const fields: Partial<CharacterProfile> = { name: card.character.name };
    if (selected.persona) {
        // Explicit allowlist: "only import persona" must never import a native
        // card's unrelated runtime state (voice, cloud tasks, phone data,
        // local preferences, memories, scripts etc.) by object spreading.
        for (const key of ['description','systemPrompt','worldview','avatar'] as const) {
            const value = card.character[key];
            if (value !== undefined) fields[key] = value;
        }
    }
    if (selected.greetings) {
        if (card.source === 'babylink-character') fields.linkGreetings = card.character.linkGreetings;
        else {
            fields.tavernGreetings = card.character.tavernGreetings;
            if (card.source === 'sully' && card.character.linkGreetings?.length)
                fields.linkGreetings = card.character.linkGreetings;
        }
    }
    return { fields, worldbooks: selected.worldbooks ? card.worldbooks : [] };
};
