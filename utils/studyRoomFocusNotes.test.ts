import {describe,expect,it} from 'vitest';
import {legacyUnattributedStudyNotes,notesForStudyChar} from './studyRoomFocusNotes';

describe('学习室 Char 对话隔离及旧记录迁移',()=>{
 const notes=[
  {id:'1',role:'user' as const,content:'只给角色 A 的委托详情',charId:'A'},
  {id:'2',role:'assistant' as const,content:'A 的答复',charId:'A'},
  {id:'3',role:'user' as const,content:'B 的私人作业',charId:'B'},
  {id:'4',role:'user' as const,content:'以前没有角色归属的敏感笔记'},
 ];
 it('切换 Char 后，其他 Char 的聊天不进入本轮请求',()=>{
  expect(notesForStudyChar(notes,'A').map(n=>n.id)).toEqual(['1','2']);
  expect(JSON.stringify(notesForStudyChar(notes,'B'))).not.toContain('角色 A');
  expect(notesForStudyChar(notes,'').length).toBe(0);
 });
 it('旧未绑定 Char 的记录本机可看但绝不传给任一 Char',()=>{
  expect(legacyUnattributedStudyNotes(notes).map(n=>n.id)).toEqual(['4']);
  expect(JSON.stringify(notesForStudyChar(notes,'A'))).not.toContain('敏感笔记');
  expect(JSON.stringify(notesForStudyChar(notes,'B'))).not.toContain('敏感笔记');
 });
});
