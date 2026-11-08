import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OSPreviewProvider } from '../context/OSContext';
import { StoryTheaterThemeProvider } from '../components/date/story/StoryTheaterTheme';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import { BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft } from '../utils/storyTheater';
import { getStoryGenerationSnapshot, isStoryGenerationRunning } from '../utils/storyTheaterBackground';
import { DB } from '../utils/db';
import type { Message } from '../types';

// Real StoryTheaterSession; fake backend and local message store only.
// The request intentionally remains unresolved across an actual unmount.
const id = 'background-fixture';
const thread = 'story-theater:' + id;
let latestId = 0;
let requests = 0;
let responseReady = false;
let resolveRequest: (() => void) | undefined;
const messages: Message[] = [];
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return originalFetch(url, options);
    requests++;
    await new Promise<void>(resolve => { resolveRequest = resolve; });
    responseReady = true;
    return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '<story_text>他听见我回来，终于把那句话完整说完了。</story_text>' } }],
        usage: { prompt_tokens: 1234, completion_tokens: 42 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
DB.getMessagesByCharId = async (charId: string) => charId === thread ? messages.slice() : [];
DB.saveStoryTheaterTurn = async (central: Omit<Message, 'id'>) => {
    const row = { ...central, id: ++latestId } as Message;
    messages.push(row);
    return row.id;
};
const actor = { id: 'background-actor', name: '林星', systemPrompt: '', worldview: '', memories: [], mountedWorldbooks: [] };
const entry = {
    ...createStoryTheaterDraft(1), id, title: '不打断的剧情',
    characterIds: [actor.id], carryCharacterMemory: false, archiveAfter: 40,
};
const os = {
    characters: [actor], worldbooks: [],
    userProfile: { name: '玩家', avatar: '' },
    apiConfig: { baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'test-story' },
    memoryPalaceConfig: {}, remoteVectorConfig: {},
    theme: { storyAppearance: { preset: 'none' } },
    updateCharacter: () => {}, addToast: () => {}, registerBackHandler: () => () => {},
} as any;

const Demo = () => {
    const [inside, setInside] = useState(true);
    useEffect(() => {
        let sawActiveOutside = false;
        let sawActiveAfterReturn = false;
        const fail = (detail: string) => {
            document.body.dataset.storyBackgroundReady = 'false';
            const report = document.getElementById('story-background-report');
            if (report) report.textContent = detail;
        };
        const later = (ms: number, callback: () => void) => setTimeout(callback, ms);
        const timers: ReturnType<typeof setTimeout>[] = [];
        timers.push(later(850, () => {
            const continueButton = document.querySelector<HTMLButtonElement>('button[aria-label="继续当前剧情"]');
            if (!continueButton) return fail('continue button missing');
            continueButton.click();
        }));
        timers.push(later(1700, () => {
            // Actual component removal, not just a CSS-hidden screen.
            setInside(false);
            sawActiveOutside = isStoryGenerationRunning(id);
        }));
        timers.push(later(2200, () => setInside(true)));
        timers.push(later(2850, () => {
            sawActiveAfterReturn = isStoryGenerationRunning(id)
                && !!document.querySelector('[role="status"]');
            resolveRequest?.();
        }));
        timers.push(later(4400, () => {
            const reply = messages.find(row => row.role === 'assistant');
            const completed = getStoryGenerationSnapshot(id)?.phase === 'completed';
            const freshText = document.body.textContent?.includes('他听见我回来，终于把那句话完整说完了。');
            const valid = sawActiveOutside && sawActiveAfterReturn
                && requests === 1 && responseReady && completed
                && !!reply && freshText && !isStoryGenerationRunning(id);
            document.body.dataset.storyBackgroundReady = String(valid);
            const report = document.getElementById('story-background-report');
            if (report) report.textContent = JSON.stringify({
                valid, sawActiveOutside, sawActiveAfterReturn,
                requests, responseReady, completed, persisted: !!reply, rendered: !!freshText,
            });
        }));
        return () => timers.forEach(clearTimeout);
    }, []);
    return inside
        ? <StoryTheaterSession entry={entry} preset={BUILTIN_NIGHT_SCREENING_PRESET}
            masks={[]} onBack={() => setInside(false)} onEdit={() => setInside(false)}
            onEntryChange={() => {}} onArchiveCommitted={() => {}} />
        : <div style={{ height: '100%', background: '#f5f5f5', padding: 30 }}>
            <h2>已离开剧情，正在浏览其他页面</h2>
            <button aria-label="重新进入剧情" onClick={() => setInside(true)}>返回剧情</button>
        </div>;
};
createRoot(document.getElementById('visual')!).render(
    <OSPreviewProvider value={os}><StoryTheaterThemeProvider><Demo /></StoryTheaterThemeProvider></OSPreviewProvider>,
);
