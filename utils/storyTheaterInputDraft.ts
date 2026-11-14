// The story composer is remounted when entering memory pages or the story list.
// Persist exactly what the player typed, independently for each story.
const keyForStoryDraft = (storyId: string): string => `sully_story_input_draft_${storyId}`;

export function readStoryInputDraft(storyId: string): string {
    try { return localStorage.getItem(keyForStoryDraft(storyId)) ?? ''; }
    catch { return ''; }
}

export function saveStoryInputDraft(storyId: string, text: string): void {
    try {
        const key = keyForStoryDraft(storyId);
        if (text) localStorage.setItem(key, text);
        else localStorage.removeItem(key);
    } catch {
        // Private-mode storage failures must not break editing.
    }
}

// An asynchronous reply may finish after the user has left the story.
// Only remove the exact draft used by that request; never erase newer text.
export function clearStoryInputDraft(storyId: string, expectedText?: string): void {
    try {
        const key = keyForStoryDraft(storyId);
        if (expectedText !== undefined && localStorage.getItem(key) !== expectedText) return;
        localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
}
