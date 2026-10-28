import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const panel=readFileSync(resolve(process.cwd(),'apps/WorkspacePanel.tsx'),'utf8');
const schedule=readFileSync(resolve(process.cwd(),'apps/ScheduleApp.tsx'),'utf8');
const study=readFileSync(resolve(process.cwd(),'apps/StudyApp.tsx'),'utf8');

describe('学习室旧课程链接的真实 UI 接线',()=>{
  it('课程表提供 ID 选择器、缺失提示、重新读取旧课程及显式跳转按钮',()=>{
    expect(panel).toContain('loadStudyCourseOptions');
    expect(panel).toContain('setClassStudyCourseLink');
    expect(panel).toContain('旧关联已失效');
    expect(panel).toContain('打开关联自习室课程');
    expect(panel).toContain('onOpenStudyCourse(courseId)');
  });
  it('跳转必须经自习室原有书架显式点开，不自动执行有成本的讲解',()=>{
    expect(schedule).toContain('openLinkedStudyCourse');
    expect(schedule).toContain('highlightCourseId={studyTargetCourseId || undefined}');
    expect(study).toContain('highlightedCardRef');
    expect(study).toContain('点击下方高亮封面进入课堂');
    expect(study).not.toContain('handleTeach(highlightCourseId');
  });
  it('孤立作业与笔记可恢复，删课程不会直接删资料',()=>{
    expect(panel).toContain('orphanedClassContent(data)');
    expect(panel).toContain("reassignOrphanContent(current,kind,id,classId)");
    expect(panel).toContain('未归属资料');
    expect(panel).toContain('deleteTimetableClass(current,id)');
    expect(panel).not.toContain('DB.deleteCourse(');
  });
});
