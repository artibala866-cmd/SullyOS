import {describe,expect,it} from 'vitest';
import {legacyUnattributedStudyNotes,legacyUnscopedStudyNotes,notesForStudyChar,notesForStudyContext} from './studyRoomFocusNotes';

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
 it('同 Char 的画稿、作业、专注、排单以及不同作业不能串用历史',()=>{
  const tagged=[
    {id:'focus',role:'user' as const,charId:'A',scope:'focus' as const,content:'专注任务'},
    {id:'commission',role:'user' as const,charId:'A',scope:'commission' as const,topicId:'c1',content:'秘密客户画稿'},
    {id:'homework1',role:'assistant' as const,charId:'A',scope:'study' as const,topicId:'h1',content:'作业一复盘'},
    {id:'homework2',role:'user' as const,charId:'A',scope:'study' as const,topicId:'h2',content:'作业二笔记'},
    {id:'plan',role:'user' as const,charId:'A',scope:'plan' as const,content:'整份排单'},
    {id:'wrongChar',role:'user' as const,charId:'B',scope:'study' as const,topicId:'h1',content:'角色 B'},
    ...notes,
  ];
  expect(notesForStudyContext(tagged,'A','study','h1').map(n=>n.id)).toEqual(['homework1']);
  expect(notesForStudyContext(tagged,'A','study','h2').map(n=>n.id)).toEqual(['homework2']);
  expect(notesForStudyContext(tagged,'A','commission','c1').map(n=>n.id)).toEqual(['commission']);
  expect(notesForStudyContext(tagged,'A','plan').map(n=>n.id)).toEqual(['plan']);
  expect(notesForStudyContext(tagged,'A','focus').map(n=>n.id)).toEqual(['focus']);
  expect(notesForStudyContext(tagged,'B','study','h1').map(n=>n.id)).toEqual(['wrongChar']);
  expect(legacyUnscopedStudyNotes(tagged,'A').map(n=>n.id)).toEqual(['1','2']);
  expect(notesForStudyContext(tagged,'A','study','h1').map(n=>n.content).join('|'))
    .not.toContain('秘密客户');
 });
});
