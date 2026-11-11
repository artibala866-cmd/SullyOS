import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sessionSource = readFileSync(new URL('../components/date/story/StoryTheaterSession.tsx', import.meta.url), 'utf8');
const themeSource = readFileSync(new URL('../components/date/story/StoryTheaterTheme.tsx', import.meta.url), 'utf8');
const visualSource = readFileSync(new URL('../tests/story-reading-scroll-visual.tsx', import.meta.url), 'utf8');

describe('见面剧情连续楼层阅读', () => {
    it('不再按十条分页，保留每条消息原序与楼层定位', () => {
        expect(sessionSource).not.toContain('StoryPagination');
        expect(sessionSource).not.toContain('STORY_PAGE_SIZE');
        expect(sessionSource).not.toContain('pageMessages.map');
        expect(sessionSource).toContain('messages.map((message, floorIndex)');
        expect(sessionSource).toContain('data-story-floor={floorIndex + 1}');
        expect(sessionSource).toContain('第 {visibleFloor || 1}/{messages.length} 楼');
    });

    it('滚动时更新楼数，阅读旧楼层时不被生成或编辑动作拉回底部', () => {
        expect(sessionSource).toContain('onScroll={handleReadingScroll}');
        expect(sessionSource).toContain('const handleReadingScroll = useCallback(() => {');
        expect(sessionSource).toContain('scheduleVisibleFloor();');
        expect(sessionSource).toContain('requestAnimationFrame(() => {');
        expect(sessionSource).toContain('cancelAnimationFrame(readingScrollFrameRef.current)');
        expect(sessionSource).toContain('const floorNodes = viewport.querySelectorAll');
        expect(sessionSource).toContain('new ResizeObserver(syncLayout)');
        expect(sessionSource).toContain('document.fonts.ready.then');
        expect(sessionSource).toContain('const syncLayout = () => scheduleVisibleFloor();');
        expect(sessionSource).toContain("event.data?.type === 'sully-story-template-scroll'");
        expect(sessionSource).toContain("scrollport.scrollTop +=");
        expect(sessionSource).toContain("maxHeight: 'none'");
        expect(sessionSource).toContain("overflowAnchor: 'auto'");
        expect(sessionSource).toContain("(reading && block.regexTemplate)");
        expect(sessionSource).not.toContain('if (viewport) viewport.scrollTop = viewport.scrollHeight');
        expect(sessionSource).toContain('onWheel={pauseFollowingForReading}');
        expect(sessionSource).toContain('onTouchStart={pauseFollowingForReading}');
        expect(sessionSource).toContain('const previousId = lastReadMessageIdRef.current;');
        expect(sessionSource).toContain('latestId > previousId');
        expect(sessionSource).toContain("viewport.scrollTo({ top: viewport.scrollHeight, behavior });");
        expect(sessionSource).not.toContain('scrollIntoView');
        expect(sessionSource).toContain("aria-label='回到最新楼层'");
        // A tall final floor is not necessarily the bottom: keep the explicit
        // jump control visible until the scrollbar itself reaches the end.
        expect(sessionSource).toContain('const [atReadingEnd, setAtReadingEnd] = useState(true)');
        expect(sessionSource).toContain('setAtReadingEnd(current => current === nearBottom ? current : nearBottom)');
        expect(sessionSource).toContain('messages.length > 0 && !atReadingEnd');
        expect(sessionSource).not.toContain('visibleFloor < messages.length && <button');
        expect(sessionSource).toContain("followLatestRef.current = false;");
        expect(sessionSource).toContain("followLatestRef.current = true;");
    });

    it('楼层提示只显示于顶部信息栏，阅读正文里没有悬浮遮挡', () => {
        expect(sessionSource).not.toContain('sticky top-2');
        expect(sessionSource).not.toContain('story-quick-preset pointer-events-none absolute');
        expect(sessionSource).toContain("aria-label='本剧情快速预设'");
        expect(sessionSource).not.toContain('pointer-events-none absolute inset-x-0 z-10');
        expect(sessionSource).toContain("className='shrink-0 text-right leading-tight'");
        expect(sessionSource).toContain("aria-label={`当前第 ${visibleFloor || 1} 楼，共 ${messages.length} 楼`}");
        expect(sessionSource.indexOf('第 {visibleFloor || 1}/{messages.length} 楼'))
            .toBeLessThan(sessionSource.indexOf('<main ref={readingScrollRef}'));
        expect(sessionSource).toContain("className='meeting-reading-page story-page-scroll min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-7'");
        expect(visualSource).toContain("focus === 'stability'");
        expect(visualSource).toContain('anchorDrift');
    });

    it('保留楼层长按、归档展开、最近一轮重写与剧情正文组件', () => {
        expect(sessionSource).toContain('pressHandlersFor(message)');
        expect(sessionSource).toContain('toggleAllArchives');
        expect(sessionSource).toContain('onToggle={event => setArchiveExpanded');
        expect(sessionSource).toContain('<StoryOutput content={message.content}');
        expect(sessionSource).toContain('onClick={() => void send(message)}');
    });
    it('花里胡哨在关闭外观面板后仍作用于真实阅读楼层，素雅及自定义阅读不受影响', () => {
        expect(themeSource).toContain('setDecor: decor => setAppearance(current => ({ ...current, decor }))');
        expect(themeSource).toContain('localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance))');
        expect(themeSource).toContain('story-decor-${appearance.decor}');
        expect(themeSource).toContain('.story-theme.story-decor-cinema:not(.meeting-reading) .meeting-reading-page');
        expect(themeSource).toContain('.story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor');
        expect(themeSource).toContain(".story-reading-floor::before {");
        expect(themeSource).not.toContain('.story-theme.story-decor-plain .story-reading-floor {');
        expect(visualSource).toContain("if (mode === 'cinema')");
        expect(visualSource).toContain("button[aria-label=\"剧情外观\"]");
        expect(visualSource).toContain("button[aria-label=\"关闭剧情外观\"]");
        expect(visualSource).toContain('cinemaReady');
    });

});
