// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readNpcProfiles, saveNpcProfiles } from './characterPhoneNpcs';
import { readPendingContacts } from './characterPhoneRequests';
import { registerDiscoveredNpc } from './characterNpcNetwork';
import {
  readCharacterPhoneChats, appendCharacterPhoneMessages,
  CHARACTER_PHONE_CHATS_CHANGED,
} from './characterPhoneChats';
import { readCharacterMoments, publishCharacterMoment, addMomentComment } from './characterPhoneMoments';
import { runCharacterMomentInteractionAutonomy } from './characterMomentInteractionAutonomy';
import type { CharacterProfile } from '../types';

vi.mock('./characterPhoneAutonomy', () => ({
  isCharacterPhoneAutonomyEnabled: () => true,
}));

let serial = 0;
beforeEach(() => {
  localStorage.clear();
  serial = 0;
  vi.stubGlobal('crypto', { randomUUID: () => 'uuid-' + (++serial) });
});
afterEach(() => vi.unstubAllGlobals());

describe('character phone social identity and inbox', () => {
  it('adds an established acquaintance only once, retaining the canonical identity', () => {
    const input = {
      name: '小宋', identity: '同事', personality: '嘴贫但可靠',
      relationship: '同事', background: '同办公室', origin: 'known' as const,
      evidence: 'character' as const, speechStyle: '一句一回',
    };
    const added = registerDiscoveredNpc('owner', input);
    expect(added.status).toBe('added');
    const again = registerDiscoveredNpc('owner', { ...input, origin: 'introduced' });
    expect(again.status).toBe('existing');
    expect(readNpcProfiles('owner')).toHaveLength(1);
    expect(readNpcProfiles('owner')[0].speechStyle).toBe('一句一回');
  });

  it('queues an unestablished stranger without requiring a legal name', () => {
    const result = registerDiscoveredNpc('owner', {
      name: '咖啡馆路人', identity: '顾客', relationship: '偶遇',
      origin: 'stranger', realName: '', background: '刚认识',
    });
    expect(result.status).toBe('pending');
    expect(readNpcProfiles('owner')).toHaveLength(0);
    expect(readPendingContacts('owner')).toHaveLength(1);
    expect(readPendingContacts('owner')[0].realName).toBe('');
  });

  it('persists one actor per phone window, de-dups retries, broadcasts only after saving', () => {
    let notices = 0;
    const onChange = () => { notices++; };
    window.addEventListener(CHARACTER_PHONE_CHATS_CHANGED, onChange);
    try {
      const first = appendCharacterPhoneMessages({
        characterId: 'owner', contactId: 'friend',
        contactName: '朋友', messages: [{ speaker: { role: 'contact', contactId: 'friend' }, text: '在吗？' }],
      });
      expect(first?.added).toHaveLength(1);
      const retry = appendCharacterPhoneMessages({
        characterId: 'owner', contactId: 'friend',
        contactName: '朋友', messages: [{ speaker: { role: 'contact', contactId: 'friend' }, text: '在吗？' }],
      });
      expect(retry).toBeNull();
      appendCharacterPhoneMessages({
        characterId: 'owner', contactId: 'friend',
        contactName: '朋友', messages: [{ speaker: { role: 'owner' }, text: '刚下课' }],
      });
      const chats = readCharacterPhoneChats('owner');
      expect(chats).toHaveLength(1);
      expect(chats[0].messages.map(m => m.speaker.role)).toEqual(['contact', 'owner']);
      expect(readCharacterPhoneChats('someone-else')).toHaveLength(0);
      expect(notices).toBeGreaterThanOrEqual(2);
    } finally { window.removeEventListener(CHARACTER_PHONE_CHATS_CHANGED, onChange); }
  });
});

describe('real Moments comment threads', () => {
  const char = { id: 'char', name: '阿禾', systemPrompt: '说话有点嘴硬' } as CharacterProfile;
  const api = { baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'test' };
  const profile = {
    id: 'npc', name: '阿诚', identity: '室友', personality: '爱开玩笑',
    relationship: '室友', background: '同住', source: 'generated' as const, createdAt: 1,
  };
  it('lets Char reply to a real NPC comment on their own post', async () => {
    saveNpcProfiles('char', [profile]);
    const post = publishCharacterMoment({
      characterId: 'char', origin: 'char', text: '今天太累了',
      imageUrls: [], visibility: 'all',
    });
    expect(post).toBeTruthy();
    addMomentComment('char', post!.id, { id: 'prior', authorId: 'npc', text: '又加班了？', createdAt: Date.now() });
    const response = {
      choices: [{ message: { content: JSON.stringify({
        actions: [{ actorId: 'char', type: 'comment', text: '是啊', replyToId: 'prior' }],
      }) } }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(response),
    }));
    expect(await runCharacterMomentInteractionAutonomy({ char, api })).toBe('acted');
    const comments = readCharacterMoments('char')[0].comments || [];
    expect(comments).toHaveLength(2);
    expect(comments[1]).toMatchObject({ authorId: 'char', replyToId: 'prior', text: '是啊' });
  });
});
