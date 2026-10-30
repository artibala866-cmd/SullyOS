// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_PHONE_CONTACT_CHANGED, addDiscoveredContact,
  readNpcProfiles, saveNpcProfiles, type NpcProfile,
} from './characterPhoneNpcs';

const charId='stage4-npc-contact-event';
const sample: NpcProfile = {
  id:'npc-one', name:'阿圆', identity:'同事', personality:'慢热',
  relationship:'朋友', background:'已保存的虚构联系人',
  source:'generated', createdAt:Date.parse('2026-10-30T06:00:00.000Z'),
};
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
describe('Stage4: contact edits invalidate the cloud phone snapshot',()=>{
  it('notifies the existing channel after a direct saved contact edit',()=>{
    const listener=vi.fn();
    window.addEventListener(CHARACTER_PHONE_CONTACT_CHANGED, listener);
    try {
      saveNpcProfiles(charId,[sample]);
      expect(listener).toHaveBeenCalledTimes(1);
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({characterId:charId});
      expect(readNpcProfiles(charId)[0].name).toBe('阿圆');

      saveNpcProfiles(charId,[{...sample,name:'阿园'}]);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(readNpcProfiles(charId)[0].name).toBe('阿园');

      saveNpcProfiles(charId,[]);
      expect(listener).toHaveBeenCalledTimes(3);
      expect(readNpcProfiles(charId)).toHaveLength(0);
    } finally {window.removeEventListener(CHARACTER_PHONE_CONTACT_CHANGED, listener);}
  });
  it('keeps the contactId metadata and does not double-notify discovered contacts',()=>{
    const listener=vi.fn();
    window.addEventListener(CHARACTER_PHONE_CONTACT_CHANGED,listener);
    try {
      expect(addDiscoveredContact(charId,sample).added).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect((listener.mock.calls[0][0] as CustomEvent).detail)
        .toEqual({characterId:charId,contactId:sample.id});
      expect(addDiscoveredContact(charId,sample).added).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {window.removeEventListener(CHARACTER_PHONE_CONTACT_CHANGED,listener);}
  });
  it('does not announce a contact mutation when local storage rejected the save',()=>{
    const listener=vi.fn();
    window.addEventListener(CHARACTER_PHONE_CONTACT_CHANGED,listener);
    const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
    try {
      expect(()=>saveNpcProfiles(charId,[sample])).toThrow('quota');
      expect(listener).not.toHaveBeenCalled();
    } finally {
      set.mockRestore();
      window.removeEventListener(CHARACTER_PHONE_CONTACT_CHANGED,listener);
    }
  });
});
