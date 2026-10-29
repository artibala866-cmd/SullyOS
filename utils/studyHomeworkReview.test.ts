import {describe,expect,it} from 'vitest';
import {buildHomeworkReviewTopic} from './studyHomeworkReview';
import type {ClassHomework} from './sullyWorkspace';
const lesson:ClassHomework={
 id:'h1',classId:'course',title:'透视作业',dueAt:'2026-11-20T18:00',
 done:false,note:'我发现线条角度很难控制',minutes:45,
};
describe('作业复盘只用用户本次主动选择的单条资料',()=>{
 it('提示先询问学习所得、困难和下一步，不替用户完成',()=>{
  const topic=buildHomeworkReviewTopic(lesson,'速写',75);
  expect(topic).toContain('透视作业');
  expect(topic).toContain('我发现线条角度');
  expect(topic).toContain('"completedFocusMinutes":75');
  expect(topic).toContain('"remainingEstimateMinutes":45');
  expect(topic).toContain('不自行标记完成');
  expect(topic).not.toContain('客户');
  expect(topic).not.toContain('某个 PDF 全文');
 });
 it('只限单条作业；笔记和课程名有长度上限，拒绝不合法的专注统计',()=>{
  const topic=buildHomeworkReviewTopic({...lesson,note:'X'.repeat(3000)},'Y'.repeat(200),0);
  expect(topic).not.toContain('X'.repeat(1501));
  expect(topic).not.toContain('Y'.repeat(81));
  expect(()=>buildHomeworkReviewTopic(lesson,'课',-1)).toThrow('专注统计不可用');
  expect(()=>buildHomeworkReviewTopic({...lesson,id:''},'课',0)).toThrow('不存在');
 });
});
