import { describe, expect, it } from 'vitest';
import { isEmotionBuffEnabled } from './emotionFeature';
describe('emotion Buff independence', () => {
    it('defaults off', () => {
        expect(isEmotionBuffEnabled(undefined)).toBe(false);
        expect(isEmotionBuffEnabled({})).toBe(false);
        expect(isEmotionBuffEnabled({emotionConfig: {enabled:false}})).toBe(false);
    });
    it('is unaffected by daily schedule setting', () => {
        expect(isEmotionBuffEnabled({emotionConfig:{enabled:true},scheduleFeatureEnabled:false} as any)).toBe(true);
        expect(isEmotionBuffEnabled({emotionConfig:{enabled:false},scheduleFeatureEnabled:true} as any)).toBe(false);
    });
});
