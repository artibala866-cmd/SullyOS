import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { DB } from './db';

let inFlight: Promise<number> | undefined;

/** One-way compatibility cleanup. Never creates a task, calls an LLM, or changes
 * AMSG2 subscriptions. Keep failed alarm identities for the next resume/import. */
export function retireLegacyAiMessages(): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = retire().finally(() => { inFlight = undefined; });
  return inFlight;
}

async function retire(): Promise<number> {
  await DB.retireLegacyProactiveConfig();
  const rows = await DB.getLegacyScheduledMessages();
  if (!rows.length) return 0;
  if (!Capacitor.isNativePlatform()) {
    for (const row of rows) await DB.deleteScheduledMessage(row.id);
    return rows.length;
  }

  const { notifications } = await LocalNotifications.getPending();
  const names = new Map(await Promise.all([...new Set(rows.map(r => r.charId))].map(async id =>
    [id, (await DB.getCharacter(id))?.name] as const)));
  const ids = new Set<number>();
  const unresolved = new Set<string>();
  for (const row of rows) {
    for (const n of notifications) {
      if (n.body !== row.content) continue;
      if ((row.notificationId != null && n.id === row.notificationId)
        || (row.notificationId == null && names.get(row.charId) != null
          && n.title === names.get(row.charId))) ids.add(n.id);
      // Very old rows have no notification identity. A renamed/deleted role
      // cannot prove ownership: retain its row rather than cancel unrelated alarms.
      else if (row.notificationId == null && !ids.has(n.id)) unresolved.add(row.id);
    }
  }
  if (ids.size) await LocalNotifications.cancel({ notifications: [...ids].map(id => ({ id })) });
  for (const row of rows) {
    if (!unresolved.has(row.id)) await DB.deleteScheduledMessage(row.id);
  }
  if (unresolved.size) throw new Error(`仍有 ${unresolved.size} 条旧通知无法确认归属，已保留清理记录；旧消息发送已退役`);
  return rows.length;
}
