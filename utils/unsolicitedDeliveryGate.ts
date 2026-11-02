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
    message: { source?: string; messageSubtype?: string },
    activeMsg2Enabled: boolean,
): boolean {
    // Only the AMSG scheduled channel is master-gated. Background tools,
    // instant chat, emotion returns and non-AMSG app interactions are separate.
    return message.source !== 'scheduled' || activeMsg2Enabled;
}
