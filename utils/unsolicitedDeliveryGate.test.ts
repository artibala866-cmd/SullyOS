import { describe, expect, it } from 'vitest';
import { allowCloudAmsgDelivery, allowLegacyAiScheduledDelivery } from './unsolicitedDeliveryGate';

describe('closing proactive modes really stops unsolicited delivery', () => {
  it('old [schedule_message] AI text cannot reappear when all three switches are off', () => {
    expect(allowLegacyAiScheduledDelivery({
      activeMsg2Enabled:false, realPersonEnabled:false, scheduleEnabled:false,
    })).toBe(false);
  });
  it('one still-authorized initiative mode does not silently disable unrelated old behavior', () => {
    for(const key of ['activeMsg2Enabled','realPersonEnabled','scheduleEnabled'] as const) {
      const flags={activeMsg2Enabled:false,realPersonEnabled:false,scheduleEnabled:false};
      flags[key]=true;
      expect(allowLegacyAiScheduledDelivery(flags)).toBe(true);
    }
  });
  it('late cloud scheduled push and outbox backfill are dropped after master OFF', () => {
    expect(allowCloudAmsgDelivery({source:'scheduled'},false)).toBe(false);
    expect(allowCloudAmsgDelivery({source:'scheduled',messageSubtype:'prompted'},true)).toBe(true);
  });
  it('ordinary replies, app actions, and other background records are not blocked', () => {
    for(const source of ['instant','user','background',undefined]) {
      expect(allowCloudAmsgDelivery({source},false)).toBe(true);
    }
  });
});
