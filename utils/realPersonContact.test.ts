// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import { loadCharacterContextMessages } from './chatContextRange';
import { recordCharacterLifeEvent, type CharacterLifeEvent } from './characterLifeEvents';
import { setRealPersonModeEnabled } from './realPersonMode';
import { considerRealPersonContact, recheckRealPersonContacts, pickRealPersonContact, resumeRealPersonContact, clearDeferredRealPersonContact } from './realPersonContact';

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

it('resumes an authorized saved event once after reconnecting without generating while offline', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const network = vi.fn().mockResolvedValue(answer('刚才聊到纸的纹理，想到你那张画了。'));
  vi.stubGlobal('fetch', network);
  await considerRealPersonContact(input());
  await resumeRealPersonContact(input());
  expect(network).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  await resumeRealPersonContact(input());
  await resumeRealPersonContact(input());
  expect(network).toHaveBeenCalledOnce();
});

it.each(['真人感', '主动消息'])('discards deferred contact after %s is revoked and re-enabled', async which => {
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  await considerRealPersonContact(input());
  if (which === '真人感') {
    setRealPersonModeEnabled(false);
    setRealPersonModeEnabled(true);
  } else {
    clearDeferredRealPersonContact(char.id);
  }
  visible.mockReturnValue('visible');
  await resumeRealPersonContact(input());
  expect(network).not.toHaveBeenCalled();
});

it.each(['none', 'new speech', 'revocation'])('delivers bubbles from one response and stops on interruption (%s)', async interruption => {
  const network = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ action: 'send', parts: [
      '刚才聊到纸的纹理，想到你那张画了。',
      '我才发现同样的颜料在粗纹纸上晕开的样子很不同。',
    ] }) } }],
  }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', network);
  vi.mocked(DB.saveMessage).mockImplementation(async message => {
    const id = history.at(-1)!.id + 1;
    history = [...history, { ...message, id, timestamp: Date.now() }];
    if (interruption === 'new speech') history.push({ ...history[0], id: id + 1, content: '先聊别的', timestamp: Date.now() });
    return id;
  });
  if (interruption === 'revocation') {
    window.addEventListener('active-msg-received', () => setRealPersonModeEnabled(false), { once: true });
  }
  await considerRealPersonContact(input());
  expect(network).toHaveBeenCalledOnce();
  expect(DB.saveMessage).toHaveBeenCalledTimes(interruption === 'none' ? 2 : 1);
  expect(DB.deleteMessages).not.toHaveBeenCalled();
});

it('does not buy a reply for life material already discussed in this conversation', async () => {
  history[1].content = '朋友在画室聊到了水彩纸。这个我们已经说过了。';
  event = { ...event, id: 'already-discussed', summary: '朋友在画室聊到了水彩纸' };
  recordCharacterLifeEvent(event);
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  await considerRealPersonContact(input());
  expect(network).not.toHaveBeenCalled();
});

it('yields before API spend when the same character has an imminent cloud message', async () => {
  char.activeMsg2Config!.tasks = [{
    taskUuid: 'upcoming', clientTaskId: 'upcoming', source: 'user', expirePolicy: 'expire', createdAt: Date.now(),
    firstSendTime: new Date(Date.now() + 30_000).toISOString(),
    recurrenceType: 'none', status: 'scheduled', mode: 'prompted',
  }];
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  await considerRealPersonContact(input());
  expect(network).not.toHaveBeenCalled();
});
