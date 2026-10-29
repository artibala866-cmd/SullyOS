import {describe,it,expect} from 'vitest';
import type {Commission} from './sullyWorkspace';
import {commissionFormPatch} from '../apps/StudyCommissionEditor';
const commission:Commission={
 id:'first',title:'头像',client:'客户姓名保密',type:'立绘',brief:'原始需求',
 acceptedAt:'2026-10-01',dueDate:'2026-11-10',stage:'草稿',priority:1,status:'active',
 remainingMinutes:120,bufferMinutes:20,plannedDate:'',price:'200',paid:false,
 note:'个人备注',order:1,
};
describe('委托编辑：本地表单按保存才提交更改',()=>{
 it('只写用户真正修改过的字段，原客户价格与交期保持不变',()=>{
  const patch=commissionFormPatch(commission,{...commission,stage:'线稿',remainingMinutes:80});
  expect(patch).toEqual({stage:'线稿',remainingMinutes:80});
  expect(patch).not.toHaveProperty('client');
  expect(patch).not.toHaveProperty('price');
  expect(patch).not.toHaveProperty('dueDate');
  expect(patch).not.toHaveProperty('status');
  expect(commission.stage).toBe('草稿');
 });
 it('无修改不写入，一次可保存名称、状态与其他字段',()=>{
  expect(commissionFormPatch(commission,commission)).toEqual({});
  expect(commissionFormPatch(commission,{...commission,title:'新稿名',status:'waiting'}))
    .toEqual({title:'新稿名',status:'waiting'});
 });
});
