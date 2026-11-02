/** Final DEVICE-SIDE guard for unsolicited character messages.
 * This is delivery authorization, not a conversational prompt or a new job.
 * Never gate an explicit user-turn instant response, music action or manual
 * phone/calendar interaction using the AMSG2 scheduling switch.
 */

/** The legacy [schedule_message] store contains AI-authored deferred text.
 * It has no per-message owner/consent metadata. When ALL three ways the user
 * could authorize character initiative are off, even old queued rows are
 * withdrawn, not delivered late as fresh dialogue.
 */
export function allowLegacyAiScheduledDelivery(options: {
    activeMsg2Enabled: boolean;
    realPersonEnabled: boolean;
    scheduleEnabled: boolean;
}): boolean {
    return options.activeMsg2Enabled || options.realPersonEnabled || options.scheduleEnabled;
}

/** Cloud inbox is allowed to continue explicit instant replies when AMSG2
 * scheduling is off; its scheduled pushes are NOT user-turn replies.
 * A task may already have fired or push/backfill may outlive remote cancellation.
 */
export function allowCloudAmsgDelivery(
    message: { source?: string; messageSubtype?: string; messageType?: string; taskUuid?: string | null },
    activeMsg2Enabled: boolean,
): boolean {
    if (activeMsg2Enabled) return true;
    // The current worker stamps source='scheduled'. Older workers may omit
    // source but still carry taskUuid and the AI-schedule message type.
    const legacyScheduled = !message.source && !!message.taskUuid &&
        message.messageSubtype !== 'instant-chat' &&
        message.messageSubtype !== 'job' &&
        ['fixed', 'prompted', 'auto'].includes(message.messageType || '');
    return message.source !== 'scheduled' && !legacyScheduled;
}
