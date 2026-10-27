import type { CharacterProfile } from '../types';
/** Per-character emotion switch; independent of the schedule. */
export function isEmotionBuffEnabled(char: Pick<CharacterProfile, 'emotionConfig'> | null | undefined): boolean {
    return char?.emotionConfig?.enabled === true;
}
