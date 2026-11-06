import { describe, it, expect } from 'vitest';
import { DATE_SCENES, configuredDateScenes, extractDateSceneTag, stripDateSceneTagsForDisplay } from './dateScenes';

describe('date scene switch protocol', () => {
    it('has five stable initial scene slots; only configured slots are eligible', () => {
        expect(DATE_SCENES.map(s => s.key)).toEqual(['outdoor', 'bedroom', 'bathroom', 'kitchen', 'work']);
        expect(configuredDateScenes({ bedroom: 'blobref:a', kitchen: 'https://example.com/k.png' }).map(s => s.key)).toEqual(['bedroom', 'kitchen']);
        expect(configuredDateScenes()).toEqual([]);
    });
    it('hides control tags only in opening preview, keeping dialogue and blank lines readable', () => {
        expect(stripDateSceneTagsForDisplay('[scene:bedroom]\\n他正在看书。\\n\\n[scene:work] 转身走向书桌'))
            .toBe('他正在看书。\\n\\n转身走向书桌');
        expect(stripDateSceneTagsForDisplay('[scene:unknown]\\n你好')).toBe('你好');
        expect(stripDateSceneTagsForDisplay('普通台词')).toBe('普通台词');
    });
    it('recognizes standalone and inline scene tags, independent from portrait and voice', () => {
        expect(extractDateSceneTag('[scene:bedroom]')).toEqual({ scene: 'bedroom', rest: '' });
        expect(extractDateSceneTag('[scene:OUTDOOR][normal] 开门')).toEqual({ scene: 'outdoor', rest: '[normal] 开门' });
        expect(extractDateSceneTag('[happy][scene:kitchen] "开饭啦"')).toEqual({ scene: 'kitchen', rest: '[happy] "开饭啦"' });
        expect(extractDateSceneTag('[v:calm] [happy] "嗨"')).toEqual({ scene: undefined, rest: '[v:calm] [happy] "嗨"' });
        expect(extractDateSceneTag('[scene:unknown] 不更换')).toEqual({ scene: undefined, rest: '不更换' });
        expect(extractDateSceneTag('[scene:office]')).toEqual({ scene: undefined, rest: '' });
        expect(extractDateSceneTag('[scene:bad_name] [happy] 晚安')).toEqual({ scene: undefined, rest: '[happy] 晚安' });
    });
});
