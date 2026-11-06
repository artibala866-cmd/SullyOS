import { describe, expect, it } from 'vitest';
import { BABY_DOG_DURATION_MS, getBabyDogFrame } from './babyDogBootTimeline';

describe('Baby Dog rhythmic opening', () => {
  it('fits the accelerated 3.9s splash without a long silent hold', () => {
    expect(BABY_DOG_DURATION_MS).toBe(3900);
    expect(getBabyDogFrame(0)).toEqual({
      expression: 'normal', mirrored: false, label: 'none', welcome: false,
    });
    expect(getBabyDogFrame(3900)).toEqual({
      expression: 'normal', mirrored: false, label: 'bottom', welcome: true,
    });
  });

  it.each([
    [900, 'normal', 'right', false],
    [1150, 'blink', 'right', false],
    [1280, 'normal', 'right', false],
    [1500, 'squint', 'none', false],
    [1819, 'normal', 'none', false],
    [1820, 'blink', 'none', false],
    [2020, 'tongue', 'none', false],
    [2250, 'normal', 'none', false],
    [2350, 'squint', 'none', false],
    [2780, 'blink', 'none', false],
    [3000, 'tongue', 'none', false],
    [3250, 'normal', 'bottom', true],
    [5000, 'normal', 'bottom', true],
  ] as const)('at %sms: %s, dog=%s, welcome=%s',
    (ms, expression, label, welcome) => {
      expect(getBabyDogFrame(ms)).toEqual({
        expression, mirrored: false, label, welcome,
      });
    },
  );

  it('has no mirroring, overlapping modes, or caption flicker', () => {
    let welcomeStarted = false;
    for (let ms = 0; ms <= 4500; ms += 10) {
      const frame = getBabyDogFrame(ms);
      expect(frame.mirrored).toBe(false);
      if (frame.welcome) welcomeStarted = true;
      if (welcomeStarted) expect(frame.welcome).toBe(true);
      if (ms >= BABY_DOG_DURATION_MS) expect(frame.expression).toBe('normal');
    }
  });
});
