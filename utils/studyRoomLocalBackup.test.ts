import {describe,it,expect} from 'vitest';
import {exportStudyRoomLocal,restoreStudyRoomLocal} from './studyRoomLocalBackup';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const makeStore=()=>{
  const m=new Map<string,string>();
  return {m,getItem:(key:string)=>m.get(key)??null,
    setItem:(key:string,value:string)=>{m.set(key,value);},
    removeItem:(key:string)=>{m.delete(key);}};
};
describe('学习室历史计时/Char 设置随正式备份保存而不重置其他资料',()=>{
  it('已结算专注能够连同旧 task/record 和 Char 状态一起往返',()=>{
    const old=makeStore();
    old.setItem('sully_pomodoro_v1_tasks','[{"id":"linked"}]');
    old.setItem('sully_pomodoro_v1_records','[{"taskId":"linked","sessionId":"s1","minutes":25}]');
    old.setItem('sully_pomodoro_v1_coachByChar','{"char":{"level":"gentle"}}');
    old.setItem('sully_pomodoro_v1_session','{"deadline":1}');
    const backup=exportStudyRoomLocal(old);
    const next=makeStore();
    expect(restoreStudyRoomLocal(backup,next)).toBe(true);
    expect(next.getItem('sully_pomodoro_v1_records')).toContain('"s1"');
    expect(next.getItem('sully_pomodoro_v1_tasks')).toContain('linked');
    expect(next.getItem('sully_pomodoro_v1_coachByChar')).toContain('gentle');
    expect(next.getItem('sully_pomodoro_v1_session')).toBeNull(); // no timer from other device
  });
  it('坏记录或额外键一律拒绝导入且不写任何已有本机字段',()=>{
    const existing=makeStore();existing.setItem('sully_pomodoro_v1_records','["keep"]');
    expect(restoreStudyRoomLocal({records:'{invalid'},existing)).toBe(false);
    expect(restoreStudyRoomLocal({records:'[]',privateChatPermission:'true'},existing)).toBe(false);
    expect(existing.getItem('sully_pomodoro_v1_records')).toBe('["keep"]');
    expect(restoreStudyRoomLocal(undefined,existing)).toBe(false);
  });
  it('空项明确删除，旧版备份缺字段不移除新设备资料',()=>{
    const previous=makeStore();previous.setItem('sully_pomodoro_v1_notes','["old"]');
    expect(restoreStudyRoomLocal({notes:null},previous)).toBe(true);
    expect(previous.getItem('sully_pomodoro_v1_notes')).toBeNull();
  });
  it('原完整备份导出/导入均接入，且不透传私聊 prompt 或角色配置',()=>{
    const code=readFileSync(resolve(process.cwd(),'context/OSContext.tsx'),'utf8');
    expect(code).toContain('studyRoomLocal: (mode');
    expect(code).toContain('exportStudyRoomLocal()');
    expect(code).toContain('restoreStudyRoomLocal(data.studyRoomLocal,localStorage)');
    expect(code).not.toContain('characterResponsePrinciples.ts');
  });
});