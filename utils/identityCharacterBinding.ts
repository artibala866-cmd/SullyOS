/** Restricts visible character options for this identity only.
 * The actual roster, existing conversations and memory stores stay untouched. */
export function filterCharactersForIdentity<T extends { id: string }>(
    characters: T[], boundCharacterIds?: readonly string[] | null,
): T[] {
    if (!Array.isArray(boundCharacterIds) || boundCharacterIds.length === 0) return characters;
    const ids = new Set(boundCharacterIds.filter((id): id is string => typeof id === 'string'));
    return characters.filter(character => ids.has(character.id));
}
