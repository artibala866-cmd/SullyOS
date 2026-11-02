import { describe, expect, it, vi, afterEach } from 'vitest';
import { ChatParser } from './chatParser';
import { DB } from './db';

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: { schedule: vi.fn() } }));
import { LocalNotifications } from '@capacitor/local-notifications';
const noop = () => {};
afterEach(() => { vi.restoreAllMocks(); });
describe('retired 1.0 tags from history or old workers', () => {
    it.each([
        '[schedule_message | 2099-01-01 08:00:00 | fixed | 起床]',
        '[schedule_message|invalid|fixed|旧任务]',
        '[SCHEDULE_MESSAGE | 2020-01-01 | fixed | 过期任务]',
    ])('strips %s without DB writes or OS alarms', async tag => {
        const put = vi.spyOn(IDBObjectStore.prototype, 'put');
        const schedule = vi.spyOn(LocalNotifications, 'schedule');
        expect(await ChatParser.parseAndExecuteActions(`好\n${tag}`, 'retired-role', '阿一', noop)).toBe('好');
        expect(put).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
        expect(await DB.getLegacyScheduledMessages()).toEqual([]);
    });
});

// 回归守卫：离线补收时一条消息会被拆成正文气泡 + 卡片/系统提示。正文走
// applyAssistantPostProcessing 的 persistMessage 盖上原始发送时刻，而 chatParser 这边
// 以前是一水儿的裸 DB.saveMessage，默认写库当刻——用户凌晨三点收到的那条消息，正文显示
// 凌晨三点、戳一戳和转账显示「早上九点打开 App 那一刻」，一条消息两个时间。
describe('parseAndExecuteActions 落库时间戳', () => {
    it('传了 messageTimestamp → 戳一戳 / 转账 / 日程系统提示全用同一个时刻', async () => {
        const charId = `c-ts-${Date.now()}`;
        const sentAt = Date.UTC(2026, 7, 2, 19, 0);   // 凌晨三点（东八区）发出

        await ChatParser.parseAndExecuteActions(
            '睡吧\n[[ACTION:POKE]]\n[[ACTION:TRANSFER:520]]\n[[ACTION:ADD_EVENT | 面试 | 2026-08-03]]',
            charId, '阿一', noop, undefined, undefined, sentAt,
        );

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const stamped = msgs.filter(m => m.type !== 'text' || m.role === 'system');
        expect(stamped.length).toBeGreaterThanOrEqual(3);
        for (const m of stamped) expect(m.timestamp).toBe(sentAt);
    }, 20000);

    it('不传 → 维持写库当刻（前台聊天那条路不变）', async () => {
        const charId = `c-ts-none-${Date.now()}`;
        const before = Date.now();
        await ChatParser.parseAndExecuteActions('[[ACTION:POKE]]', charId, '阿一', noop);

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        expect(msgs).toHaveLength(1);
        expect(msgs[0].timestamp).toBeGreaterThanOrEqual(before);
    }, 20000);
});
