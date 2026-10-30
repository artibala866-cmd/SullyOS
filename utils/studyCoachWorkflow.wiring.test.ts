import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const file=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
describe('阶段2主页去重与 Char 真实执行闭环接线',()=>{
  it('只隐藏首页旧自习室图标，保留独立路由兼容及学习室内部原 StudyApp',()=>{
    const constants=file('constants.tsx'),shell=file('components/PhoneShell.tsx');
    const study=file('apps/ScheduleApp.tsx');
    expect(constants).not.toContain("{ id: AppID.Study, name: '自习室'");
    expect(constants).toContain("{ id: AppID.Schedule, name: '学习室'");
    expect(shell).toContain('case AppID.Study: return <StudyApp');
    expect(study).toContain('StudyApp highlightCourseId');
    expect(study).toContain("['calendar','课程表'],['study','自习室']");
  });
  it('反馈和排程仅写现有工作空间，事件及角色都绑定，提交前再验证',()=>{
    const study=file('apps/ScheduleApp.tsx'),workflow=file('utils/studyCoachWorkflow.ts');
    const space=file('utils/sullyWorkspace.ts');
    expect(study).toContain('mutateWorkspace(current=>replyToCoach(current,charId,eventKey,choice))');
    expect(study).toContain('mutateWorkspace(current=>proposeCoachAction(current,charId,eventKey))');
    expect(study).toContain('mutateWorkspace(current=>decideCoachAction(current,charId,actionId,accept))');
    expect(study).toContain('coachSuppressed(workspaceSnapshot');
    expect(study).toContain('autoCoachController.current?.abort()');
    expect(study).toContain('onWorkspaceSnapshot(saved)');
    expect(workflow).toContain('planIssues(next).filter(i=>i.slotId===slot.id)');
    expect(workflow).toContain("a.charId===charId");
    expect(space).toContain("coachActions:normalizedRows(");
    expect(study).toContain("setPlanRequest(null)");
    expect(study).not.toContain('createStudyReminder(');
  });
});