import { describe, expect, it } from 'vitest';
import { getBabyDogFrame } from './babyDogBootTimeline';

describe('Baby Dog reference-video sequence', () => {
  it.each([
    [0, 'normal', false, 'none', false],
    [500, 'normal', false, 'left', false],
    [740, 'normal', false, 'right', false],
    [1100, 'normal', false, 'left', false],
    [1580, 'normal', false, 'right', false],
    [2020, 'normal', false, 'none', true],
    [3000, 'blink', false, 'none', false],
    [3470, 'normal', false, 'none', true],
    [4260, 'blink', false, 'none', false],
    [4800, 'normal', false, 'none', true],
    [5510, 'squint', false, 'none', false],
    [6140, 'squint', true, 'none', false],
    [6510, 'squint', true, 'none', false],
    [7010, 'normal', false, 'bottom', false],
    [7800, 'normal', false, 'none', true],
  ] as const)('at %sms: %s eyes, mirror=%s, dog=%s, welcome=%s',
    (ms, expression, mirrored, label, welcome) => {
      expect(getBabyDogFrame(ms)).toEqual({expression, mirrored, label, welcome});
    },
  );
  it('does not flip before squint or duplicate the expression', () => {
    expect(getBabyDogFrame(5829).mirrored).toBe(false);
    expect(getBabyDogFrame(5830).mirrored).toBe(true);
    expect(getBabyDogFrame(6780).mirrored).toBe(false);
    expect(getBabyDogFrame(5329).expression).toBe('normal');
    expect(getBabyDogFrame(5330).expression).toBe('squint');
    expect(getBabyDogFrame(6770).expression).toBe('normal');
  });
});
