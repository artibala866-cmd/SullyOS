// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { saveNpcProfiles, readNpcProfiles, type NpcProfile } from './characterPhoneNpcs';
import { appendCharacterPhoneMessages, readCharacterPhoneChats } from './characterPhoneChats';
import { readCharacterLifeEvents } from './characterLifeEvents';
import { runCharacterPhoneAutonomy, setCharacterPhoneAutonomyEnabled } from './characterPhoneAutonomy';
import {touchLocalChatLease} from './amsgChatGenerationLease';
import { readPhoneApiBudget, writePhoneAutonomyPreferences } from './characterPhoneApiBudget';
import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';
import { clearSelectedPhoneData } from './characterPhoneClear';
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
  it('honors the existing Char autonomy master switch without starting a phone task', async () => {
    saveNpcProfiles('master-off', contacts());
    setCharacterPhoneAutonomyEnabled('master-off', false);
    const request = mockApi();
    expect(await runCharacterPhoneAutonomy(input('master-off'))).toBe('unavailable');
    expect(getCharacterLifeScheduleContext).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(readPhoneApiBudget('master-off').requests).toBe(0);
  });

  it('does not start an independent phone AI call while real-person private chat is generating in another tab', async () => {
    saveNpcProfiles('chat-busy', contacts());
    touchLocalChatLease('chat-busy');
    const request=mockApi();
    expect(await runCharacterPhoneAutonomy(input('chat-busy'))).toBe('skipped');
    expect(request).not.toHaveBeenCalled();
    expect(readPhoneApiBudget('chat-busy').requests).toBe(0);
    expect(getCharacterLifeScheduleContext).not.toHaveBeenCalled();
  });

  it('stops separately billed phone generation while keeping saved NPC records', async () => {
    saveNpcProfiles('api-off', contacts());
    writePhoneAutonomyPreferences('api-off', { backgroundApiEnabled:false });
    const request = mockApi();
    expect(await runCharacterPhoneAutonomy(input('api-off'))).toBe('skipped');
    expect(request).not.toHaveBeenCalled();
    expect(getCharacterLifeScheduleContext).not.toHaveBeenCalled();
    expect(readPhoneApiBudget('api-off').requests).toBe(0);
    expect(readCharacterPhoneChats('api-off')).toEqual([]);
  });


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
    const requestBody = JSON.parse(String((request.mock.calls[0]?.[1] as any)?.body || '{}'));
    expect(requestBody.messages?.[0]?.content).toContain('角色当前时间与时间感知');
    expect(requestBody.messages?.[0]?.content).toContain('不要按固定循环随机换联系人/话题');
    expect(requestBody.messages?.[0]?.content).toContain('现在是');
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

  it('replies to a waiting NPC even if the address book is small, without spending on bootstrap', async () => {
    saveNpcProfiles('small-book', contacts().slice(0, 2));
    const at = Date.now() - 20 * 60_000;
    appendCharacterPhoneMessages({
      characterId: 'small-book', contactId: 'npc0', contactName: '阿林', at,
      messages: [{ speaker: { role: 'contact', contactId: 'npc0' }, text: '你明天有时间吗？', createdAt: at }],
    });
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId: 'small-book', observedAt: Date.now(),
      plannedActivity: null, plannedDescription: null, confirmedEvents: [],
    });
    const api = mockApi();
    expect(await runCharacterPhoneAutonomy({ ...input('small-book'), replyOnly: true })).toBe('messaged');
    expect(api).toHaveBeenCalledTimes(1);
    expect(readNpcProfiles('small-book')).toHaveLength(2);
    expect(readPhoneApiBudget('small-book').requests).toBe(1);
    expect(readCharacterPhoneChats('small-book')[0].messages.map(m => m.speaker.role))
      .toEqual(['contact', 'owner']);
  });

  it('prioritizes an existing NPC reply over contact bootstrap even on a life-event opportunity', async () => {
    saveNpcProfiles('small-life', contacts().slice(0, 2));
    const at = Date.now() - 24 * 60_000;
    appendCharacterPhoneMessages({
      characterId:'small-life', contactId:'npc0', contactName:'阿林', at,
      messages:[{ speaker:{role:'contact', contactId:'npc0'},text:'你上次说的事后来怎么样了？',createdAt:at }],
    });
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'small-life',observedAt:Date.now(),
      plannedActivity:null,plannedDescription:null,confirmedEvents:[],
    });
    const request = mockApi();
    expect(await runCharacterPhoneAutonomy(input('small-life'))).toBe('messaged');
    expect(request).toHaveBeenCalledTimes(1);
    expect(readNpcProfiles('small-life')).toHaveLength(2);
    expect(readCharacterPhoneChats('small-life')[0].messages.map(m=>m.speaker.role))
      .toEqual(['contact','owner']);
  });

  it('does not create contacts or start new topics for reply-only opportunities without waiting messages', async () => {
    saveNpcProfiles('no-reply', contacts().slice(0, 2));
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId: 'no-reply', observedAt: Date.now(),
      plannedActivity: null, plannedDescription: null, confirmedEvents: [],
    });
    const api = mockApi();
    expect(await runCharacterPhoneAutonomy({ ...input('no-reply'), replyOnly: true })).toBe('skipped');
    expect(api).not.toHaveBeenCalled();
    expect(readPhoneApiBudget('no-reply').requests).toBe(0);
    expect(readNpcProfiles('no-reply')).toHaveLength(2);
  });

  it('does not save a late autonomous reply after the user disables autonomy', async () => {
    saveNpcProfiles('disabled-midflight', contacts().slice(0, 2));
    const at = Date.now() - 20 * 60_000;
    appendCharacterPhoneMessages({
      characterId:'disabled-midflight',contactId:'npc0',contactName:'阿林',at,
      messages:[{speaker:{role:'contact',contactId:'npc0'},text:'你在吗？',createdAt:at}],
    });
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'disabled-midflight', observedAt:Date.now(),
      plannedActivity:null,plannedDescription:null,confirmedEvents:[],
    });
    let complete!: (response: unknown) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = runCharacterPhoneAutonomy({ ...input('disabled-midflight'), replyOnly:true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    setCharacterPhoneAutonomyEnabled('disabled-midflight', false);
    complete({
      ok:true,status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
        send:true,messages:['我在。'],
      })}}]}),
    });
    expect(await pending).toBe('skipped');
    expect(readCharacterPhoneChats('disabled-midflight')[0].messages.map(m => m.speaker.role))
      .toEqual(['contact']);
    expect(readPhoneApiBudget('disabled-midflight').requests).toBe(1);
  });

  it('rejects an old NPC reply after autonomy is disabled then enabled during the same request', async () => {
    saveNpcProfiles('toggle-back-reply', contacts().slice(0, 2));
    const at = Date.now() - 20 * 60_000;
    appendCharacterPhoneMessages({
      characterId: 'toggle-back-reply', contactId: 'npc0', contactName: '阿林', at,
      messages: [{ speaker: { role: 'contact', contactId: 'npc0' }, text: '在吗', createdAt: at }],
    });
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId: 'toggle-back-reply', observedAt: Date.now(),
      plannedActivity: null, plannedDescription: null, confirmedEvents: [],
    });
    let complete!: (response: unknown) => void;
    const request = vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    vi.stubGlobal('fetch', request);
    const pending = runCharacterPhoneAutonomy({ ...input('toggle-back-reply'), replyOnly: true });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    setCharacterPhoneAutonomyEnabled('toggle-back-reply', false);
    setCharacterPhoneAutonomyEnabled('toggle-back-reply', true);
    complete({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        send: true, messages: ['不应复活的旧回复'],
      }) } }] }),
    });
    expect(await pending).toBe('skipped');
    expect(readCharacterPhoneChats('toggle-back-reply')[0].messages.map(m => m.text)).toEqual(['在吗']);
    expect(readPhoneApiBudget('toggle-back-reply').requests).toBe(1);
  });

  it('rejects late contacts from an old request after the autonomy switch is toggled off and back on', async () => {
    saveNpcProfiles('toggle-back-contacts', contacts().slice(0, 2));
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId: 'toggle-back-contacts', observedAt: Date.now(),
      plannedActivity: null, plannedDescription: null, confirmedEvents: [],
    });
    let complete!: (response: unknown) => void;
    const request = vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    vi.stubGlobal('fetch', request);
    const pending = runCharacterPhoneAutonomy(input('toggle-back-contacts'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    setCharacterPhoneAutonomyEnabled('toggle-back-contacts', false);
    setCharacterPhoneAutonomyEnabled('toggle-back-contacts', true);
    complete({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        contacts: [{ name: '旧任务制造的联系人', identity: '同事',
          personality: '稳重', relationship: '同事', origin: 'introduced', evidence: 'suggested' }],
      }) } }] }),
    });
    expect(await pending).toBe('skipped');
    expect(readNpcProfiles('toggle-back-contacts')).toHaveLength(2);
  });

  it('switching permission off during schedule lookup does not start a new background API request', async () => {
    saveNpcProfiles('toggle-while-schedule', contacts());
    let resolveSchedule!: (value: any) => void;
    vi.mocked(getCharacterLifeScheduleContext).mockImplementationOnce(() =>
      new Promise(resolve => { resolveSchedule = resolve; }));
    const request = mockApi();
    const pending = runCharacterPhoneAutonomy(input('toggle-while-schedule'));
    setCharacterPhoneAutonomyEnabled('toggle-while-schedule', false);
    setCharacterPhoneAutonomyEnabled('toggle-while-schedule', true);
    resolveSchedule({
      characterId: 'toggle-while-schedule', observedAt: Date.now(),
      plannedActivity: null, plannedDescription: null, confirmedEvents: [],
    });
    expect(await pending).toBe('skipped');
    expect(request).not.toHaveBeenCalled();
    expect(readPhoneApiBudget('toggle-while-schedule').requests).toBe(0);
  });

  it('does not append a stale AI reply over a manual reply sent while API was running', async () => {
    saveNpcProfiles('manual-midflight', contacts().slice(0, 2));
    const at = Date.now() - 20 * 60_000;
    appendCharacterPhoneMessages({
      characterId:'manual-midflight',contactId:'npc0',contactName:'阿林',at,
      messages:[{speaker:{role:'contact',contactId:'npc0'},text:'今天忙不忙？',createdAt:at}],
    });
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'manual-midflight', observedAt:Date.now(),
      plannedActivity:null,plannedDescription:null,confirmedEvents:[],
    });
    let complete!: (response: unknown) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    vi.stubGlobal('fetch',fetchMock);
    const pending = runCharacterPhoneAutonomy({ ...input('manual-midflight'), replyOnly:true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    appendCharacterPhoneMessages({
      characterId:'manual-midflight',contactId:'npc0',contactName:'阿林',
      messages:[{speaker:{role:'owner'},text:'我刚回过你了。',createdAt:Date.now()}],
    });
    complete({
      ok:true,status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
        send:true,messages:['这条回复不该保存'],
      })}}]}),
    });
    expect(await pending).toBe('skipped');
    expect(readCharacterPhoneChats('manual-midflight')[0].messages.map(m => m.text))
      .toEqual(['今天忙不忙？','我刚回过你了。']);
  });

  it('does not bill two automatic calls when contact bootstrap returns no additions', async () => {
    saveNpcProfiles('bootstrap-noop', contacts().slice(0, 2));
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'bootstrap-noop',observedAt:Date.now(),
      plannedActivity:null,plannedDescription:null,confirmedEvents:[],
    });
    const request = vi.fn().mockResolvedValue({
      ok:true,status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({contacts:[]})}}]}),
    });
    vi.stubGlobal('fetch',request);
    expect(await runCharacterPhoneAutonomy(input('bootstrap-noop'))).toBe('skipped');
    expect(request).toHaveBeenCalledTimes(1);
    expect(readPhoneApiBudget('bootstrap-noop').requests).toBe(1);
    expect(readCharacterPhoneChats('bootstrap-noop')).toEqual([]);
  });

  it('does not bootstrap new NPC contacts or spend tokens when the Char is sleeping', async () => {
    // Empty address book used to trigger bootstrap before the sleep check.
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'sleep-bootstrap',observedAt:Date.now(),
      plannedActivity:'睡觉',plannedDescription:'夜间休息',confirmedEvents:[],
    });
    const api=mockApi();
    expect(await runCharacterPhoneAutonomy(input('sleep-bootstrap'))).toBe('skipped');
    expect(api).not.toHaveBeenCalled();
    expect(readCharacterPhoneChats('sleep-bootstrap')).toHaveLength(0);
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
  it('does not revive an NPC message older than 72 hours after a new unrelated life event', async () => {
    saveNpcProfiles('old-npc', contacts());
    const at = Date.now() - 5 * 86400_000;
    appendCharacterPhoneMessages({characterId:'old-npc',contactId:'npc0',contactName:'阿林',at,
      messages:[{speaker:{role:'contact',contactId:'npc0'},text:'旧消息',createdAt:at}]});
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'old-npc',observedAt:Date.now(),plannedActivity:null,plannedDescription:null,confirmedEvents:[],
    });
    const request=mockApi();
    expect(await runCharacterPhoneAutonomy({...input('old-npc'),replyOnly:true})).toBe('skipped');
    expect(request).not.toHaveBeenCalled();
  });

  it('does not restart an ancient owner-to-NPC thread just because another event was saved', async () => {
    saveNpcProfiles('old-followup', contacts().map(contact => ({
      ...contact, createdAt:Date.now()-10*86400_000,
    })));
    const at=Date.now()-5*86400_000;
    appendCharacterPhoneMessages({characterId:'old-followup',contactId:'npc0',contactName:'阿林',at,
      messages:[{speaker:{role:'owner'},text:'上个月再聊吧',createdAt:at}]});
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'old-followup',observedAt:Date.now(),plannedActivity:null,plannedDescription:null,confirmedEvents:[],
    });
    const request=mockApi();
    expect(await runCharacterPhoneAutonomy(input('old-followup'))).toBe('skipped');
    expect(request).not.toHaveBeenCalled();
  });

  it('a no-op phone tick cannot delay a later real NPC reply', async () => {
    saveNpcProfiles('no-motive', contacts().map(contact => ({
      ...contact, createdAt:Date.now()-10*86400_000,
    })));
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'no-motive',observedAt:Date.now(),plannedActivity:null,plannedDescription:null,confirmedEvents:[],
    });
    const request=mockApi();
    expect(await runCharacterPhoneAutonomy(input('no-motive'))).toBe('skipped');
    const at=Date.now()-20*60_000;
    appendCharacterPhoneMessages({characterId:'no-motive',contactId:'npc0',contactName:'阿林',at,
      messages:[{speaker:{role:'contact',contactId:'npc0'},text:'有空吗',createdAt:at}]});
    expect(await runCharacterPhoneAutonomy({...input('no-motive'),replyOnly:true})).toBe('messaged');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not start arbitrary chats with stale contacts when there is no recent thread or reason', async () => {
    saveNpcProfiles('stale', contacts().map(contact => ({
      ...contact, createdAt: Date.now() - 10 * 24 * 60 * 60_000,
    })));
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId: 'stale', observedAt: Date.now(),
      plannedActivity: null, plannedDescription: null, confirmedEvents: [],
    });
    const request = mockApi();
    expect(await runCharacterPhoneAutonomy(input('stale'))).toBe('skipped');
    expect(request).not.toHaveBeenCalled();
    expect(readCharacterPhoneChats('stale')).toHaveLength(0);
  });

  it('discards a bootstrap reply when contacts were cleared during the network request', async () => {
    saveNpcProfiles('clear-bootstrap', contacts().slice(0, 2));
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'clear-bootstrap',observedAt:Date.now(),
      plannedActivity:null,plannedDescription:null,confirmedEvents:[],
    });
    let complete!: (response: unknown) => void;
    const request=vi.fn().mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    vi.stubGlobal('fetch',request);
    const pending=runCharacterPhoneAutonomy(input('clear-bootstrap'));
    await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
    clearSelectedPhoneData('clear-bootstrap',['contacts']);
    complete({
      ok:true,status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
        contacts:[{name:'新同事',identity:'同事',relationship:'同事',personality:'寡言',
          origin:'introduced',evidence:'suggested'}],
      })}}]}),
    });
    expect(await pending).toBe('skipped');
    expect(readNpcProfiles('clear-bootstrap')).toEqual([]);
  });

  it('does not recreate an empty NPC inbox cleared while an autonomous request was running', async () => {
    saveNpcProfiles('clear-inbox',contacts());
    vi.mocked(getCharacterLifeScheduleContext).mockResolvedValue({
      characterId:'clear-inbox',observedAt:Date.now(),
      plannedActivity:null,plannedDescription:null,confirmedEvents:[],
    });
    let complete!: (response: unknown) => void;
    const request=vi.fn().mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    vi.stubGlobal('fetch',request);
    const pending=runCharacterPhoneAutonomy(input('clear-inbox'));
    await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
    // The original inbox is empty; row-count comparisons alone cannot detect this clear.
    clearSelectedPhoneData('clear-inbox',['chats']);
    complete({
      ok:true,status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
        send:true,messages:['过期的自动微信，不可保存'],
      })}}]}),
    });
    expect(await pending).toBe('skipped');
    expect(readCharacterPhoneChats('clear-inbox')).toEqual([]);
  });

});
