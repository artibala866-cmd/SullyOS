import { describe, expect, it } from 'vitest';
import { isEmotionBuffEnabled } from './emotionFeature';
describe('emotion Buff independent opt-in', () => {
    it('does not reactivate legacy scheduled Buffs', () => {
        expect(isEmotionBuffEnabled(undefined)).toBe(false);
        expect(isEmotionBuffEnabled({})).toBe(false);
        expect(isEmotionBuffEnabled({emotionConfig:{enabled:true}, scheduleFeatureEnabled:true} as any)).toBe(false);
    });
    it('works without schedule and can be disabled while schedule stays on', () => {
        expect(isEmotionBuffEnabled({ emotionBuffEnabled:true, scheduleFeatureEnabled:false } as any)).toBe(true);
        expect(isEmotionBuffEnabled({ emotionBuffEnabled:false, scheduleFeatureEnabled:true } as any)).toBe(false);
    });
});
