import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { CharacterProfile } from '../types';
import { DB } from './db';
import { isScheduleFeatureOn } from './scheduleGenerator';
import { isRealPersonModeEnabled } from './realPersonMode';
import { allowLegacyAiScheduledDelivery } from './unsolicitedDeliveryGate';

export async function cancelDisabledLegacyAiMessages(char: CharacterProfile): Promise<number> {
  if (allowLegacyAiScheduledDelivery({
    activeMsg2Enabled: char.activeMsg2Config?.enabled === true,
    realPersonEnabled: isRealPersonModeEnabled(),
    scheduleEnabled: isScheduleFeatureOn(char),
  })) return 0;
  const rows = await DB.getScheduledMessagesByCharId(char.id);
  if (!rows.length) return 0;
  if (Capacitor.isNativePlatform()) {
    const pending = await LocalNotifications.getPending();
    const matched = pending.notifications.filter(n => n.title === char.name && rows.some(row =>
      n.body === row.content && (row.notificationId == null || row.notificationId === n.id)));
    if (matched.length) await LocalNotifications.cancel({ notifications: matched.map(n => ({id:n.id})) });
  }
  for (const row of rows) await DB.deleteScheduledMessage(row.id);
  return rows.length;
}
