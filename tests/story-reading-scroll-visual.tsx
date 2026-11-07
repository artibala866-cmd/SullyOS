import React from 'react';
import { createRoot } from 'react-dom/client';
import { OSPreviewProvider } from '../context/OSContext';
import { StoryTheaterThemeProvider } from '../components/date/story/StoryTheaterTheme';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import { createStoryTheaterDraft, BUILTIN_NIGHT_SCREENING_PRESET } from '../utils/storyTheater';
import { DB } from '../utils/db';
import type { Message } from '../types';

// Isolated real-component visual fixture: fake local story data, no API calls.
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'novel';
const storySamples = [
    '他走到门口，像是还在犹豫要不要开口。',
    '雨声从屋檐滑下来，沿着窗框积起细小的水痕。\\n\\n林星没有立刻追问。他把伞放在玄关，手指在木柄上停了一瞬。',
    '我抬头问他：「你刚才想说什么？」',
    '他先是笑了一下，却没什么笑意。\\n\\n「没什么重要的。」说完又觉得太敷衍，于是重新把视线落回来。',
    '我没有催他，只安静地等。',
    '门廊灯亮得很暖。雨声盖过了楼下脚步声，屋里安静得只听得见钟表走动。\\n\\n「其实我今天绕了远路。」他说。',
    '「为什么？」我把杯子往他面前推了推。',
    '林星望向那杯水，指尖轻轻碰了碰杯沿。\\n\\n「想了很多事，最后还是觉得应该亲自告诉你。」',
];
const rows = Array.from({ length: 26 }, (_, i) => ({
    id: i + 1, charId: 'story-theater:visual-story', role: i % 2 === 0 ? 'user' : 'assistant',
    type: 'text', content: storySamples[i % storySamples.length].replaceAll('\\n', '\n'),
    timestamp: 1700000000000 + i * 60000,
    metadata: { source: 'story_theater' },
} as Message));
const originalGetMessages = DB.getMessagesByCharId;
DB.getMessagesByCharId = async (charId: string, ..._args: any[]) =>
    charId === 'story-theater:visual-story' ? rows : originalGetMessages(charId, true);
const actor = { id: 'visual-actor', name: '林星', avatar: '', systemPrompt: '', worldview: '', memories: [], mountedWorldbooks: [] };
const entry = {
    ...createStoryTheaterDraft(1), id: 'visual-story', title: '雨天以后',
    characterIds: [actor.id], carryCharacterMemory: false,
};
const mockOS = {
    characters: [actor], worldbooks: [], userProfile: { name: '玩家', avatar: '' },
    apiConfig: { baseUrl: '', apiKey: '', model: '' },
    memoryPalaceConfig: {}, remoteVectorConfig: {},
    theme: { storyAppearance: { preset: mode === 'dark' ? 'night' : mode === 'plain' ? 'none' : 'novel' } },
    updateCharacter: () => {}, addToast: () => {}, registerBackHandler: () => () => {},
} as any;
createRoot(document.getElementById('visual')!).render(
    <OSPreviewProvider value={mockOS}>
        <StoryTheaterThemeProvider>
            <StoryTheaterSession entry={entry} preset={BUILTIN_NIGHT_SCREENING_PRESET}
                masks={[]} onBack={() => {}} onEdit={() => {}}
                onEntryChange={() => {}} onArchiveCommitted={() => {}} />
        </StoryTheaterThemeProvider>
    </OSPreviewProvider>,
);
const begin = Date.now();
const audit = () => {
    const scroll = document.querySelector<HTMLElement>('.story-page-scroll');
    const floors = scroll?.querySelectorAll<HTMLElement>('[data-story-floor]');
    if (!scroll || floors?.length !== 26) {
        if (Date.now() - begin < 10000) setTimeout(audit, 90);
        else document.body.dataset.storyScrollReady = 'false';
        return;
    }
    const focus = params.get('focus');
    if (focus === 'middle') floors[12].scrollIntoView({ block: 'start', behavior: 'instant' });
    if (focus === 'top') scroll.scrollTop = 0;
    if (focus === 'latest') scroll.scrollTop = scroll.scrollHeight;
    setTimeout(() => {
        const progress = document.querySelector<HTMLElement>('header.story-safe-header [aria-label^="当前第"]');
        const header = document.querySelector<HTMLElement>('header.story-safe-header');
        const progressInReadingArea = scroll.querySelector('[aria-label^="当前第"]');
        const floorIndicatorClear = !!progress && !!header
            && progress.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().top + 3
            && !progressInReadingArea
            && !scroll.querySelector('.sticky');
        const visibleCount = progress?.getAttribute('aria-label') || '';
        const nearEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 96;
        const latestButton = document.querySelector<HTMLButtonElement>('button[aria-label="回到最新楼层"]');
        const valid = floors.length === 26
            && !document.querySelector('button[aria-label="更早一页"]')
            && floorIndicatorClear
            && (focus === 'latest' ? (nearEnd && visibleCount.includes('第 26 楼') && !latestButton)
                : (focus === 'middle' || focus === 'top') ? (!nearEnd && !!latestButton)
                : true)
            && (document.querySelector('.story-reading-floor')?.getBoundingClientRect().width || 0) > 200
            && document.documentElement.scrollWidth <= innerWidth;
        document.body.dataset.storyScrollReady = String(valid);
        const output = document.createElement('output');output.hidden = true;
        output.id = 'story-scroll-report';
        output.textContent = JSON.stringify({
            valid, count: floors.length, displayedProgress: progress?.textContent,
            indicatorInHeader: floorIndicatorClear, hasLatestButton: !!latestButton,
            scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
            scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
        });
        document.body.append(output);
    }, 350);
};
setTimeout(audit, 200);
