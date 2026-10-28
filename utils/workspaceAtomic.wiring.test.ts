import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const db=readFileSync(resolve(process.cwd(),'utils/db.ts'),'utf8');
const workspace=readFileSync(resolve(process.cwd(),'utils/sullyWorkspace.ts'),'utf8');
const reminder=readFileSync(resolve(process.cwd(),'apps/WorkspaceReminderControls.tsx'),'utf8');
const panel=readFileSync(resolve(process.cwd(),'apps/WorkspacePanel.tsx'),'utf8');
describe('跨标签页事务与 AMSG 手动核查真实接线',()=>{
 it('IndexedDB get 与 put 在同一个 assets readwrite 事务里',()=>{
  const start=db.indexOf('updateAssetRaw: async <T>');
  const end=db.indexOf('deleteAsset: async',start);
  expect(start).toBeGreaterThan(0);
  const body=db.slice(start,end);
  expect(body).toContain("db.transaction(STORE_ASSETS, 'readwrite')");
  expect(body).toContain('const req = store.get(id)');
  expect(body).toContain('updated = update(req.result?.data ?? null)');
  expect(body).toContain('store.put({id,data:updated})');
  expect(body).toContain('tx.oncomplete');
  const recoveryStart=db.indexOf('recoverAssetRawWithSnapshot: async <T>');
  const recoveryBody=db.slice(recoveryStart,db.indexOf('deleteAsset: async',recoveryStart));
  expect(recoveryBody).toContain("db.transaction(STORE_ASSETS,'readwrite')");
  expect(recoveryBody).toContain('store.put({id:snapshotId,data:raw})');
  expect(recoveryBody).toContain('store.put({id,data:updated})');
  expect(body).not.toContain('await update(');
 });
 it('学习室所有写操作用原子接口，不再读取后另起事务保存',()=>{
  expect(workspace).toContain('saved=await DB.updateAssetRaw(WORKSPACE_ASSET_ID,raw=>');
  expect(workspace).not.toContain('await DB.saveAssetRaw(WORKSPACE_ASSET_ID, saved)');
  expect(workspace).toContain('workspaceIntegrityWarnings(raw)');
 });
 it('损坏数据恢复等待旧保存结束，但旧失败不会锁死人工恢复',()=>{
  expect(panel).toContain('await queue.current.catch(()=>{})');
  expect(panel).toContain('const result=await recoverDamagedWorkspace(typed)');
  expect(panel).toContain('确认后备份原件并恢复可识别资料');
 });
 it('远端核查必须点击发起；无 UUID 的记录不会自动删除',()=>{
  expect(reminder).toContain('onClick={()=>void inspect(reminder.id)}');
  expect(reminder).toContain('inspections[reminder.id]');
  expect(reminder).toContain('reminder.taskUuid && <button');
 });
});
