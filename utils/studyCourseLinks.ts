/**
 * 学习室课程表 <-> 原有 StudyCourse：仅存 ID，不复制旧 PDF、章节或测验。
 * All mutations are confined to sully_workspace_v1, never DB.saveCourse/deleteCourse.
 */
import type { StudyCourse } from '../types';
import { DB } from './db';
import type { WorkspaceData, TimetableClass } from './sullyWorkspace';

export type StudyCourseOption = Pick<StudyCourse, 'id' | 'title' | 'totalProgress'> & {
  chaptersCompleted: number; chaptersTotal: number;
};
export function toStudyCourseOptions(courses: readonly StudyCourse[]): StudyCourseOption[] {
  return courses
    .filter(c => typeof c.id === 'string' && c.id.trim())
    .map(c => ({
      id:c.id, title:c.title, totalProgress:Number.isFinite(c.totalProgress)
        ? Math.max(0,Math.min(100,c.totalProgress)) : 0,
      chaptersCompleted:(c.chapters || []).filter(ch=>ch.isCompleted).length,
      chaptersTotal:(c.chapters || []).length,
    })).sort((a,b)=>a.title.localeCompare(b.title,'zh-Hans'));
}

export async function loadStudyCourseOptions(): Promise<StudyCourseOption[]> {
  return toStudyCourseOptions(await DB.getAllCourses());
}

export function setClassStudyCourseLink(
  data: WorkspaceData, classId: string, courseId: string,
  availableCourses: readonly Pick<StudyCourse,'id'>[],
): WorkspaceData {
  if (!data.classes.some(c=>c.id===classId)) throw new Error('课程表记录已删除，请刷新后重试');
  if (courseId && !availableCourses.some(c=>c.id===courseId))
    throw new Error('原有自习室课程不存在，请先刷新课程列表');
  return {...data,classes:data.classes.map(c=>c.id===classId
    ? {...c,studyCourseId:courseId || undefined} : c)};
}

/** Delete only a local timetable row. Homework and notes stay recoverable. */
export function deleteTimetableClass(
  data: WorkspaceData, classId: string,
): WorkspaceData {
  if (!data.classes.some(c=>c.id===classId)) return data;
  return {...data,classes:data.classes.filter(c=>c.id!==classId)};
}

export function orphanedClassContent(data:WorkspaceData) {
  const ids=new Set(data.classes.map(c=>c.id));
  return {
    homework:data.homework.filter(h=>!ids.has(h.classId)),
    notes:data.notes.filter(n=>!ids.has(n.classId)),
  };
}

export function reassignOrphanContent(
  data: WorkspaceData, kind:'homework'|'note', id:string, classId:string,
):WorkspaceData {
  if (!data.classes.some(c=>c.id===classId)) throw new Error('目标课程不存在');
  const items = kind==='homework' ? data.homework : data.notes;
  const entry=items.find(x=>x.id===id);
  if (!entry || data.classes.some(c=>c.id===entry.classId))
    throw new Error('该资料不是未归属记录，不能重新归类');
  return kind==='homework'
    ? {...data,homework:data.homework.map(h=>h.id===id?{...h,classId}:h)}
    : {...data,notes:data.notes.map(n=>n.id===id?{...n,classId}:n)};
}

/** Missing reference is not a deletion command: keep its ID visible for recovery. */
export function resolveLinkedCourse(
  row:TimetableClass, options:readonly StudyCourseOption[],
): StudyCourseOption | null {
  return options.find(c=>c.id===row.studyCourseId) ?? null;
}
