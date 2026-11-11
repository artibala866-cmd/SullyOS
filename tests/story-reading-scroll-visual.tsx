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
const floorCount = Math.max(2, Math.min(240, Number(params.get('count')) || 26));
const richStoryFrames = params.get('rich') === '1';
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
const rows = Array.from({ length: floorCount }, (_, i) => ({
    id: i + 1, charId: 'story-theater:visual-story', role: i % 2 === 0 ? 'user' : 'assistant',
    type: 'text', content: richStoryFrames && i % 2 === 1
        ? '<div class="story-test-html"><h3>第 ' + (i + 1) + ' 楼 · 长篇排版</h3>'
            + Array.from({ length: 18 }, (_, part) => '<p>第 ' + (i + 1) + ' 楼，第 ' + (part + 1)
                + ' 段。雨声沿着窗框落下，人物继续说话，完整的剧情内容应该随外层页面连续滚动。</p>').join('')
            + '</div>'
        : storySamples[i % storySamples.length].replaceAll('\\n', '\n'),
    timestamp: 1700000000000 + i * 60000,
    metadata: { source: 'story_theater', ...(richStoryFrames && i % 2 === 1 ? { theaterSourceFormat: 'sillytavern' } : {}) },
} as Message));
const originalGetMessages = DB.getMessagesByCharId;
DB.getMessagesByCharId = async (charId: string, ..._args: any[]) =>
    charId === 'story-theater:visual-story' ? rows : originalGetMessages(charId, true);
const actor = { id: 'visual-actor', name: '林星', avatar: '', systemPrompt: '', worldview: '', memories: [], mountedWorldbooks: [] };
const entry = {
    ...createStoryTheaterDraft(1), id: 'visual-story', title: '雨天以后',
    // Keep the existing full-timeline stress tests intact; production defaults to 20.
    readingBatchSize: Math.min(100, Math.max(10, floorCount)),
    characterIds: [actor.id], carryCharacterMemory: false,
};
const mockOS = {
    characters: [actor], worldbooks: [], userProfile: { name: '玩家', avatar: '' },
    apiConfig: { baseUrl: '', apiKey: '', model: '' },
    memoryPalaceConfig: {}, remoteVectorConfig: {},
    theme: { storyAppearance: { preset: mode === 'dark' ? 'night' : (mode === 'plain' || mode === 'cinema') ? 'none' : 'novel' } },
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
// Exercise the actual portal controls: select 花里胡哨, close the portal, and
// audit only the real reading screen. This catches the original regression.
if (mode === 'cinema') {
    const selectCinemaAndClose = () => {
        const open = document.querySelector<HTMLButtonElement>('button[aria-label="剧情外观"]');
        if (!open) { setTimeout(selectCinemaAndClose, 80); return; }
        open.click();
        setTimeout(() => {
            const option = [...document.querySelectorAll<HTMLButtonElement>('button')]
                .find(button => button.textContent?.includes('花里胡哨'));
            if (!option) { document.body.dataset.storyScrollReady = 'false'; return; }
            option.click();
            document.querySelector<HTMLButtonElement>('button[aria-label="关闭剧情外观"]')?.click();
        }, 120);
    };
    setTimeout(selectCinemaAndClose, 250);
}
const begin = Date.now();
const audit = () => {
    const scroll = document.querySelector<HTMLElement>('.story-page-scroll');
    const floors = scroll?.querySelectorAll<HTMLElement>('[data-story-floor]');
    if (!scroll || floors?.length !== floorCount) {
        // For >100-floor audits, walk the same user-facing history button
        // before measuring the full long-story fixture.
        const loadOlder = scroll?.querySelector<HTMLButtonElement>('[data-story-load-more]');
        if (loadOlder && !loadOlder.disabled) loadOlder.click();
        if (Date.now() - begin < 10000) setTimeout(audit, 90);
        else document.body.dataset.storyScrollReady = 'false';
        return;
    }
    const focus = params.get('focus');
    let anchorDrift: number | null = null;
    const focusReading = () => {
        // The test moves through the timeline programmatically, but the real
        // reader touches first. Signal the same gesture before changing the
        // scroll position so lazy iframe reflows cannot re-enable follow-latest.
        if (focus === 'middle' || focus === 'top' || focus === 'latest') {
            scroll.dispatchEvent(new Event('touchstart', { bubbles: true }));
        }
        if (focus === 'middle') floors[Math.floor(floorCount / 2)].scrollIntoView({ block: 'start', behavior: 'instant' });
        if (focus === 'top') scroll.scrollTop = 0;
        if (focus === 'middle' || focus === 'top') scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
        if (focus === 'stability') {
            // A rapid touch swipe can precede the corresponding scroll event.
            // Reflowing several old floors at that moment must preserve the
            // actual reading position instead of snapping to the newest floor.
            const anchor = floors[Math.floor(floorCount * 0.6)];
            anchor.scrollIntoView({ block: 'start', behavior: 'instant' });
            scroll.dispatchEvent(new Event('touchstart', { bubbles: true }));
            const topBefore = anchor.getBoundingClientRect().top;
            const earlierFloor = floors[0];
            const initialHeight = earlierFloor.getBoundingClientRect().height;
            let reflows = 0;
            const reflow = () => {
                reflows += 1;
                earlierFloor.style.minHeight = `${initialHeight + reflows * 240}px`;
                if (reflows < 3) setTimeout(reflow, 70);
                else setTimeout(() => { anchorDrift = Math.abs(anchor.getBoundingClientRect().top - topBefore); }, 200);
            };
            reflow();
        }
        if (focus === 'latest') {
            // Exercise the real user interaction rather than mutating scrollTop
            // after a font reflow and accidentally cancelling follow-latest.
            scroll.scrollTop = 0;
            scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
            setTimeout(() => {
                const button = document.querySelector<HTMLButtonElement>('button[aria-label="回到最新楼层"]');
                if (button) button.click();
                else {
                    scroll.scrollTop = scroll.scrollHeight;
                    scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
                }
            }, 120);
        }
    };
    const settledFonts = document.fonts?.ready || Promise.resolve();
    void Promise.race([settledFonts, new Promise(resolve => setTimeout(resolve, 850))])
        .then(() => setTimeout(focusReading, 80));
    setTimeout(() => {
        const progress = document.querySelector<HTMLElement>('header.story-safe-header [aria-label^="当前第"]');
        const header = document.querySelector<HTMLElement>('header.story-safe-header');
        const progressInReadingArea = scroll.querySelector('[aria-label^="当前第"]');
        const floorIndicatorClear = !!progress && !!header
            && progress.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().top + 3
            && !progressInReadingArea
            && !scroll.querySelector('.sticky')
            && !document.querySelector('.story-quick-preset')
            && !!header.querySelector('button[aria-label="本剧情快速预设"]');
        const visibleCount = progress?.getAttribute('aria-label') || '';
        const nearEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 96;
        const latestButton = document.querySelector<HTMLButtonElement>('button[aria-label="回到最新楼层"]');
        const readerTheme = document.querySelector<HTMLElement>('#visual .story-theme.story-decor-cinema:not(.meeting-reading)');
        const floorDecoration = getComputedStyle(floors[0], '::before').content;
        const cinemaReady = !!readerTheme
            && !document.querySelector('[aria-labelledby="story-appearance-title"]')
            && getComputedStyle(scroll).backgroundImage.includes('radial-gradient')
            && floorDecoration.includes('✦');
        const valid = (mode !== 'cinema' || cinemaReady)
            && floors.length === floorCount
            && (!richStoryFrames || scroll.querySelectorAll('iframe').length >= Math.floor(floorCount / 2))
            && !document.querySelector('button[aria-label="更早一页"]')
            && floorIndicatorClear
            && (focus === 'latest' ? (nearEnd && visibleCount.includes(`第 ${floorCount} 楼`) && !latestButton)
                : (focus === 'middle' || focus === 'top') ? (!nearEnd && !!latestButton)
                : focus === 'stability' ? (!nearEnd && !!latestButton && anchorDrift !== null && anchorDrift <= 8)
                : true)
            && (document.querySelector('.story-reading-floor')?.getBoundingClientRect().width || 0) > 200
            && document.documentElement.scrollWidth <= innerWidth;
        document.body.dataset.storyScrollReady = String(valid);
        const output = document.createElement('output');output.hidden = true;
        output.id = 'story-scroll-report';
        output.textContent = JSON.stringify({
            valid, cinemaReady, floorDecoration, count: floors.length, displayedProgress: progress?.textContent,
            indicatorInHeader: floorIndicatorClear, hasLatestButton: !!latestButton,
            scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
            scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, scrollTop: scroll.scrollTop, nearEnd, anchorDrift,
        });
        document.body.append(output);
    }, 1800);
};
setTimeout(audit, 200);
