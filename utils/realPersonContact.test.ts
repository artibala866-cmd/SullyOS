// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import { loadCharacterContextMessages } from './chatContextRange';
import { recordCharacterLifeEvent, type CharacterLifeEvent } from './characterLifeEvents';
import { setRealPersonModeEnabled } from './realPersonMode';
import { considerRealPersonContact, recheckRealPersonContacts, pickRealPersonContact } from './realPersonContact';

vi.mock('./db', () => ({
  DB: { getRecentMessagesByCharId: vi.fn(), getCharacter: vi.fn(), saveMessage: vi.fn(), deleteMessages: vi.fn() },
}));
vi.mock('./chatContextRange', () => ({ loadCharacterContextMessages: vi.fn() }));
vi.mock('./context', () => ({
  ContextBuilder: { buildCharacterContext: vi.fn(async ({ history }) => ({ coreContext: 'role', history })) },
}));
vi.mock('./characterLifeScheduleContext', () => ({
  getCharacterLifeScheduleContext: vi.fn(async () => ({ plannedActivity: null })),
}));

let char: CharacterProfile;
let event: CharacterLifeEvent;
let history: Message[];
const input = () => ({
  currentChar: () => char,
  user: { name: 'User' } as UserProfile,
  apiConfig: { baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'mock' } as APIConfig,
  event,
});
const answer = (text: string) => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ action: 'send', text }) } }],
}), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  setRealPersonModeEnabled(true);
  const now = Date.now();
  char = { id: 'test-contact', name: 'Char', activeMsg2Config: { enabled: true } } as CharacterProfile;
  history = [
    { id: 1, charId: char.id, role: 'user', type: 'text', content: '水彩画明天再画', timestamp: now - 7 * 3600_000 - 1000 },
    { id: 2, charId: char.id, role: 'assistant', type: 'text', content: '那就早点休息', timestamp: now - 7 * 3600_000 },
  ];
  event = { characterId: char.id, id: 'activity', source: 'phone', kind: 'npc-chat', occurredAt: now - 100, summary: '朋友聊到了水彩纸' };
  recordCharacterLifeEvent(event);
  vi.mocked(DB.getRecentMessagesByCharId).mockImplementation(async () => history);
  vi.mocked(DB.getCharacter).mockImplementation(async () => char);
  vi.mocked(loadCharacterContextMessages).mockImplementation(async () => history);
  vi.mocked(DB.saveMessage).mockResolvedValue(3);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('requires both switches and a saved recent event, and never competes with an unanswered user message', async () => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  setRealPersonModeEnabled(false);
  await considerRealPersonContact(input());
  setRealPersonModeEnabled(true);
  char.activeMsg2Config!.enabled = false;
  await considerRealPersonContact(input());
  char.activeMsg2Config!.enabled = true;
  await considerRealPersonContact({ ...input(), event: { ...event, id: 'not-saved' } });
  history.pop();
  await considerRealPersonContact(input());
  expect(network).not.toHaveBeenCalled();
});

it('grounds a reconnection in one saved event and consumes the opportunity after one request', async () => {
  const network = vi.fn().mockResolvedValue(answer('你那张水彩画后来画了吗？刚聊到纸的纹理，想起你了。'));
  vi.stubGlobal('fetch', network);
  await considerRealPersonContact(input());
  await considerRealPersonContact(input());
  expect(network).toHaveBeenCalledOnce();
  expect(String(network.mock.calls[0][1].body)).toContain(event.summary);
  expect(DB.saveMessage).toHaveBeenCalledOnce();
  expect(DB.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
    role: 'assistant', metadata: { countsAsReply: false, realPersonContact: 'reconnect' },
  }));
});

it('drops a late completion when new user speech changes the originating turn', async () => {
  let finish!: (response: Response) => void;
  const network = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', network);
  const pending = considerRealPersonContact(input());
  await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
  history = [...history, { ...history[0], id: 3, timestamp: Date.now(), content: '换个话题' }];
  finish(answer('还是想听你讲那张画'));
  await pending;
  expect(DB.saveMessage).not.toHaveBeenCalled();
});

it('aborts in-flight contact on revocation and opening the switch again cannot revive it', async () => {
  const network = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', network);
  const pending = considerRealPersonContact(input());
  await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
  char.activeMsg2Config!.enabled = false;
  recheckRealPersonContacts();
  char.activeMsg2Config!.enabled = true;
  await pending;
  await considerRealPersonContact(input());
  expect(network.mock.calls[0][1].signal?.aborted).toBe(true);
  expect(network).toHaveBeenCalledOnce();
  expect(DB.saveMessage).not.toHaveBeenCalled();
});

it('rejects empty greetings even when the model opts to send', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer('在吗？')));
  await considerRealPersonContact(input());
  expect(DB.saveMessage).not.toHaveBeenCalled();
});

it('permits one continuation of an unfinished topic and respects the user ending the conversation', async () => {
  history[0] = { ...history[0], content: '我还没想好该用什么纸，你觉得呢？', timestamp: Date.now() - 30 * 60_000 - 1000 };
  history[1] = { ...history[1], content: '我想一想。', timestamp: Date.now() - 30 * 60_000 };
  const network = vi.fn().mockResolvedValue(answer('刚想到可以先拿同一种颜料试试两张纸。'));
  vi.stubGlobal('fetch', network);
  const topic = history[0].content;
  history[0].content = '晚安，下次聊。';
  await considerRealPersonContact(input());
  expect(network).not.toHaveBeenCalled();
  history[0].content = topic;
  expect(pickRealPersonContact(char, history, event)?.kind).toBe("follow-up");
  await considerRealPersonContact(input());
  expect(DB.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
    metadata: { countsAsReply: false, realPersonContact: 'follow-up' },
  }));
});
