import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) } }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { getPending: vi.fn(async () => ({ notifications: [] })),
    cancel: vi.fn(async () => {}) },
}));
vi.mock('./db', () => ({ DB: { getScheduledMessagesByCharId: vi.fn(async () => []),
  deleteScheduledMessage: vi.fn(async () => {}) } }));
vi.mock('./realPersonMode', () => ({ isRealPersonModeEnabled: vi.fn(() => false) }));
vi.mock('./scheduleGenerator', () => ({ isScheduleFeatureOn: vi.fn(() => false) }));

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { DB } from './db';
import { isRealPersonModeEnabled } from './realPersonMode';
import { isScheduleFeatureOn } from './scheduleGenerator';
import { cancelDisabledLegacyAiMessages } from './legacyAiScheduledCleanup';
const character=(enabled=false)=>({id:'role',name:'阿一',activeMsg2Config:{enabled}} as any);
const rows=[
  {id:'legacy',charId:'role',content:'刚吃了生日蛋糕',createdAt:1,dueAt:999999},
  {id:'new',charId:'role',content:'我刚醒',notificationId:72,createdAt:1,dueAt:999999},
];
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(isRealPersonModeEnabled).mockReturnValue(false);
  vi.mocked(isScheduleFeatureOn).mockReturnValue(false);
  vi.mocked(DB.getScheduledMessagesByCharId).mockResolvedValue(rows as any);
  vi.mocked(LocalNotifications.getPending).mockResolvedValue({notifications:[]} as any);
  vi.mocked(LocalNotifications.cancel).mockResolvedValue(undefined as any);
  vi.mocked(DB.deleteScheduledMessage).mockResolvedValue(undefined as any);
});
describe('legacy AI scheduled notifications are not immune to OFF',()=>{
  it('withdraws stored rows and matching old/new native notifications, never unrelated reminders',async()=>{
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({notifications:[
      {id:14,title:'阿一',body:'刚吃了生日蛋糕'},
      {id:72,title:'阿一',body:'我刚醒'},
      {id:82,title:'日程',body:'我刚醒'},
      {id:93,title:'阿一',body:'医生预约'},
    ]} as any);
    expect(await cancelDisabledLegacyAiMessages(character())).toBe(2);
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications:[{id:14},{id:72}],
    });
    expect(vi.mocked(DB.deleteScheduledMessage).mock.calls.map(([id])=>id)).toEqual(['legacy','new']);
  });
  it('does not touch pending AI messages if any of the three permissions remains on',async()=>{
    vi.mocked(isRealPersonModeEnabled).mockReturnValue(true);
    expect(await cancelDisabledLegacyAiMessages(character())).toBe(0);
    vi.mocked(isRealPersonModeEnabled).mockReturnValue(false);
    vi.mocked(isScheduleFeatureOn).mockReturnValue(true);
    expect(await cancelDisabledLegacyAiMessages(character())).toBe(0);
    vi.mocked(isScheduleFeatureOn).mockReturnValue(false);
    expect(await cancelDisabledLegacyAiMessages(character(true))).toBe(0);
    expect(DB.getScheduledMessagesByCharId).not.toHaveBeenCalled();
  });
  it('failed native OS alarm cancellation retains rows so another opt-out retry can recover',async()=>{
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({notifications:[
      {id:72,title:'阿一',body:'我刚醒'},
    ]} as any);
    vi.mocked(LocalNotifications.cancel).mockRejectedValueOnce(new Error('native offline'));
    await expect(cancelDisabledLegacyAiMessages(character())).rejects.toThrow('native offline');
    expect(DB.deleteScheduledMessage).not.toHaveBeenCalled();
    await cancelDisabledLegacyAiMessages(character());
    expect(DB.deleteScheduledMessage).toHaveBeenCalledTimes(2);
  });
  it('web environments have no native scheduled alarms and simply withdraw old AI rows',async()=>{
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    expect(await cancelDisabledLegacyAiMessages(character())).toBe(2);
    expect(LocalNotifications.getPending).not.toHaveBeenCalled();
  });
});
