// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { saveNpcProfiles, type NpcProfile } from './characterPhoneNpcs';
import { appendCharacterPhoneMessages, readCharacterPhoneChats } from './characterPhoneChats';
import { readCharacterLifeEvents } from './characterLifeEvents';
import { runCharacterPhoneAutonomy } from './characterPhoneAutonomy';
import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';
import type { CharacterProfile, UserProfile } from '../types';

vi.mock('./characterLifeScheduleContext', () => ({
  getCharacterLifeScheduleContext: vi.fn(),
}));
vi.mock('./characterPhoneContext', () => ({
  buildCharacterPhoneContext: vi.fn(async () => ({ systemPrompt: '角色生活上下文', privateMessages: [] })),
}));
let serial = 0;
const char = (id: string) => ({
  id, name: '若川', systemPrompt: '说话自然、忙时晚回', scheduleFeatureEnabled: true,
}) as CharacterProfile;
const input = (id: string) => ({
  char: char(id), user: { name: '用户' } as UserProfile, groups: [],
  api: { baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'test' },
});
const contacts = (): NpcProfile[] => ['阿林', '小乔', '阿树', '姜姨'].map((name, index) => ({
  id: 'npc' + index, name, identity: '普通朋友', personality: '独立，有自己的事',
  relationship: '朋友', background: '认识多年', source: 'generated',
  createdAt: Date.now() - 86400000,
}));
const mockApi = () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ send: true, messages: ['刚想起来件事。'] }),
    } }] }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
beforeEach(() => {
  localStorage.clear();
  serial = 0;
  vi.stubGlobal('crypto', { randomUUID: () => 'phone-test-' + (++serial) });
  vi.mocked(getCharacterLifeScheduleContext).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('character-owned autonomous phone behavior', () => {
  it('lets an NPC send a message while Char is busy, without fabricating Char speech', async () => {
    saveNpcProfiles('busy', contacts());
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId: 'busy', observedAt: Date.now(),
      plannedActivity: '上班', plannedDescription: '办公室',
      confirmedEvents: [],
    });
    const request = mockApi();
    expect(await runCharacterPhoneAutonomy(input('busy'))).toBe('messaged');
    expect(request).toHaveBeenCalledTimes(1);
    const chats = readCharacterPhoneChats('busy');
    expect(chats).toHaveLength(1);
    expect(chats[0].messages).toHaveLength(1);
    expect(chats[0].messages[0].speaker.role).toBe('contact');
    expect(readCharacterLifeEvents('busy')[0].kind).toBe('npc-chat');
    // Same window must not issue another API request.
    expect(await runCharacterPhoneAutonomy(input('busy'))).toBe('skipped');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('prioritizes replying to a persisted unanswered NPC message', async () => {
    saveNpcProfiles('reply', contacts());
    const at = Date.now() - 20 * 60_000;
    appendCharacterPhoneMessages({
      characterId: 'reply', contactId: 'npc0', contactName: '阿林', at,
      messages: [{ speaker: { role: 'contact', contactId: 'npc0' }, text: '有空聊两句吗？', createdAt: at }],
    });
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId: 'reply', observedAt: Date.now(),
      plannedActivity: null, plannedDescription: null, confirmedEvents: [],
    });
    mockApi();
    expect(await runCharacterPhoneAutonomy(input('reply'))).toBe('messaged');
    const chat = readCharacterPhoneChats('reply').find(r => r.contactId === 'npc0');
    expect(chat?.messages.map(m => m.speaker.role)).toEqual(['contact', 'owner']);
  });

  it('does not use sleeping schedules as completed activities or auto-create messages', async () => {
    saveNpcProfiles('sleep', contacts());
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId: 'sleep', observedAt: Date.now(),
      plannedActivity: '睡觉', plannedDescription: null, confirmedEvents: [],
    });
    const request = mockApi();
    expect(await runCharacterPhoneAutonomy(input('sleep'))).toBe('skipped');
    expect(request).not.toHaveBeenCalled();
    expect(readCharacterPhoneChats('sleep')).toHaveLength(0);
  });
});
