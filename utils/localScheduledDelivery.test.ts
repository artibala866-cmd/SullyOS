import { describe, expect, it } from 'vitest';
import { shouldSuppressLocalScheduledDelivery } from './localScheduledDelivery';

describe('本地旧 schedule_message 的关闭闸', () => {
  it('明确关闭日程、主动消息 1.0 和 2.0 时不再投递遗留定时消息', () => {
    expect(shouldSuppressLocalScheduledDelivery({
      scheduleFeatureEnabled: false,
      proactiveConfig: { enabled: false, intervalMinutes: 60 },
      activeMsg2Config: { enabled: false, tasks: [] },
    })).toBe(true);
  });

  it('只关闭日程不误杀仍开启的主动消息', () => {
    expect(shouldSuppressLocalScheduledDelivery({
      scheduleFeatureEnabled: false,
      proactiveConfig: { enabled: true, intervalMinutes: 60 },
    })).toBe(false);
    expect(shouldSuppressLocalScheduledDelivery({
      scheduleFeatureEnabled: false,
      activeMsg2Config: { enabled: true, tasks: [] },
    })).toBe(false);
  });

  it('没有显式关闭日程的旧角色仍按原行为投递', () => {
    expect(shouldSuppressLocalScheduledDelivery({})).toBe(false);
    expect(shouldSuppressLocalScheduledDelivery({ scheduleFeatureEnabled: true })).toBe(false);
  });
});
