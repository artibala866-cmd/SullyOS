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
    greetings: cards.some(card => (card.character.tavernGreetings || [])
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
    const fields: Partial<CharacterProfile> = selected.persona
        ? { ...card.character }
        : { name: card.character.name };
    if (!selected.greetings) delete fields.tavernGreetings;
    else if (!selected.persona) fields.tavernGreetings = card.character.tavernGreetings;
    return { fields, worldbooks: selected.worldbooks ? card.worldbooks : [] };
};
