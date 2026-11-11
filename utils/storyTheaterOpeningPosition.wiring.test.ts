import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../components/date/story/StoryTheaterSession.tsx', import.meta.url), 'utf8');

describe('剧情首次进入与正则排版稳定性', () => {
    it('等待整段历史正则完成后才执行首次底部定位', () => {
        expect(source).toContain('const initialReadingReady = useMemo(() => {');
        expect(source).toContain('regexDisplay?.rules !== activeRegexRules');
        expect(source).toContain('regexDisplay.results.get(key)');
        expect(source).toContain('!messages.length || !initialReadingPendingRef.current || !initialReadingReady');
        expect(source).toContain('if (!initialReadingGestureRef.current) scrollReadingToLatest();');
    });

    it('初次加载期间用户主动滑动时不抢回最新楼层', () => {
        expect(source).toContain('initialReadingPendingRef.current = true;');
        expect(source).toContain('initialReadingGestureRef.current = false;');
        expect(source).toContain('initialReadingGestureRef.current = true;');
        expect(source).toContain('onWheel={pauseFollowingForReading}');
        expect(source).toContain('onTouchStart={pauseFollowingForReading}');
    });

    it('正则先完成整批结果，再一次提交以避免历史楼层逐批闪动', () => {
        expect(source).toContain('if (offset + 24 >= pending.length) commit();');
        expect(source).toContain('if (!pending.length && reuse && previous?.results.size !== results.size) commit();');
        expect(source).toContain("return { text: '', cards: [], matches: 0 };");
    });
});
