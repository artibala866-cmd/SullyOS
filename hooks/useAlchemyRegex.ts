import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Message } from '../types';
import { DB } from '../utils/db';
import { ALCHEMY_CHANGED, alchemyRulesFor, updateAlchemyRules, type AlchemyDomain } from '../utils/alchemyRegex';
import { readStoryRegexRules, STORY_REGEX_ASSET, type StoryRegexResult, type StoryRegexRule } from '../utils/storyRegex';
import { runStoryRegex } from '../utils/storyRegexRunner';

export function useAlchemyRules(domain: AlchemyDomain) {
    const [all, setAll] = useState<StoryRegexRule[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const reload = useCallback(async () => {
        try {
            setAll(readStoryRegexRules(await DB.getAsset(STORY_REGEX_ASSET)));
            setError('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '正则读取失败');
        } finally {
            setLoaded(true);
        }
    }, []);
    useEffect(() => {
        void reload();
        window.addEventListener(ALCHEMY_CHANGED, reload);
        return () => window.removeEventListener(ALCHEMY_CHANGED, reload);
    }, [reload]);
    const save = useCallback(async (update: (current: StoryRegexRule[]) => StoryRegexRule[]) => {
        const result = await updateAlchemyRules(update);
        setAll(result);
    }, []);
    const visible = useMemo(() => all.filter(rule =>
        (rule.domain || (rule.kind === 'template' ? 'online' : 'offline')) === domain), [all, domain]);
    return { all, rules: visible, active: alchemyRulesFor(visible, domain), loaded, error, save, reload };
}

/** Display-only transformation. The original message, DB record, history,
 * quote snapshots and outgoing model context stay byte-for-byte intact. */
export function useAlchemyMessageResults(messages: Message[], rules: StoryRegexRule[], domain: AlchemyDomain) {
    const [results, setResults] = useState<Map<number, StoryRegexResult>>(() => new Map());
    const active = useMemo(() => alchemyRulesFor(rules, domain), [rules, domain]);
    useEffect(() => {
        const controller = new AbortController();
        const eligible = active.length ? messages.filter(message =>
            message.role === 'assistant' && message.type === 'text' && !!message.content) : [];
        if (!eligible.length) { setResults(new Map()); return; }
        void runStoryRegex(eligible.map(message => ({
            text: message.content, role: 'assistant' as const,
        })), active, 'display', controller.signal).then(converted => {
            if (!controller.signal.aborted) setResults(new Map(eligible.map((message, index) => [message.id, converted[index]])));
        }).catch(error => {
            // Malformed imported regex must not crash the chat or erase text.
            if (!controller.signal.aborted) console.warn('[Alchemy] display rules skipped', error);
        });
        return () => controller.abort();
    }, [messages, active]);
    return results;
}
