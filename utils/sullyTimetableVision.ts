/** 课程表图片识别仅属于糯米机，不修改普通私聊识图提示词。 */
import type { VisionApiConfig } from '../types';
import { isVisionApiReady } from './visionApi';
import { extractContent, extractJson, safeFetchJson } from './safeApi';

export interface CourseImageDraft {
  name: string;
  weekday: number; // -1 = 未确定；0 为周日
  start: string;
  end: string;
  until: string;
  location: string;
  teacher: string;
  note: string;
  uncertain: string[];
}
const validTime = (value: unknown): string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '';

/** 只有用户主动按识别按钮才调用，全部结果必须预览并确认。 */
export async function recognizeCourseImage(
  imageDataUrl: string, config: VisionApiConfig,
): Promise<CourseImageDraft[]> {
  if (!isVisionApiReady(config)) throw new Error('请先在设置中开启并配置识图 API');
  if (!/^data:image\//i.test(imageDataUrl)) throw new Error('请先选择有效课程表图片');
  const result = await safeFetchJson(config.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
    body: JSON.stringify({
      model: config.model, temperature: 0, stream: false, max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {type: 'text', text: [
            '只识别图片中明确可见的课程表条目，不要臆测时间或日期。',
            '只输出 JSON 对象，字段 courses 为数组；每条有 name, weekday(0周日1周一..6周六，不能确认则 -1),',
            'start/end(24小时 HH:mm，不确定则空字符串), until(YYYY-MM-DD 不确定则空字符串),',
            'location, teacher, note(不确定则空字符串), uncertain(待核实字段名数组)。',
            '不要创建提醒，不要声称已经保存；无有效条目时 courses 输出空数组。',
          ].join('\n') },
          {type: 'image_url', image_url: {url: imageDataUrl}},
        ],
      }],
    }),
  }, 1, 60000, { appName: '糯米机', purpose: '课程表图片识别' });
  const parsed = extractJson(extractContent(result));
  if (!parsed || !Array.isArray(parsed.courses)) throw new Error('图片识别结果无法解析，请手动录入');
  return parsed.courses.slice(0, 40).map((row: unknown) => {
    const c = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    const weekday = Number.isInteger(c.weekday) && Number(c.weekday) >= 0 && Number(c.weekday) <= 6
      ? Number(c.weekday) : -1;
    const name = typeof c.name === 'string' ? c.name.slice(0, 100).trim() : '';
    const start = validTime(c.start);
    const end = validTime(c.end);
    const uncertain = Array.isArray(c.uncertain) ? c.uncertain.filter((v):v is string => typeof v === 'string') : [];
    if (!name) uncertain.push('课程名称');
    if (weekday < 0) uncertain.push('星期');
    if (!start || !end || end <= start) uncertain.push('上课时间');
    return {
      name, weekday, start, end,
      until: typeof c.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.until) ? c.until : '',
      location: typeof c.location === 'string' ? c.location.slice(0, 200) : '',
      teacher: typeof c.teacher === 'string' ? c.teacher.slice(0, 100) : '',
      note: typeof c.note === 'string' ? c.note.slice(0, 500) : '',
      uncertain: [...new Set(uncertain)],
    };
  });
}
