import type { CharacterProfile } from '../types';

/**
 * Emotion Buff is opt-in per character and independent of schedule.
 * Legacy emotionConfig.enabled may be true because old schedules enabled it;
 * never interpret that field as an explicit independent opt-in.
 */
export function isEmotionBuffEnabled(
    char: Pick<CharacterProfile, 'emotionBuffEnabled'> | null | undefined,
): boolean {
    return char?.emotionBuffEnabled === true;
}
