import type { StoryRegexRule } from './storyRegex';
import { renderStoryRegexTemplate } from './storyRegexTemplate';

/** A sample payload, generated locally from the actual template fields.
 * There is no second API request or manually triggered test page.
 * The same replacement renderer is used for real messages. */
const EXAMPLES: Record<string, string> = {
    title: '今天的小剧场', name: '小糯', sender: '小糯', q: '今天有什么惊喜？',
    a: '当然有，已经准备好了。', p: '正在整理回复…', s: '希望今天也有好心情',
    msg: '送你一份小惊喜', message: '我来啦！', amount: '52.00',
    prize: '神秘小礼物', level: '特别奖', caseNo: 'NO. 001',
    crime: '偷偷想你', emotion: '心动', detail: '被发现偷偷准备礼物',
    ev1: '聊天记录', ev2: '偷偷准备的小纸条',
    heart: '心软一点嘛', gVerdict: '判决：有罪',
    gPun1: '每天抱抱', gPun2: '主动说晚安', gPun3: '分享小秘密',
    final: '全场一致通过', ngVerdict: '判决：无罪',
    ngPun1: '贴贴一下', ngPun2: '分享快乐', ngPun3: '好好陪伴',
    ngPun4: '一起散步', tags: '日常 · 甜蜜', score: '9.8',
    stars: '★★★★★', content: '午后的阳光落在窗边，他抬头朝你笑了。',
    c1: '好甜！', c2: '请继续更新', c3: '喜欢这个结局',
};
const exampleValue = (key: string): string => {
    const normalized = key.toLowerCase();
    if (/^(n[1-8]|nickname|user|author)/i.test(key)) return '观众';
    if (/^(d[1-8]|text|body|comment)/i.test(key)) return '前排围观！';
    if (EXAMPLES[key]) return EXAMPLES[key];
    if (EXAMPLES[normalized]) return EXAMPLES[normalized];
    if (/time|date|时间|日期/i.test(key)) return '20:20';
    if (/amount|money|price|金额/i.test(key)) return '52.00';
    if (/name|sender|角色|昵称/i.test(key)) return '小糯';
    return '示例内容';
};

function put(target: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.').filter(Boolean).slice(0, 8);
    let current = target;
    for (const key of keys.slice(0, -1)) {
        if (!current[key] || typeof current[key] !== 'object') current[key] = {};
        current = current[key] as Record<string, unknown>;
    }
    if (keys.length) current[keys[keys.length - 1]] = value;
}

export function renderAlchemyTemplatePreview(rule: Pick<StoryRegexRule, 'replacement' | 'parseMode'>): string {
    const template = rule.replacement || '';
    if (!template.trim()) return '';
    // We only interpret displayed {{capture.field}} keys and #each: capture
    // items; no authored code, event handlers or browser scripts execute here.
    const examples = new Map<number, Record<string, unknown>>();
    const fields = /\{\{\s*(\d+)\.([\w\u3400-\u9fff.]+)\s*\}\}/g;
    for (const match of template.matchAll(fields)) {
        const index = Number(match[1]);
        if (index < 1 || index > 16) continue;
        if (!examples.has(index)) examples.set(index, {});
        put(examples.get(index)!, match[2], exampleValue(match[2].split('.').at(-1) || ''));
    }
    const loop = /\{\{#each:(\d+)\.([\w\u3400-\u9fff.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    for (const match of template.matchAll(loop)) {
        const index = Number(match[1]);
        if (index < 1 || index > 16) continue;
        if (!examples.has(index)) examples.set(index, {});
        const row: Record<string, string> = {};
        for (const value of match[3].matchAll(/\{\{([\w\u3400-\u9fff.]+)\}\}/g))
            row[value[1]] = exampleValue(value[1]);
        put(examples.get(index)!, match[2], [row, { ...row }]);
    }
    const captures = ['示例内容'];
    for (let index = 1; index <= Math.max(1, ...examples.keys()); index++) {
        const data = examples.get(index);
        captures[index] = data ? rule.parseMode === 'kv'
            ? Object.entries(data).map(([key, value]) => key + '：' + String(value)).join('｜')
            : JSON.stringify(data) : '示例内容';
    }
    try {
        return renderStoryRegexTemplate(template, captures, undefined,
            rule.parseMode || 'text', 150000,
            key => ({user:'用户',char:'角色',match:'示例内容'} as Record<string,string>)[key]);
    } catch {
        // Broken drafts should remain editable and show plain HTML if possible.
        return template;
    }
}
