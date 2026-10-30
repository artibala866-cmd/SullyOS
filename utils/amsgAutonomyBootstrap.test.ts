import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';

vi.mock('./amsgAutonomyWake', () => ({ ensureAutonomyWakes: vi.fn() }));
import { ensureAutonomyWakes } from './amsgAutonomyWake';
import { reconcileGlobalAutonomyWakes } from './amsgAutonomyBootstrap';

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
beforeEach(() => vi.mocked(ensureAutonomyWakes).mockReset().mockResolvedValue(undefined));
describe('OS-global AMSG2 opt-in bootstrap', () => {
  it('registers every enabled character with no manually created tasks, without opening Chat', async () => {
    const h = harness([character('a'), character('off', false), character('b')]);
    await reconcileGlobalAutonomyWakes(h.scope);
    expect(vi.mocked(ensureAutonomyWakes).mock.calls.map(([args]) => args.char.id))
      .toEqual(['a', 'b']);
    expect(vi.mocked(ensureAutonomyWakes).mock.calls.every(([args]) =>
      args.char.activeMsg2Config?.tasks?.length === 0)).toBe(true);
  });
  it('only rechecks the requested character after a schedule change', async () => {
    const h = harness();
    await reconcileGlobalAutonomyWakes(h.scope, 'bob');
    expect(vi.mocked(ensureAutonomyWakes).mock.calls.map(([a]) => a.char.id))
      .toEqual(['bob']);
  });
  it('rejects task writes made after a character disables 2.0, without touching other data', async () => {
    const h = harness();
    await reconcileGlobalAutonomyWakes(h.scope, 'alice');
    const captured = vi.mocked(ensureAutonomyWakes).mock.calls[0][0];
    h.setChars(h.getChars().map(c => c.id === 'alice'
      ? { ...c, activeMsg2Config: { enabled: false, tasks: [] } } : c));
    // Callback arrives after the user switched 2.0 off.
    captured.onSave(prev => ({ ...(prev || { enabled:true }), enabled:true,
      tasks: [{ taskUuid:'bad' }] as any }));
    expect(h.saves).toEqual([]);
    expect(h.getChars()[0].activeMsg2Config?.enabled).toBe(false);
  });
  it('ignores a delayed cloud result for a deleted character', async () => {
    const h = harness();
    await reconcileGlobalAutonomyWakes(h.scope, 'alice');
    const captured = vi.mocked(ensureAutonomyWakes).mock.calls[0][0];
    h.setChars(h.getChars().filter(c => c.id !== 'alice'));
    captured.onSave(prev => ({ ...(prev || { enabled:true }), tasks: [] }));
    expect(h.saves).toEqual([]);
  });
  it('does not run when the app is hidden/unmounted or no role opted in', async () => {
    const h = harness([character('off',false)]);
    await reconcileGlobalAutonomyWakes(h.scope);
    h.setChars([character('new')]); h.disable();
    await reconcileGlobalAutonomyWakes(h.scope);
    expect(ensureAutonomyWakes).not.toHaveBeenCalled();
  });
  it('a single bad role cannot stop a later opted-in role from reconciling', async () => {
    const h = harness();
    vi.mocked(ensureAutonomyWakes).mockRejectedValueOnce(new Error('remote unavailable'));
    await reconcileGlobalAutonomyWakes(h.scope);
    expect(vi.mocked(ensureAutonomyWakes).mock.calls.map(([a]) => a.char.id))
      .toEqual(['alice','bob']);
  });
});
