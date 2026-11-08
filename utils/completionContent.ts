export function completionContentToText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(completionContentToText).join('');
    if (!value || typeof value !== 'object') return '';
    const part = value as Record<string, unknown>;
    if (part.thought === true || ['thinking', 'reasoning', 'redacted_thinking', 'refusal'].includes(String(part.type))) return '';
    return completionContentToText(part.text ?? part.content ?? part.value);
}
