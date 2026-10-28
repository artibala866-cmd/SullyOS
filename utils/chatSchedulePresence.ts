/** Binary, read-only presence from the EXISTING daily schedule and actual chat activity.
 * Never asks an AI to write its own status. No additional scheduler or storage.
 * A recent real reply takes precedence over a planned busy/sleep slot.
 */
export type SchedulePresence = 'online' | 'offline';
export type ScheduledActivity = 'sleep' | 'busy' | 'free' | null;

export function resolveSchedulePresence(
    activity: ScheduledActivity,
    lastCharacterReplyAt = 0,
    now = Date.now(),
): SchedulePresence {
    const activeConversation = Number.isFinite(lastCharacterReplyAt)
        && lastCharacterReplyAt > 0 && lastCharacterReplyAt <= now
        && now - lastCharacterReplyAt < 3 * 60_000;
    if (activeConversation) return 'online';
    return activity === 'busy' || activity === 'sleep' ? 'offline' : 'online';
}
