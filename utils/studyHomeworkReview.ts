/**
 * User-initiated, per-homework review: a constrained preview of exactly
 * what will be placed into the learning-room Char dialogue.
 * No course PDF, customer data, whole workspace or private-chat history.
 */
import type {ClassHomework} from './sullyWorkspace';
const limit=(value:unknown,size:number) =>
  typeof value==='string'?value.slice(0,size):'';
export function buildHomeworkReviewTopic(
  homework:ClassHomework,courseName:string,completedFocusMinutes:number,
):string {
  if(!homework?.id || !homework.title)throw new Error('作业不存在，无法复盘');
  if(!Number.isFinite(completedFocusMinutes)||completedFocusMinutes<0)
    throw new Error('专注统计不可用');
  return [
    '我主动选择对这项作业进行复盘。请先询问我真正学会了什么、哪里卡住；',
    '根据回答提出最多三个下一步练习或自检问题，不替我填写答案、不自行标记完成、不保存更改。',
    '下面是本次主动分享的作业概要，不包含 PDF 全文、其他作业或课程私人资料：',
    JSON.stringify({
      course:limit(courseName,80),
      title:limit(homework.title,180),
      dueAt:limit(homework.dueAt,32),
      done:homework.done===true,
      remainingEstimateMinutes:Math.max(0,Math.min(10080,homework.minutes||0)),
      completedFocusMinutes:Math.round(completedFocusMinutes),
      ownNote:limit(homework.note,1500),
    }),
  ].join('\n');
}
