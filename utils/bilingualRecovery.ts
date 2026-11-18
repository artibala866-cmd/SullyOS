/**
 * Bilingual output compatibility for models that ignore the XML contract.
 * Never invent or alter the model's original dialogue: only normalize explicit
 * pairs or attach separately returned translations to existing text bubbles.
 */
export interface BilingualMode {
    enabled: boolean;
    sourceLang: string;
    targetLang: string;
}

const quoteRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeLabeledBilingualOutput(raw: string, mode: BilingualMode): string {
    if (!mode.enabled || !raw.trim()) return raw;
    const originalKeys = ['原文', 'Original', 'Original text', 'Source', 'Source text', '원문', mode.sourceLang]
        .filter(Boolean).map(quoteRegExp).join('|');
    const translationKeys = ['译文', '譯文', '翻译', '翻譯', 'Translation', 'Translated', 'Translated text', '번역', mode.targetLang]
        .filter(Boolean).map(quoteRegExp).join('|');

    // Some newer models choose simple JSON instead of the requested XML.
    const plain = raw.trim().replace(/^\x60\x60\x60(?:json)?\s*\n?/i, '').replace(/\n?\x60\x60\x60$/, '').trim();
    if (plain.startsWith('{') && plain.endsWith('}')) {
        try {
            const value = JSON.parse(plain) as Record<string, unknown>;
            const source = value.original ?? value.originalText ?? value.source ?? value['原文'];
            const target = value.translation ?? value.translated ?? value.translatedText ?? value['译文'];
            if (typeof source === 'string' && source.trim() && typeof target === 'string' && target.trim()) {
                return `<翻译><原文>${source.trim()}</原文><译文>${target.trim()}</译文></翻译>`;
            }
        } catch { /* A normal conversational message can look JSON-like. */ }
    }
    // A number of OpenAI-compatible models return English XML tag names even
    // though the prompt asked for Chinese names. Convert only complete pairs.
    const englishPair = /<(?:bilingual|translation)>\s*<(original|source)>([\s\S]*?)<\/\1>\s*<(translated|target|translation)>([\s\S]*?)<\/\3>\s*<\/(?:bilingual|translation)>|<(original|source)>([\s\S]*?)<\/\5>\s*<(translated|target|translation)>([\s\S]*?)<\/\7>/gi;
    const fromEnglishXml = raw.replace(englishPair, (_match, _a, first, _b, second, _c, third, _d, fourth) => {
        const source = (first ?? third ?? '').trim();
        const target = (second ?? fourth ?? '').trim();
        return source && target
            ? `<翻译><原文>${source}</原文><译文>${target}</译文></翻译>`
            : _match;
    });
    if (fromEnglishXml !== raw) return fromEnglishXml;

    // Do not overwrite already formatted messages or accidentally normalize
    // quotations of XML tags inside a normal chat message.
    if (/<\/?(?:翻译|原文|译文|翻譯|譯文)\s*>/.test(raw)) return raw;

    // Exactly adjacent labeled source/target lines, not arbitrary prose.
    const tag = '(?:\\*\\*)?';
    const pattern = new RegExp(
        `(^|\\n)\\s*${tag}(?:${originalKeys})${tag}\\s*[:：]\\s*([^\\n]+)\\n\\s*${tag}(?:${translationKeys})${tag}\\s*[:：]\\s*([^\\n]+)`,
        'gim',
    );
    return raw.replace(pattern, (_all, prefix: string, source: string, target: string) => {
        if (!source.trim() || !target.trim()) return _all;
        return `${prefix}<翻译><原文>${source.trim()}</原文><译文>${target.trim()}</译文></翻译>`;
    });
}

/** Only plain speech is eligible; internal commands, quotes and voice cards are not translation material. */
export function eligibleTranslationSource(text: string): string {
    if (!text || /%%BILINGUAL%%|<\/?(?:翻译|原文|译文|语音|語音|字幕)(?:\s|>|$)|\[html\]/i.test(text)) return '';
    const candidate = text
        .replace(/\[\[(?:QU[OA]TE|引用)[:：][\s\S]*?\]\]/gi, '')
        .replace(/\[(?:QU[OA]TE|引用)[:：][^\]]*\]/gi, '')
        .replace(/\[回复\s*[\"“][^\"”]*[\"”](?:\.{0,3})\]\s*[:：]?/g, '')
        .trim();
    if (!candidate || /^\[\[[\s\S]*?\]\]$/.test(candidate)) return '';
    return candidate;
}

/** Model output must align with the exact number of input bubbles; never guess which translation belongs where. */
export function parseFallbackTranslations(raw: string, count: number): string[] | null {
    if (!raw?.trim() || count < 1) return null;
    let text = raw.trim().replace(/^\x60\x60\x60(?:json|text)?\s*\n?/i, '').replace(/\n?\x60\x60\x60$/, '').trim();
    try {
        const parsed: unknown = JSON.parse(text);
        const obj = parsed && !Array.isArray(parsed) && typeof parsed === 'object'
            ? parsed as Record<string, unknown> : null;
        const values = Array.isArray(parsed) ? parsed
            : Array.isArray(obj?.translations) ? obj.translations
            : Array.isArray(obj?.译文) ? obj.译文
            : count === 1 && typeof (obj?.translation ?? obj?.译文) === 'string'
                ? [obj?.translation ?? obj?.译文] : null;
        if (values && values.length === count && values.every(value => typeof value === 'string' && value.trim())) {
            return values.map(value => (value as string).trim());
        }
    } catch { /* Non-JSON models can still supply numbered or single-line translations. */ }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (count > 1 && lines.length === count && lines.every((line, idx) =>
        new RegExp(`^(?:${idx + 1}[.)、：:]|\\[${idx + 1}\\])\\s*\\S`).test(line))) {
        return lines.map(line => line.replace(/^\d+[.)、：:]\s*|^\[\d+\]\s*/, '').trim());
    }
    if (count === 1) {
        text = text.replace(/^(?:译文|譯文|翻译|翻譯|Translation|Translated)\s*[:：]\s*/i, '')
            .replace(/^1[.)、：:]\s*/, '').trim();
        // Do not present model refusals or JSON debris as a user's translation.
        if (!text || /^\{[\s\S]*\}$/.test(text) || /^\[[\s\S]*\]$/.test(text)
            || /^(?:I cannot|I can't|As an AI|无法翻译|不能翻译)/i.test(text)) return null;
        return [text];
    }
    return null;
}
