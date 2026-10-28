// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';
import { readCharacterLifeEvents, recordCharacterLifeEvent } from './characterLifeEvents';
import { buildIndependentLifeGlimpseRequest, generateIndependentLifeGlimpse, setManualLifeGlimpseEnabled } from './characterLifeGlimpseGeneration';
import { fetchCharacterPhoneJson } from './characterPhoneAiRequest';

vi.mock('./characterPhoneAiRequest', () => ({ fetchCharacterPhoneJson: vi.fn() }));
const char = { id: 'char', name: '迟木', systemPrompt: '只用原角色语气，不改变原有设定。' } as CharacterProfile;
const event = { id: 'e1', characterId: 'char', kind: 'activity' as const, source: 'real-mode' as const, occurredAt: 1_000, summary: '整理完书桌' };
const api = { baseUrl: 'https://example.invalid/v1', apiKey: 'key', model: 'model' };
beforeEach(() => { localStorage.clear(); vi.mocked(fetchCharacterPhoneJson).mockReset(); });

describe('independent grounded life narration API', () => {
  it('keeps its prompt separate from private chat and labels a plan as no evidence', () => {
    const request = buildIndependentLifeGlimpseRequest(char, event, [], null);
    expect(request).toHaveLength(2);
    expect(request[0].content).toContain('不是私聊回复器');
    expect(request[0].content).toContain('不能把日程计划当作发生的事');
    expect(request[1].content).toContain('整理完书桌');
  });
  it('makes no request unless specifically opted in', async () => {
    recordCharacterLifeEvent(event);
    expect(await generateIndependentLifeGlimpse({ char, event, api })).toBe('skipped');
    expect(fetchCharacterPhoneJson).not.toHaveBeenCalled();
  });
  it('saves only an optional narrative after manual opt-in', async () => {
    recordCharacterLifeEvent(event); setManualLifeGlimpseEnabled('char', true);
    vi.mocked(fetchCharacterPhoneJson).mockResolvedValue({ response: { ok: true } as Response,
      json: { choices: [{ message: { content: JSON.stringify({ skip: false, text: '桌面终于腾出地方，心里也稍微松了一点。' }) } }] } });
    expect(await generateIndependentLifeGlimpse({ char, event, api })).toBe('saved');
    expect(readCharacterLifeEvents('char')).toHaveLength(1);
    expect(readCharacterLifeEvents('char')[0].summary).toBe('整理完书桌');
  });
  it('discards late work when opt-in is disabled during the API request', async () => {
    recordCharacterLifeEvent(event); setManualLifeGlimpseEnabled('char', true);
    vi.mocked(fetchCharacterPhoneJson).mockImplementation(async () => {
      setManualLifeGlimpseEnabled('char', false);
      return { response: { ok: true } as Response,
        json: { choices: [{ message: { content: JSON.stringify({ skip: false, text: '过期文字不能落库。' }) } }] } };
    });
    expect(await generateIndependentLifeGlimpse({ char, event, api })).toBe('skipped');
    expect(readCharacterLifeEvents('char')[0].glimpse).toBeUndefined();
  });
});
