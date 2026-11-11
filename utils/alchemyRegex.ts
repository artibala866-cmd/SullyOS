import { DB } from './db';
import { readStoryRegexRules, storyRegexInstruction, STORY_REGEX_ASSET, type StoryRegexContext, type StoryRegexRule } from './storyRegex';

export type AlchemyDomain = 'online' | 'offline';
export const ALCHEMY_CHANGED = 'sully-alchemy-regex-changed';

/** Classify only within the imported file. Keep an author's explicit
 * subcategory unchanged; use local name patterns for generic original groups. */
export function alchemySubcategory(rule: StoryRegexRule): string {
    if (rule.subcategory?.trim()) return rule.subcategory.trim();
    const name = rule.name;
    if (rule.kind === 'template') {
        if (/小法庭|审判|裁决/.test(name)) return '法庭互动';
        if (/豆包|问答|聊天/.test(name)) return '聊天模拟';
        if (/弹幕/.test(name)) return '弹幕';
        if (/刮|彩票|红包|礼物/.test(name)) return '互动礼物';
        if (/小剧场|番茄|小说/.test(name)) return '小剧场';
        return rule.source?.category || '互动卡片';
    }
    if (/^WS\d|八股净化/.test(name + (rule.source?.category || ''))) {
        if (/核心指令/.test(name)) return '核心指令';
        if (/词汇级/.test(name)) return '词汇清理';
        if (/句式级/.test(name)) return '句式清理';
        if (/环境描写/.test(name)) return '环境描写';
        if (/人物细节/.test(name)) return '人物细节';
        if (/言情八股/.test(name)) return '言情表达';
        if (/弹性禁令|结尾/.test(name)) return '表达与结尾';
    }
    return rule.source?.category || '文字规则';
}

export const alchemyDomain = (rule: StoryRegexRule): AlchemyDomain =>
    rule.kind === 'template' ? 'online' : rule.domain === 'online' || rule.domain === 'offline'
        ? rule.domain : 'offline';

/** Legacy rules retain their original single scene; new filters can choose
 * two independent scenes. Beauty templates never execute offline. */
export const alchemyRuleTargets = (rule: StoryRegexRule): AlchemyDomain[] =>
    rule.kind === 'template' ? ['online'] :
    Array.isArray(rule.targets) && rule.targets.length
        ? (['online', 'offline'] as const).filter(target => rule.targets!.includes(target))
        : [alchemyDomain(rule)];

export const alchemyRuleAppliesTo = (rule: StoryRegexRule, domain: AlchemyDomain): boolean =>
    alchemyRuleTargets(rule).includes(domain);

/** A story preset belongs to the story only. Meetings have no story preset,
 * and must never acquire a preset-bound filter just because it is offline.
 * Users can explicitly opt a preset-bound rule into meetings. */
export const alchemyOfflineScenes = (rule: StoryRegexRule): Array<'story' | 'meeting'> =>
    rule.offlineScenes?.length ? (['story', 'meeting'] as const).filter(scene => rule.offlineScenes!.includes(scene))
        : rule.presetId ? ['story'] : ['story', 'meeting'];

export const alchemyRuleSection = (rule: StoryRegexRule): 'beauty' | 'rules' =>
    rule.kind === 'template' ? 'beauty' : 'rules';

export const alchemyRulesFor = (rules: StoryRegexRule[], domain: AlchemyDomain, presetId = ''): StoryRegexRule[] =>
    rules.filter(rule => rule.enabled && alchemyRuleAppliesTo(rule, domain)
        && (domain === 'online' || (alchemyOfflineScenes(rule).includes('story')
            && (!rule.presetId || (presetId !== '' && rule.presetId === presetId)))))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** A meeting has no story preset. Only its explicitly selected offline
 * scene runs; legacy rules bound to story presets default to story only. */
export const alchemyRulesForMeeting = (rules: StoryRegexRule[]): StoryRegexRule[] =>
    rules.filter(rule => rule.enabled && alchemyRuleAppliesTo(rule, 'offline')
        && alchemyOfflineScenes(rule).includes('meeting'))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** Apply one compact folder switch to ONLY the selected rules in that folder.
 * Keep each rule's ID, enabled state, match/replace data and preset binding.
 * Beauty templates never move to the offline execution pipeline. */
export const setAlchemyFolderTargets = (
    rules: StoryRegexRule[], folder: string, ids: ReadonlySet<string>,
    targets: AlchemyDomain[],
): StoryRegexRule[] => {
    const selected = (['online', 'offline'] as const).filter(domain => targets.includes(domain));
    if (!selected.length) throw new Error('至少选择一个生效场景');
    return rules.map(rule => {
        if (rule.kind !== 'filter' || !ids.has(rule.id) ||
            (rule.importGroup || '旧版规则') !== folder) return rule;
        return {
            ...rule,
            targets: [...selected],
            domain: selected.length === 1 ? selected[0] : (rule.domain || 'offline'),
        };
    });
};

/** Display a mixed state when individual rules in one folder use different scenes. */
export const alchemyFolderTargetSelection = (
    rules: StoryRegexRule[],
): 'online' | 'offline' | 'both' | 'mixed' => {
    const keys = rules.filter(rule => rule.kind === 'filter').map(rule =>
        alchemyRuleTargets(rule).slice().sort().join('+'));
    if (!keys.length || keys.some(key => key !== keys[0])) return 'mixed';
    return keys[0] === 'online' ? 'online' : keys[0] === 'offline' ? 'offline' : 'both';
};

/** Remove exactly the selected ID, never similarly named rules in other folders. */
export const removeAlchemyRule = (rules: StoryRegexRule[], id: string): StoryRegexRule[] =>
    rules.filter(rule => rule.id !== id);

/** Deleting a displayed import folder affects only IDs shown in that
 * category. A shared source file may contain beauty and prose rules. */
export const removeAlchemyFolderSection = (
    rules: StoryRegexRule[], folder: string, section: 'beauty' | 'rules', ids: ReadonlySet<string>,
): StoryRegexRule[] => rules.filter(rule => !(ids.has(rule.id)
    && (rule.importGroup || '旧版规则') === folder
    && alchemyRuleSection(rule) === section));

export async function loadAlchemyRules(domain: AlchemyDomain, presetId = ''): Promise<StoryRegexRule[]> {
    const raw = await DB.getAsset(STORY_REGEX_ASSET);
    return alchemyRulesFor(readStoryRegexRules(raw), domain, presetId);
}

export async function loadMeetingAlchemyRules(): Promise<StoryRegexRule[]> {
    const raw = await DB.getAsset(STORY_REGEX_ASSET);
    return alchemyRulesForMeeting(readStoryRegexRules(raw));
}

export async function updateAlchemyRules(change: (rules: StoryRegexRule[]) => StoryRegexRule[]): Promise<StoryRegexRule[]> {
    const saved = await DB.updateAssetRaw(STORY_REGEX_ASSET, raw => {
        if (raw !== null && typeof raw !== 'string') throw Error('正则数据格式错误');
        return JSON.stringify(change(readStoryRegexRules(raw)));
    });
    const rules = readStoryRegexRules(saved);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(ALCHEMY_CHANGED));
    return rules;
}

/** Never make a classification API call: format prompts activate only for
 * explicit conversational cues (or user-specified trigger keywords).
 * A model's reply may still contain a supported tag, which is rendered
 * locally whether or not a format prompt was sent. */
const FORMAT_CUES: Array<[RegExp, RegExp]> = [
    [/法庭|认罪|审判|罪状/, /法庭|认罪|审判|裁决|指控|罪状|处罚/],
    [/豆包|咨询|问答/, /豆包|咨询|问答|问一下豆包/],
    [/弹幕/, /弹幕|围观|刷屏/],
    [/刮|彩票|抽奖/, /刮刮|彩票|抽奖|中奖|刮奖/],
    [/红包/, /红包|发红包|收红包|恭喜发财/],
    [/小剧场|番茄|小说/, /小剧场|番茄|番外|写个剧场|写一段小说/],
];

const shouldSendTemplateInstruction = (rule: StoryRegexRule, recentText: string): boolean => {
    // A manually created / standalone HTML template explicitly supplies its
    // format instruction, so it must function without a hardcoded name cue.
    if (!rule.source && rule.instruction.trim()) return true;
    const needles = rule.source?.triggerKeywords || [];
    // Native imported templates must stay functional WITHOUT a manual preview.
    // triggerEnabled=0 means the author's aiPrompt is always present in the
    // EXISTING chat request so the AI may decide when to emit the matching tag.
    // triggerEnabled=1 with empty keywords is also unrestricted in the source.
    if (rule.source?.triggerEnabled === false ||
        (rule.source?.triggerEnabled === true && !needles.length)) return true;
    if (needles.length) return needles.some(word =>
        recentText.toLocaleLowerCase().includes(word.toLocaleLowerCase()));
    if (!recentText.trim()) return false;
    const cue = FORMAT_CUES.find(([name]) => name.test(rule.name));
    return !!cue && cue[1].test(recentText);
};

export const alchemyInstructions = (
    rules: StoryRegexRule[], domain: AlchemyDomain, context: StoryRegexContext, recentText: string,
): string[] => alchemyRulesFor(rules, domain)
    .filter(rule => domain === 'offline' || rule.kind !== 'template' || shouldSendTemplateInstruction(rule, recentText))
    .map(rule => storyRegexInstruction(rule, context, recentText)).filter(Boolean)
    .slice(0, 20);

/** No extra HTTP/LLM request. Existing prompt gets only context-relevant
 * directives; if no cue is found the current one-call request is unchanged. */
export async function loadAlchemyInstructions(
    domain: AlchemyDomain, recentText: string, context: StoryRegexContext = {},
): Promise<string[]> {
    const rules = await loadAlchemyRules(domain);
    return alchemyInstructions(rules, domain, context, recentText);
}

export function protectAmbiguousFilter(rule: StoryRegexRule, matched: string): boolean {
    const category = rule.source?.category || '';
    const isBroadStyleBan = /^WS\d/i.test(rule.name) || /八股净化|词汇级禁令|句式级禁令/.test(category + rule.name);
    if (rule.source?.smartFilter === false || !isBroadStyleBan) return false;
    // A local regex cannot infer an author's meaning. Removing everyday words
    // from the middle of a sentence is irreversible, so preserve short matches
    // unless the user explicitly switches the rule to strict matching.
    return rule.replacement === '' && matched.length < 6 && !/[<>[\]{}]/.test(matched);
}
