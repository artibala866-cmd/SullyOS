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
const EMPTY_ALCHEMY_RESULTS = new Map<number, StoryRegexResult>();

export function useAlchemyMessageResults(messages: Message[], rules: StoryRegexRule[], domain: AlchemyDomain) {
    const active = useMemo(() => alchemyRulesFor(rules, domain), [rules, domain]);
    const [cache, setCache] = useState<{
        messages: Message[]; active: StoryRegexRule[]; results: Map<number, StoryRegexResult>;
    } | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        const eligible = active.length ? messages.filter(message =>
            message.role === 'assistant' && message.type === 'text' && !!message.content) : [];
        if (!eligible.length) { setCache({ messages, active, results: EMPTY_ALCHEMY_RESULTS }); return; }
        void runStoryRegex(eligible.map(message => ({
            text: message.content, role: 'assistant' as const,
        })), active, 'display', controller.signal).then(converted => {
            if (!controller.signal.aborted) setCache({ messages, active,
                results: new Map(eligible.map((message, index) => [message.id, converted[index]])) });
        }).catch(error => {
            // Malformed imported regex must not crash the chat or erase text.
            if (!controller.signal.aborted) console.warn('[Alchemy] display rules skipped', error);
        });
        return () => controller.abort();
    }, [messages, active]);
    // Never show a stale transformed bubble while switching characters,
    // editing messages or changing rule folders. The original text renders
    // until the current worker run completes.
    return cache?.messages === messages && cache.active === active
        ? cache.results : EMPTY_ALCHEMY_RESULTS;
}
