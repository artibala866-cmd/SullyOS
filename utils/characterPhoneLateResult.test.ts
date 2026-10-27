// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { considerAutonomousMoment } from './characterMomentAutonomy';
import { considerCharacterMemo } from './characterMemoAutonomy';
import { readCharacterMoments, publishCharacterMoment } from './characterPhoneMoments';
import { appendCharacterMemo, readCharacterMemos } from './characterPhoneMemos';
import { readCharacterLifeEvents, recordCharacterLifeEvent, pruneCharacterPhoneLifeEvents } from './characterLifeEvents';
import { setCharacterPhoneAutonomyEnabled } from './characterPhoneAutonomy';
import { writePhoneAutonomyPreferences, readPhoneApiBudget } from './characterPhoneApiBudget';

vi.mock('./keepAlive', () => ({ KeepAlive: { start: vi.fn(async () => {}), stop: vi.fn() } }));
vi.mock('./characterPhoneContext', () => ({
  buildCharacterPhoneContext: vi.fn(async () => ({ systemPrompt: '角色设定与已有聊天', privateMessages: [] })),
}));
vi.mock('./characterLifeScheduleContext', () => ({
  getCharacterLifeScheduleContext: vi.fn(async () => ({
    plannedActivity: '工作', plannedDescription: '办公室', confirmedEvents: [],
  })),
}));

const api = { baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'test' };
const char = (id: string) => ({ id, name: '若川', systemPrompt: '独立生活' }) as CharacterProfile;
const user = { name: '用户' } as UserProfile;
const reply = (value: unknown) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
});
const activity = (id: string, kind: 'activity' | 'npc-chat' = 'activity') => {
  const event = {
    id: 'real-event:' + id, characterId: id, kind, occurredAt: Date.now() - 1000,
    source: kind === 'npc-chat' ? 'phone' as const : 'real-mode' as const,
    summary: '已实际发生并保存的活动',
  };
  expect(recordCharacterLifeEvent(event)).toBe(true);
  return event;
};

function delayedReply() {
  let complete!: (result: ReturnType<typeof reply>) => void;
  const fetchMock = vi.fn(() => new Promise<ReturnType<typeof reply>>(resolve => { complete = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, finish: (value: unknown) => complete(reply(value)) };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe('late autonomous phone completion safety', () => {
  it('does not publish a late Moment after the user switches autonomous phone generation off', async () => {
    const id = 'moments-off', event = activity(id);
    const network = delayedReply();
    const pending = considerAutonomousMoment({ char: char(id), user, groups: [], api, budgeted: true });
    await vi.waitFor(() => expect(network.fetchMock).toHaveBeenCalledTimes(1));
    setCharacterPhoneAutonomyEnabled(id, false);
    network.finish({ publish: true, text: '刚刚完成工作', eventIds: [event.id] });
    expect(await pending).toBe('skipped');
    expect(readCharacterMoments(id)).toEqual([]);
    expect(readPhoneApiBudget(id).requests).toBe(1);
  });

  it('does not resurrect a phone event cleared during an in-flight Moment decision', async () => {
    const id = 'moments-cleared', event = activity(id, 'npc-chat');
    const network = delayedReply();
    const pending = considerAutonomousMoment({ char: char(id), user, groups: [], api, budgeted: true });
    await vi.waitFor(() => expect(network.fetchMock).toHaveBeenCalledTimes(1));
    expect(pruneCharacterPhoneLifeEvents(id, ['npc-chat'])).toBe(1);
    network.finish({ publish: true, text: '和朋友聊完了', eventIds: [event.id] });
    expect(await pending).toBe('skipped');
    expect(readCharacterMoments(id)).toHaveLength(0);
  });

  it('does not publish an outdated Moment after a newer post was stored', async () => {
    const id = 'moments-newer', event = activity(id);
    const network = delayedReply();
    const pending = considerAutonomousMoment({ char: char(id), user, groups: [], api, budgeted: true });
    await vi.waitFor(() => expect(network.fetchMock).toHaveBeenCalledTimes(1));
    const manualPost = publishCharacterMoment({ characterId: id, origin: 'char', text: '我刚刚自己写的', imageUrls: [], visibility: 'all' });
    expect(manualPost).not.toBeNull();
    network.finish({ publish: true, text: '过时的自动动态', eventIds: [event.id] });
    expect(await pending).toBe('skipped');
    expect(readCharacterMoments(id).map(p => p.text)).toEqual(['我刚刚自己写的']);
  });

  it('preserves manually edited memos when a paid automatic result arrives late', async () => {
    const id = 'memo-edited';
    activity(id);
    const network = delayedReply();
    const pending = considerCharacterMemo({
      characterId: id, name: '若川', persona: '独立', api,
      events: readCharacterLifeEvents(id), char: { id }, budgeted: true,
    });
    await vi.waitFor(() => expect(network.fetchMock).toHaveBeenCalledTimes(1));
    expect(appendCharacterMemo({ characterId: id, category: 'thought', body: '我自己写的内容', private: true })).not.toBeNull();
    network.finish({ action: 'create', category: 'thought', body: '过时的自动生成笔记' });
    expect(await pending).toBe(false);
    expect(readCharacterMemos(id).map(m => m.body)).toEqual(['我自己写的内容']);
  });

  it('does not restore a cleared memo event after its autonomous API completion', async () => {
    const id = 'memo-cleared';
    activity(id, 'npc-chat');
    const network = delayedReply();
    const pending = considerCharacterMemo({
      characterId: id, name: '若川', persona: '独立', api,
      events: readCharacterLifeEvents(id), char: { id }, budgeted: true,
    });
    await vi.waitFor(() => expect(network.fetchMock).toHaveBeenCalledTimes(1));
    expect(pruneCharacterPhoneLifeEvents(id, ['npc-chat'])).toBe(1);
    network.finish({ action: 'create', category: 'thought', body: '已被清空的对话' });
    expect(await pending).toBe(false);
    expect(readCharacterMemos(id)).toEqual([]);
  });

  it('keeps the existing explicit manual memo generation working when background autonomy is off', async () => {
    const id = 'memo-manual';
    setCharacterPhoneAutonomyEnabled(id, false);
    writePhoneAutonomyPreferences(id, { backgroundApiEnabled: false });
    const fetchMock = vi.fn().mockResolvedValue(reply({ entries: [
      { category: 'thought', title: '我自己的生活', body: '计划周末做些手工' },
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await considerCharacterMemo({
      characterId: id, name: '若川', persona: '独立', api, events: [], manual: true,
    })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCharacterMemos(id)).toHaveLength(1);
  });
});
