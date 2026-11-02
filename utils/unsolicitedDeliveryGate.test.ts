import { describe, expect, it } from 'vitest';
import { allowCloudAmsgDelivery } from './unsolicitedDeliveryGate';

describe('closing proactive modes really stops unsolicited delivery', () => {
  it('late cloud scheduled push and outbox backfill are dropped after master OFF', () => {
    expect(allowCloudAmsgDelivery({source:'scheduled'},false)).toBe(false);
    expect(allowCloudAmsgDelivery({source:'scheduled',messageSubtype:'prompted'},true)).toBe(true);
  });
  it('older sourceless cloud schedule pushes still obey disabled 2.0, not user replies', () => {
    expect(allowCloudAmsgDelivery({taskUuid:'old',messageType:'auto'},false)).toBe(false);
    expect(allowCloudAmsgDelivery({taskUuid:'old',messageType:'prompted'},false)).toBe(false);
    expect(allowCloudAmsgDelivery({taskUuid:'instant',messageType:'auto',messageSubtype:'instant-chat'},false)).toBe(true);
    expect(allowCloudAmsgDelivery({taskUuid:'background',messageType:'auto',messageSubtype:'job'},false)).toBe(true);
  });

  it('ordinary replies, app actions, and other background records are not blocked', () => {
    for(const source of ['instant','user','background',undefined]) {
      expect(allowCloudAmsgDelivery({source},false)).toBe(true);
    }
  });
});
