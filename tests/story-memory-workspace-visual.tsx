import React from 'react';
import { createRoot } from 'react-dom/client';
import { OSPreviewProvider } from '../context/OSContext';
import { StoryTheaterThemeProvider } from '../components/date/story/StoryTheaterTheme';
import StoryVectorMemoryPanel from '../components/date/story/StoryVectorMemoryPanel';
import StoryArchivePanel from '../components/date/story/StoryArchivePanel';
import { createStoryTheaterDraft, storyTheaterThreadId } from '../utils/storyTheater';
import { STORY_THEATER_APPEARANCE_STORAGE_KEY } from '../utils/storyTheaterBackup';
import { MemoryNodeDB } from '../utils/memoryPalace/db';
import type { StoryArchiveFact, StoryTheaterArchive } from '../types';

// Genuine components, CSS, IndexedDB and handlers; synthetic story records only.
const params = new URLSearchParams(location.search);
const dark = params.get('theme') === 'dark';
const mode = params.get('view') === 'boxes' ? 'boxes' : 'vectors';
localStorage.setItem(STORY_THEATER_APPEARANCE_STORAGE_KEY, JSON.stringify({ color: dark ? 'dark' : 'light', decor: 'plain' }));
const id = 'story-memory-visual-' + mode;
const thread = storyTheaterThreadId(id);
const nodeIds = Array.from({ length: 27 }, (_, i) => id + '-node-' + i);
const sentences = [
  '冬夜里，林屿从抽屉里取出那封一直未寄出的信。',
  '车站已经熄了灯，两人约定第二天再把事情说清楚。',
  '窗外落雨，之前误解的事情终于有了新的解释。',
  '她记得他在桥边答应过，不会擅自改变约好的计划。',
];
const facts: StoryArchiveFact[] = nodeIds.map((node, i) => ({
  key: 'visual-fact-' + i, kind: 'fact', text: sentences[i % sentences.length],
  terms: ['信件', '车站', '冬夜'], sourceMessageId: i + 1,
  storyTime: '2026-11-' + String(12 + (i % 4)).padStart(2, '0') + ' 晚间',
  vectorNodeId: node, vectorTextState: 'synced',
}));
const vectorBoxes: StoryTheaterArchive[] = [
  { id: 'v1', strategy: 'vector', fromMessageId: 1, toMessageId: 14, messageCount: 14,
    vectorMemoryIds: nodeIds.slice(0, 14), facts: facts.slice(0, 14), createdAt: 1 },
  { id: 'v2', strategy: 'vector', fromMessageId: 15, toMessageId: 27, messageCount: 13,
    vectorMemoryIds: nodeIds.slice(14), facts: facts.slice(14), createdAt: 2 },
];
const summaryBoxes: StoryTheaterArchive[] = [
  { id: 'b1', strategy: 'summary', fromMessageId: 1, toMessageId: 7, messageCount: 7, createdAt: 1,
    summary: '雨夜的车站，林屿留下了一封信。\n两人重新约定下一次见面的时间。' },
  { id: 'b2', strategy: 'summary', fromMessageId: 8, toMessageId: 15, messageCount: 8, createdAt: 2,
    summary: '桥边的误会终于澄清。\n双方决定不要急着作出结论。' },
  { id: 'b3', strategy: 'summary', fromMessageId: 16, toMessageId: 27, messageCount: 12, createdAt: 3,
    summary: '冬夜的最后一封信，记录了新的约定。\n过去的事情在这一晚得到了回应。' },
];
const entry = {
  ...createStoryTheaterDraft(1), id, title: '冬夜的来信', characterIds: ['visual-actor'],
  archiveStrategy: mode === 'vectors' ? 'vector' as const : 'summary' as const,
  archives: mode === 'vectors' ? vectorBoxes : summaryBoxes, updatedAt: 2,
};
const os = {
  characters: [{ id: 'visual-actor', name: '林屿', description: '安静', systemPrompt: '', worldview: '' }],
  userProfile: { name: '玩家', avatar: '' }, worldbooks: [],
  apiConfig: {}, memoryPalaceConfig: {}, remoteVectorConfig: {},
  theme: { storyAppearance: { preset: 'none' } }, addToast: () => {},
  registerBackHandler: () => () => {},
} as any;

const report = (value: Record<string, unknown>) => {
  document.body.dataset.storyMemoryVisualReady = String(!!value.success);
  document.getElementById('story-memory-visual-report')!.textContent = JSON.stringify(value);
};
async function start() {
  if (mode === 'vectors') {
    for (let i = 0; i < nodeIds.length; i++) {
      await MemoryNodeDB.save({
        id: nodeIds[i], charId: thread, content: sentences[i % sentences.length] + '（第' + (i + 1) + '条）',
        room: 'living_room', tags: [], importance: 6, mood: 'calm', embedded: false,
        createdAt: i + 1, lastAccessedAt: i + 1, accessCount: 0,
      });
    }
  }
  createRoot(document.getElementById('visual')!).render(
    <OSPreviewProvider value={os}>
      <StoryTheaterThemeProvider>
        {mode === 'vectors'
          ? <StoryVectorMemoryPanel entry={entry} masks={[]} onBack={() => {}} onUpdated={() => {}}/>
          : <StoryArchivePanel entry={entry} masks={[]} onBack={() => {}} onUpdated={() => {}}/>}
      </StoryTheaterThemeProvider>
    </OSPreviewProvider>,
  );
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const header = document.querySelector<HTMLElement>('.story-memory-header');
    const scroller = document.querySelector<HTMLElement>('.story-memory-scroll');
    const search = header?.querySelector<HTMLInputElement>('input[type=search]');
    const cards = document.querySelectorAll(mode === 'vectors' ? '.story-memory-node' : '.story-memory-archive-item');
    if (!header || !scroller || !search || cards.length < (mode === 'vectors' ? 10 : 3)) continue;
    // Scroll the real content; the search must remain fixed above the viewport's scrolling region.
    const originalY = search.getBoundingClientRect().y;
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const afterY = search.getBoundingClientRect().y;
    const pager = document.querySelector<HTMLElement>('.story-memory-bottom-page');
    const buttons = pager?.querySelectorAll('button') ?? [];
    const bottomIcons = mode !== 'vectors' || (buttons.length === 2 &&
      Array.from(buttons).every(button => !!button.querySelector('svg') && !button.textContent?.trim()));
    const headBottom = header.getBoundingClientRect().bottom;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const horizontalFit = document.documentElement.scrollWidth <= innerWidth && scroller.scrollWidth <= scroller.clientWidth + 1;
    const transparent = (value: string) => value === 'rgba(0, 0, 0, 0)' || value === 'transparent';
    const cardStyle = getComputedStyle(cards[0]);
    const noWhiteCards = transparent(cardStyle.backgroundColor) && cardStyle.boxShadow === 'none'
      && parseFloat(cardStyle.borderTopWidth) === 0 && parseFloat(cardStyle.borderLeftWidth) === 0;
    const searchStyle = getComputedStyle(search);
    const flatSearch = transparent(searchStyle.backgroundColor) && parseFloat(searchStyle.borderTopWidth) === 0
      && parseFloat(searchStyle.borderBottomWidth) >= 1;
    const headerButton = header.querySelector<HTMLButtonElement>('button[aria-label="手动归档楼层"]');
    const headerIcon = !!headerButton?.querySelector('svg') && !headerButton?.textContent?.trim();
    const archiveActions = Array.from(document.querySelectorAll<HTMLButtonElement>('.story-memory-archive-actions button'));
    const archiveIcons = mode !== 'boxes' || (archiveActions.length >= 6 &&
      archiveActions.every(button => !!button.querySelector('svg') && !button.textContent?.trim()));
    const success = bottomIcons && noWhiteCards && flatSearch && headerIcon && archiveIcons &&
      Math.abs(afterY - originalY) <= 1 && headBottom <= scrollerTop + 2 && horizontalFit;
    scroller.scrollTop = 0;
    report({ success, mode, theme: dark ? 'dark' : 'light',
      viewport: { width: innerWidth, height: innerHeight }, cards: cards.length,
      bottomIcons, noWhiteCards, flatSearch, headerIcon, archiveIcons,
      searchStationary: Math.abs(afterY - originalY) <= 1,
      headerAboveScroll: headBottom <= scrollerTop + 2, horizontalFit });
    return;
  }
  report({ success: false, reason: 'memory cards, header or search failed to load', mode });
}
start().catch(error => report({ success: false, reason: String(error) }));
