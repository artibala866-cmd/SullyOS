import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';

vi.mock('./amsgAutonomyWake', () => ({ retireAutonomyWakes: vi.fn() }));
import { retireAutonomyWakes } from './amsgAutonomyWake';
import { reconcileGlobalAutonomyWakes, autonomyReconciliationKey } from './amsgAutonomyBootstrap';

const character = (id: string, enabled = true) =>
  ({ id, activeMsg2Config: { enabled, tasks: [] } }) as unknown as CharacterProfile;
function harness(initial = [character('alice'), character('bob')]) {
  let chars = initial;
  let active = true;
  const saves: string[] = [];
  const scope = {
    getCharacters: () => chars,
    getUserProfile: () => ({ name: 'user' } as any),
    getApiConfig: () => ({ baseUrl: 'https://api.invalid', apiKey: 'key', model: 'model' } as any),
    getGroups: () => [],
    getRealtimeConfig: () => ({} as any),
    isActive: () => active,
    saveCharacterConfig: (id: string, update: (prev: any) => any) => {
      saves.push(id);
      chars = chars.map(c => c.id === id
        ? { ...c, activeMsg2Config: update(c.activeMsg2Config) } : c);
    },
  };
  return { scope, saves, getChars: () => chars, setChars: (next: CharacterProfile[]) => { chars = next; },
    disable: () => { active = false; } };
}
beforeEach(() => vi.mocked(retireAutonomyWakes).mockReset().mockResolvedValue(undefined));
describe('OS-global retired task reconciliation', () => {
  it('audits every enabled character with no manually created tasks, without opening Chat', async () => {
    const h = harness([character('a'), character('off', false), character('b')]);
    await reconcileGlobalAutonomyWakes(h.scope);
    expect(vi.mocked(retireAutonomyWakes).mock.calls.map(([args]) => args.id))
      .toEqual(['a', 'b']);
    expect(vi.mocked(retireAutonomyWakes).mock.calls.every(([args]) =>
      args.activeMsg2Config?.tasks?.length === 0)).toBe(true);
  });
  it('only rechecks the requested character when a role is targeted', async () => {
    const h = harness();
    await reconcileGlobalAutonomyWakes(h.scope, 'bob');
    expect(vi.mocked(retireAutonomyWakes).mock.calls.map(([a]) => a.id))
      .toEqual(['bob']);
  });
  it('rejects task writes made after a character disables 2.0, without touching other data', async () => {
    const h = harness();
    await reconcileGlobalAutonomyWakes(h.scope, 'alice');
    const captured = vi.mocked(retireAutonomyWakes).mock.calls[0][1];
    h.setChars(h.getChars().map(c => c.id === 'alice'
      ? { ...c, activeMsg2Config: { enabled: false, tasks: [] } } : c));
    // Callback arrives after the user switched 2.0 off.
    captured(prev => ({ ...(prev || { enabled:true }), enabled:true,
      tasks: [{ taskUuid:'bad' }] as any }));
    expect(h.saves).toEqual([]);
    expect(h.getChars()[0].activeMsg2Config?.enabled).toBe(false);
  });
  it('ignores a delayed cloud result for a deleted character', async () => {
    const h = harness();
    await reconcileGlobalAutonomyWakes(h.scope, 'alice');
    const captured = vi.mocked(retireAutonomyWakes).mock.calls[0][1];
    h.setChars(h.getChars().filter(c => c.id !== 'alice'));
    captured(prev => ({ ...(prev || { enabled:true }), tasks: [] }));
    expect(h.saves).toEqual([]);
  });
  it('closing the OS during a cloud request does NOT revoke an enabled task', async () => {
    const h = harness();
    await reconcileGlobalAutonomyWakes(h.scope, 'alice');
    const captured = vi.mocked(retireAutonomyWakes).mock.calls[0][1];
    h.disable(); // provider unmounted, role has NOT switched 2.0 off
    captured(prev => ({ ...(prev || { enabled:true }), tasks: [{taskUuid:'cloud'}] as any }));
    // The Worker keeps its task; next launch adopts remote identity; no
    // detached React state write from an unmounted provider.
    expect(h.saves).toEqual([]);
  });
  it('does not run when the app is hidden/unmounted or no role opted in', async () => {
    const h = harness([character('off',false)]);
    await reconcileGlobalAutonomyWakes(h.scope);
    h.setChars([character('new')]); h.disable();
    await reconcileGlobalAutonomyWakes(h.scope);
    expect(retireAutonomyWakes).not.toHaveBeenCalled();
  });
  it('a single bad role cannot stop a later opted-in role from reconciling', async () => {
    const h = harness();
    vi.mocked(retireAutonomyWakes).mockRejectedValueOnce(new Error('remote unavailable'));
    await reconcileGlobalAutonomyWakes(h.scope);
    expect(vi.mocked(retireAutonomyWakes).mock.calls.map(([a]) => a.id))
      .toEqual(['alice','bob']);
  });
});

describe('single OS reconciliation owner', () => {
  const now = Date.UTC(2026, 10, 2, 12);
  const task = (clientTaskId: string, status = 'scheduled') => ({
    clientTaskId, taskUuid: clientTaskId, status, recurrenceType: 'none',
    firstSendTime: new Date(now + 3_600_000).toISOString(),
  } as any);
  it('autonomous task saves do not rearm their own runner', () => {
    const c = character('a');
    const before = autonomyReconciliationKey([c], now);
    c.activeMsg2Config!.tasks = [task('autowake:a:day'), task('autowake:a:evening')];
    expect(autonomyReconciliationKey([c], now)).toBe(before);
    c.activeMsg2Config!.lastError = 'temporary network error';
    expect(autonomyReconciliationKey([c], now)).toBe(before);
  });
  it('freeing a manual task slot still prompts reconciliation with Chat closed', () => {
    const c = character('a');
    c.activeMsg2Config!.tasks = [task('manual'), task('autowake:a:day')];
    const full = autonomyReconciliationKey([c], now);
    c.activeMsg2Config!.tasks = [task('manual', 'cancelled'), task('autowake:a:day')];
    expect(autonomyReconciliationKey([c], now)).not.toBe(full);
  });
  it('limits, explicit opt-out and character timezone remain live inputs', () => {
    const original = character('a');
    const before = autonomyReconciliationKey([original], now);
    for (const next of [
      {...original, activeMsg2Config: {...original.activeMsg2Config!, maxActiveTasks: 7}},
      {...original, activeMsg2Config: {...original.activeMsg2Config!, enabled: false}},
      {...original, customTimezoneEnabled: true, customTimezone: 'Asia/Shanghai'},
    ]) expect(autonomyReconciliationKey([next], now)).not.toBe(before);
  });
  it('legacy malformed task metadata cannot crash the OS render', () => {
    const c = character('a');
    const empty = autonomyReconciliationKey([c], now);
    c.activeMsg2Config!.tasks = { length: 99 } as any;
    expect(autonomyReconciliationKey([c], now)).toBe(empty);
    c.activeMsg2Config!.tasks = [null, {...task('manual'), clientTaskId: 123}] as any;
    expect(() => autonomyReconciliationKey([c], now)).not.toThrow();
    expect(autonomyReconciliationKey([{...c, activeMsg2Config: null} as any], now)).toBe('');
  });
  it('render order and an unconfigured character do not create a reconciliation loop', () => {
    const a = character('a'), b = character('b');
    expect(autonomyReconciliationKey([a,b], now)).toBe(autonomyReconciliationKey([b,a], now));
    expect(autonomyReconciliationKey([a,{id:'unconfigured'} as any], now))
      .toBe(autonomyReconciliationKey([a], now));
  });
});
