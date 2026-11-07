import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sessionSource = readFileSync(new URL('../components/date/story/StoryTheaterSession.tsx', import.meta.url), 'utf8');

describe('见面剧情连续楼层阅读', () => {
    it('不再按十条分页，保留每条消息原序与楼层定位', () => {
        expect(sessionSource).not.toContain('StoryPagination');
        expect(sessionSource).not.toContain('STORY_PAGE_SIZE');
        expect(sessionSource).not.toContain('pageMessages.map');
        expect(sessionSource).toContain('messages.map((message, floorIndex)');
        expect(sessionSource).toContain('data-story-floor={floorIndex + 1}');
        expect(sessionSource).toContain('第 {visibleFloor || 1} / {messages.length} 楼');
    });

    it('滚动时更新楼数，阅读旧楼层时不被生成或编辑动作拉回底部', () => {
        expect(sessionSource).toContain('onScroll={handleReadingScroll}');
        expect(sessionSource).toContain('const handleReadingScroll = useCallback(() => {\n        updateVisibleFloor();');
        expect(sessionSource).not.toContain('requestAnimationFrame');
        expect(sessionSource).toContain('const floorNodes = viewport.querySelectorAll');
        expect(sessionSource).toContain('updateVisibleFloor');
        expect(sessionSource).toContain('followLatestRef.current = nearBottom');
        expect(sessionSource).toContain('if (followLatestRef.current) bottomRef.current?.scrollIntoView');
        expect(sessionSource).toContain('回到最新');
    });

    it('保留楼层长按、归档展开、最近一轮重写与剧情正文组件', () => {
        expect(sessionSource).toContain('pressHandlersFor(message)');
        expect(sessionSource).toContain('toggleAllArchives');
        expect(sessionSource).toContain('onToggle={event => setArchiveExpanded');
        expect(sessionSource).toContain('<StoryOutput content={message.content}');
        expect(sessionSource).toContain('onClick={() => void send(message)}');
    });
});
