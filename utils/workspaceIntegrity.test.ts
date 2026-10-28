import {describe,expect,it,vi} from 'vitest';
import {
  emptyWorkspace,normalizeWorkspace,workspaceIntegrityWarnings,
  readWorkspace,readWorkspaceIntegrityWarnings,mutateWorkspace,writeWorkspace,
} from './sullyWorkspace';
let stored:unknown=null;
vi.mock('./db',()=>({
  DB:{
    getAssetRaw:vi.fn(async()=>stored),
    updateAssetRaw:vi.fn(async(_key:string,update:(raw:unknown)=>unknown)=>{
      const updated=update(stored);
      stored=structuredClone(updated);
      return updated;
    }),
  },
}));
describe('导入受损备份：可查看正常数据，但不能默默销毁原件',()=>{
 it('缺 ID、重复 ID、非数组、null 行可安全渲染且给出定位提示',()=>{
  const raw={
    classes:[null,{id:'a',name:'画画',weekday:2,start:'09:00',end:'11:00'},
      {id:'a',name:'重复课程'},'bad'],
    homework:[{id:'h',classId:'a',title:'练习',dueAt:''}],
    reminders:{fake:'not array'},
  };
  const warnings=workspaceIntegrityWarnings(raw);
  expect(warnings.join(' ')).toContain('重复');
  expect(warnings.join(' ')).toContain('reminders不是数组');
  const view=normalizeWorkspace(raw);
  expect(view.classes).toHaveLength(1);
  expect(view.classes[0]).toMatchObject({id:'a',name:'画画',teacher:'',note:''});
  expect(view.homework[0].done).toBe(false);
  expect(view.reminders).toEqual([]);
 });
 it('只要原数据有损坏，原子修改必须失败且原文原封不动保留',async()=>{
  stored={classes:[{id:'good',name:'课程',start:'09:00',end:'10:00'},
    {id:'good',name:'原始重复记录',start:'10:00',end:'11:00'}]};
  const original=JSON.stringify(stored);
  expect((await readWorkspace()).classes).toHaveLength(1);
  expect((await readWorkspaceIntegrityWarnings()).length).toBeGreaterThan(0);
  await expect(mutateWorkspace(w=>({...w,dailyAvailableMinutes:500})))
    .rejects.toThrow('拒绝自动覆盖');
  await expect(writeWorkspace(emptyWorkspace())).rejects.toThrow('拒绝覆盖');
  expect(JSON.stringify(stored)).toBe(original);
 });
 it('健康旧备份即使缺新增表也可安全更新；私聊授权缺失仍默认关',async()=>{
  stored={classes:[{id:'lesson',name:'课',start:'09:00',end:'10:00',weekday:2}],
    dailyAvailableMinutes:110};
  expect(await readWorkspaceIntegrityWarnings()).toEqual([]);
  const next=await mutateWorkspace(w=>({...w,dailyAvailableMinutes:180}));
  expect(next.dailyAvailableMinutes).toBe(180);
  expect(next.privateChatPermissions).toEqual({});
  expect((await readWorkspace()).classes[0].id).toBe('lesson');
 });
});
