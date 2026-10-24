// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  canUsePhoneApiBudget, readPhoneApiBudget, readPhoneAutonomyPreferences,
  reservePhoneApiBudget, writePhoneAutonomyPreferences,
} from './characterPhoneApiBudget';

beforeEach(() => localStorage.clear());

describe('Shared per-Char phone AI quota', () => {
  const start = new Date(2026, 9, 25, 9, 0, 0).getTime();
  it('defaults to economy, counts every category against one budget and blocks immediate retries', () => {
    expect(readPhoneAutonomyPreferences('a')).toMatchObject({
      pace: 'economy', browserAutoEnabled: true, selfProfileAutoEnabled: true,
    });
    expect(readPhoneApiBudget('a', start).limit).toBe(6);
    expect(reservePhoneApiBudget('a', start)).toBe(true);
    expect(readPhoneApiBudget('a', start).requests).toBe(1);
    expect(reservePhoneApiBudget('a', start + 10 * 60_000)).toBe(false);
    expect(readPhoneApiBudget('b', start).requests).toBe(0);
    expect(canUsePhoneApiBudget('a', start + 65 * 60_000)).toBe(true);
  });
  it('caps the day and resets on the next local date without losing the last request timestamp', () => {
    for (let i = 0; i < 6; i++) {
      expect(reservePhoneApiBudget('a', start + i * 65 * 60_000)).toBe(true);
    }
    expect(readPhoneApiBudget('a', start + 6 * 65 * 60_000).remaining).toBe(0);
    expect(reservePhoneApiBudget('a', start + 6 * 65 * 60_000)).toBe(false);
    const tomorrow = new Date(2026, 9, 26, 9, 0, 0).getTime();
    expect(readPhoneApiBudget('a', tomorrow).requests).toBe(0);
    expect(reservePhoneApiBudget('a', tomorrow)).toBe(true);
  });
  it('preserves existing consumption when toggling to balanced mode', () => {
    expect(reservePhoneApiBudget('a', start)).toBe(true);
    writePhoneAutonomyPreferences('a', {
      pace:'balanced', browserAutoEnabled:false, selfProfileAutoEnabled:false,
    });
    expect(readPhoneApiBudget('a', start).requests).toBe(1);
    expect(readPhoneApiBudget('a', start).limit).toBe(12);
    expect(canUsePhoneApiBudget('a', start + 35*60_000)).toBe(true);
    expect(readPhoneAutonomyPreferences('a')).toMatchObject({
      browserAutoEnabled:false, selfProfileAutoEnabled:false,
    });
  });
  it('fails closed rather than spending unlimited retries when local storage is unavailable', () => {
    expect(reservePhoneApiBudget('', start)).toBe(false);
    expect(readPhoneApiBudget('a', start).requests).toBe(0);
  });
});
