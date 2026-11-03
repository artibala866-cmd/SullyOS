import { beforeEach, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { retireAutonomyWakes } from './amsgAutonomyWake';
import { isRetiredAutonomyDelivery } from './amsgRetiredAutonomy';
import { isReplyStopped } from './chatReplyCancellation';

vi.mock('./activeMsgClient', () => ({
  ActiveMsgClient: {
    putCharLimits: vi.fn(),
    listRemoteTasksForChar: vi.fn(),
    cancelTask: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockResolvedValue([]);
});

const makeChar = (id: string) => ({
  id, activeMsg2Config: { enabled: true, tasks: [
    { taskUuid: id + '-old', clientTaskId: 'autowake:day:old' },
    { taskUuid: id + '-manual', clientTaskId: 'manual-reminder' },
  ] },
}) as CharacterProfile;

it('stops cloud generation before cancelling only identified local and remote daily jobs', async () => {
  const char = makeChar('retire');
  vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockResolvedValue([
    { uuid: 'remote-autowake', clientTaskId: 'autowake:evening:other-device' },
    { uuid: 'remote-manual', clientTaskId: 'manual' },
  ] as any);
  let config = char.activeMsg2Config!;
  await retireAutonomyWakes(char, update => { config = update(config); });
  expect(vi.mocked(ActiveMsgClient.putCharLimits).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(ActiveMsgClient.cancelTask).mock.invocationCallOrder[0]);
  expect(vi.mocked(ActiveMsgClient.cancelTask).mock.calls).toEqual([['retire-old'], ['remote-autowake']]);
  expect(config.tasks?.map(task => task.taskUuid)).toEqual(['retire-manual']);
  expect(config.enabled).toBe(true);
  expect(isReplyStopped('remote-autowake')).toBe(true);
  expect(isReplyStopped('remote-manual')).toBe(false);
});

it('cancels known IDs even when cloud inventory fails and retains failed cancellations for repair', async () => {
  const char = makeChar('network');
  vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockRejectedValue(new Error('offline'));
  vi.mocked(ActiveMsgClient.cancelTask).mockRejectedValue(new Error('offline'));
  let config = char.activeMsg2Config!;
  await retireAutonomyWakes(char, update => { config = update(config); });
  expect(ActiveMsgClient.cancelTask).toHaveBeenCalledWith('network-old');
  expect(isReplyStopped('network-old')).toBe(true);
  expect(config.tasks).toHaveLength(2);
  expect(config.lastError).toContain('待确认清理');
});

it('identifies retired deliveries without blocking normal reminders and instant replies', () => {
  expect(isRetiredAutonomyDelivery({ amsgAutonomyWake: true })).toBe(true);
  expect(isRetiredAutonomyDelivery({ amsgClientTaskId: 'autowake:evening:old' })).toBe(true);
  expect(isRetiredAutonomyDelivery({ amsgClientTaskId: 'reminder', amsgInstantChat: true })).toBe(false);
});
