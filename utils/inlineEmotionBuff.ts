import type { CharacterProfile } from '../types';

/**
 * 私聊回复与 Buff 共用同一次文本模型调用。
 * 模型把轻量状态附在正文末尾；客户端/worker 在展示前剥离，再复用原有的 Buff 解析落库。
 * 这里绝不发起任何网络请求。
 */
export const INLINE_EMOTION_OPEN = '<SULLY_EMOTION_BUFF>';
export const INLINE_EMOTION_CLOSE = '</SULLY_EMOTION_BUFF>';

export function buildInlineEmotionInstruction(char: Pick<CharacterProfile, 'name' | 'activeBuffs'>): string {
    const previous = (char.activeBuffs || []).map(buff => ({
        id: buff.id, name: buff.name, label: buff.label, intensity: buff.intensity,
        description: buff.description,
    }));
    return `【同轮私聊情绪状态（开启 Buff 时才适用）】
你必须先按当前角色设定、对话要求正常回复用户，保留原有的卡片、动作、语言及格式，不要用 JSON 代替回复。
在整轮最终回复的末尾，另起一行附上一段仅供系统读取的状态，严格用下面的标签包裹合法 JSON。标签及 JSON 不属于聊天文字，不能在正文中提及：
${INLINE_EMOTION_OPEN}
{"changed":true,"buffs":[{"id":"emotion_key","name":"情绪名","label":"短标签","intensity":2,"emoji":"💭","color":"#888888","description":"简短原因"}],"injection":"给角色下一轮的简洁情绪底色，勿写旁白指令","innerState":"角色此刻简短的第一人称心里话"}
${INLINE_EMOTION_CLOSE}
现有情绪：${JSON.stringify(previous)}。
基于本轮实际交流与角色回复评估，不要无端添加或反复跳变。强度只允许 1、2、3；buffs 最多 3 个。
若状态没有明显变化，输出 {"changed":false,"innerState":"简短的当下心声"}，不必重写 buffs/injection。
如果有变化，changed=true，buffs 为更新后的完整状态（允许空数组），injection 简短且与 buffs 一致。
只使用上面这一段隐藏结构化结果；不要请求工具、额外回复或另一次评估。所有正常对话正文必须放在标签之前。`;
}

const completeBlock = /<SULLY_EMOTION_BUFF>\s*([\s\S]*?)\s*<\/SULLY_EMOTION_BUFF>/gi;
const openingBlock = /<SULLY_EMOTION_BUFF>[\s\S]*$/i;

/** 预览与正式落库通用：屏蔽已完成或尚未关闭的隐藏块，防止输出到 UI。 */
export function stripInlineEmotion(text: string): string {
    let clean = String(text || '').replace(completeBlock, '').replace(openingBlock, '');
    // 流式输出可能正好停在标签的任意前缀；只隐藏末尾确实匹配前缀的片段。
    const tail = clean.slice(-INLINE_EMOTION_OPEN.length);
    for (let size = Math.min(tail.length, INLINE_EMOTION_OPEN.length - 1); size > 0; size--) {
        if (tail.slice(-size).toUpperCase() === INLINE_EMOTION_OPEN.slice(0, size)) {
            clean = clean.slice(0, -size);
            break;
        }
    }
    return clean.trimEnd();
}

export function extractInlineEmotion(text: string): { content: string; raw: string | null } {
    const source = String(text || '');
    let match: RegExpExecArray | null;
    let last: string | null = null;
    const re = new RegExp(completeBlock.source, 'gi');
    while ((match = re.exec(source)) !== null) last = match[1].trim();
    return { content: stripInlineEmotion(source).trim(), raw: last };
}
