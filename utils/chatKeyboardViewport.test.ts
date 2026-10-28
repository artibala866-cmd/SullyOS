import { describe, expect, it } from 'vitest';
import { isChatKeyboardCovered } from './chatKeyboardViewport';

describe('Android chat keyboard viewport guard', () => {
    it('detects actual occlusion against the pre-focus baseline', () => {
        expect(isChatKeyboardCovered(850, 520)).toBe(true);
        expect(isChatKeyboardCovered(850, 850)).toBe(false);
        expect(isChatKeyboardCovered(850, 710)).toBe(false);
    });
    it('handles Android shrinking both layout and visual viewports', () => {
        expect(isChatKeyboardCovered(850, 520, 0)).toBe(true);
        expect(isChatKeyboardCovered(850, 840, 0)).toBe(false);
    });
    it('includes visual viewport offset and rejects invalid readings', () => {
        expect(isChatKeyboardCovered(850, 660, 40)).toBe(true);
        expect(isChatKeyboardCovered(850, 770, 40)).toBe(false);
        expect(isChatKeyboardCovered(0, 500)).toBe(false);
        expect(isChatKeyboardCovered(850, Number.NaN)).toBe(false);
    });
});
