import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const schedule=readFileSync(resolve(process.cwd(),'apps/ScheduleApp.tsx'),'utf8');
const panel=readFileSync(resolve(process.cwd(),'apps/WorkspacePanel.tsx'),'utf8');
const logic=readFileSync(resolve(process.cwd(),'utils/studyRoomFocusNotes.ts'),'utf8');
describe('学习室 Char 的角色 API、来源隔离与人工复盘真实接线',()=>{
 it('每次发给 Char 的专注对话走其独立 API，完整配置不拼接全局 Key',()=>{
  expect(schedule).toContain('resolveDialogueApi(apiConfig,activeChar)');
  expect(schedule).toContain('selectedDialogueApi.baseUrl.replace');
  expect(schedule).toContain('selectedDialogueApi.apiKey');
  expect(schedule).toContain('model:selectedDialogueApi.model');
  expect(schedule).toContain('selectedDialogueApi.temperature');
  expect(schedule).not.toContain("Authorization: 'Bearer ' + apiConfig.apiKey");
 });
 it('只能发送同 Char + 相同用途 + 同事项的历史；旧未标用途记录只本机展示',()=>{
  expect(logic).toContain('n.scope===scope');
  expect(logic).toContain("(n.topicId||'')===topicId");
  expect(schedule).toContain('notesForStudyContext(notes,activeChar.id,requestScope,requestItemId)');
  expect(schedule).toContain('scope:requestScope,topicId:requestItemId');
  expect(schedule).toContain('legacyUnscopedStudyNotes(notes,charId)');
  expect(schedule).toContain("requestScope==='focus'");
  expect(schedule).not.toContain('const history:Note[]=[...notesForStudyChar(');
 });
 it('作业复盘和笔记追问都由用户点击，展示将发送内容并非自动付费请求',()=>{
  expect(panel).toContain('buildHomeworkReviewTopic(h,selectedClass?.name');
  expect(panel).toContain("buildHomeworkReviewTopic(h,'未归属课程'");
  expect(panel).toContain("'study',h.id");
  expect(panel).toContain("'study',n.id");
  expect(panel).toContain("'commission',c.id");
  expect(schedule).toContain('>本轮学习内容</summary>');
  expect(schedule).toContain("onSubmit={e=>{e.preventDefault();void sendNote();}}");
  expect(schedule).toContain('setAssistantOpen(true)');
  expect(panel).not.toContain('createStudyReminder(');
 });
});
