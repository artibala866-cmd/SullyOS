import { useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { filterCharactersForIdentity } from '../utils/identityCharacterBinding';

/** Keep useOS().characters whole; limit only the role selection surfaces. */
export function useIdentityCharacterOptions() {
    const { characters, userProfile } = useOS();
    return useMemo(
        () => filterCharactersForIdentity(characters, userProfile.boundCharacterIds),
        [characters, userProfile.boundCharacterIds],
    );
}
