import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';

vi.mock('./activeMsgClient', () => ({
  ActiveMsgClient: {
    putCharLimits: vi.fn(async () => {}),
    listRemoteTasksForChar: vi.fn(async () => []),
    cancelTask: vi.fn(async () => ({uuid:'',alreadyGone:false})),
  },
}));
import { ActiveMsgClient } from './activeMsgClient';
import { AMSG_INSTANT_CHAT_SUBTYPE } from './amsgFirePack';
import { reconcileDisabledAmsgTasks, requestImmediateDisabledAmsgRepair } from './amsgDisabledRepair';

let chars: CharacterProfile[] = [];
let active = true;
const scope = {
  getCharacters: () => chars,
  isActive: () => active,
  saveCharacterConfig: (id: string, update: (prev: CharacterProfile['activeMsg2Config']) => NonNullable<CharacterProfile['activeMsg2Config']>) => {
    chars=chars.map(c=>c.id===id?{...c,activeMsg2Config:update(c.activeMsg2Config)}:c);
  },
};
const character = (id:string, enabled=false, tasks:string[]=[]):CharacterProfile => ({
  id, name:id, activeMsg2Config:{enabled,tasks:tasks.map(taskUuid=>({taskUuid,clientTaskId:'autowake:day'} as any))},
} as any);
beforeEach(()=>{
  vi.clearAllMocks();
  active=true;
  vi.mocked(ActiveMsgClient.putCharLimits).mockResolvedValue(undefined);
  vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockResolvedValue([]);
  vi.mocked(ActiveMsgClient.cancelTask).mockResolvedValue({uuid:'',alreadyGone:false});
});
describe('disabled AMSG cloud repair prevents old recurring API calls',()=>{
  it('syncs remote OFF first, cancels unknown orphaned tasks and preserves instant user-turn reply',async()=>{
    chars=[character('off-orphan',false,['old-local'])];
    vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockResolvedValue([
      {uuid:'cloud-old',messageSubtype:'prompted'},
      {uuid:'instant-running',messageSubtype:AMSG_INSTANT_CHAT_SUBTYPE},
    ] as any);
    await reconcileDisabledAmsgTasks(scope);
    expect(ActiveMsgClient.putCharLimits).toHaveBeenCalledWith(expect.objectContaining({
      id:'off-orphan',activeMsg2Config:expect.objectContaining({enabled:false}),
    }));
    const calls=vi.mocked(ActiveMsgClient.cancelTask).mock.calls.map(([uuid])=>uuid);
    expect(calls).toContain('cloud-old');
    expect(calls).toContain('old-local');
    expect(calls).not.toContain('instant-running');
    expect(chars[0].activeMsg2Config?.tasks).toHaveLength(0);
  });
  it('does not call cloud or delete tasks for enabled roles or unconfigured characters',async()=>{
    chars=[character('still-on',true,['user-task']),{id:'unset'} as CharacterProfile];
    await reconcileDisabledAmsgTasks(scope);
    expect(ActiveMsgClient.putCharLimits).not.toHaveBeenCalled();
    expect(ActiveMsgClient.cancelTask).not.toHaveBeenCalled();
  });
  it('cloud offline never claims success; retains local task and permits an explicit retry',async()=>{
    chars=[character('off-failing',false,['old-recurring'])];
    vi.mocked(ActiveMsgClient.putCharLimits).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockRejectedValueOnce(new Error('offline'));
    await reconcileDisabledAmsgTasks(scope);
    expect(chars[0].activeMsg2Config?.lastError).toContain('尚未同步成功');
    expect(chars[0].activeMsg2Config?.tasks).toHaveLength(1);
    requestImmediateDisabledAmsgRepair('off-failing');
    await reconcileDisabledAmsgTasks(scope);
    expect(ActiveMsgClient.putCharLimits).toHaveBeenCalledTimes(2);
    expect(chars[0].activeMsg2Config?.tasks).toHaveLength(0);
    expect(chars[0].activeMsg2Config?.lastError).toBeUndefined();
  });
  it('does not cancel remote tasks if role was re-enabled during permission sync',async()=>{
    chars=[character('off-race',false,['old-recurring'])];
    vi.mocked(ActiveMsgClient.putCharLimits).mockImplementationOnce(async()=>{
      chars=[character('off-race',true,['old-recurring'])];
    });
    await reconcileDisabledAmsgTasks(scope);
    expect(ActiveMsgClient.listRemoteTasksForChar).not.toHaveBeenCalled();
    expect(ActiveMsgClient.cancelTask).not.toHaveBeenCalled();
    expect(chars[0].activeMsg2Config?.enabled).toBe(true);
  });
});
