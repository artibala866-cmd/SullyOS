import type { StoryArchiveFact, StoryTheaterArchive } from '../types';
import { extractContent } from './safeApi';

const normalize = (text: string) => text.normalize('NFKC').trim().toLowerCase();
const comparable = (text: string) => normalize(text).replace(/[\p{P}\p{Z}\s]/gu, '');

/** Backward-compatible reading only: older saves have no modality field.
 * Classify explicit future intention and hearsay conservatively; keep the
 * actual memory wording and stored vector bytes unchanged.
 */
export function storyArchiveModality(fact: Pick<StoryArchiveFact, 'text' | 'modality'>):
    'planned' | 'unverified' | undefined {
    if (fact.modality) return fact.modality;
    const text = fact.text;
    const hearsay = /(?:据说|传闻|听说|怀疑|猜测|尚未证实|未经证实|无人证实|尚未核实|未确认|没(?:有)?确认|有待确认|可能存在)/u;
    const negativeVerification = /(?:尚未|还没(?:有)?|没有|未能|尚待)(?:最终|已经|明确)?(?:确认|证实|核实|查明)/u;
    if (hearsay.test(text) || negativeVerification.test(text)) {
        // A report can mention a verification inside the rumor itself. A
        // separate affirmative clause is needed to mark that report resolved.
        const resolved = text.split(/[，,；;。！？\n]/u).some(clause =>
            /(?:最终证实|已经证实|查明真相|明确证实|证据表明)/u.test(clause)
            && !hearsay.test(clause) && !negativeVerification.test(clause));
        const assertion = text.replace(/[，,；;。]\s*(?:此前|先前|之前|原先|当时)的?(?:传闻|猜测)(?:[^。！？\n]*)[。！？]?$/u, '');
        const confirmed = /(?:确认(?:了|为|属实|正常|无误|安全|有效)|核实(?:了|为|属实|无误)|查明|证实)/u;
        const explainsPriorRumor = assertion !== text && confirmed.test(assertion)
            && !hearsay.test(assertion) && !negativeVerification.test(assertion);
        if (!resolved && !explainsPriorRumor) return 'unverified';
    }
    const intends = /(?:打算|计划|准备于|准备在|决定.{0,55}(?:后|前|以后|之后|明天|下周|改天)|承诺.{0,35}(?:以后|明天|今后|将来|下周)|将要|拟于)/u.test(text);
    if ((intends || /(?:^|[：:，,。])\s*(?:待办|下一步|接下来要|尚需|还需要|约好要|答应要)/u.test(text)) && !/(?:计划已经完成|计划已完成|打算已取消|放弃计划|取消计划|终于做到了|最终完成|随后已经前往|后来已经前往)/u.test(text)) return 'planned';
    return undefined;
}


const unresolvedStoryClaim = /[？?]|(?:假如|如果|要是|假装|扮作|扮演|装作|幻觉|开玩笑|据说|传闻|猜测|可能|梦见|梦里|以为|曾经|尚未|还没|未能|未完成|差点|并未|没有完成|没有取消|仅尝试|只是尝试|已出发|已经出发|已经动身|已经去给|刚开始|已经开始|正在|即将|想要|打算|计划|应该|务必)/u;
const persistentStoryRules = [
    /(?:已经死亡|已经死了|早已死亡|早已死了|已死|已经去世|早已去世|并非活人|不是活人|复活|还阳|恢复实体|重新活过来|变回活人)/u,
    /(?:是|成了|变成|化为|已成|身为|作为)(?:一[个只缕道位名])?(?:亡魂|魂魄|幽灵|鬼魂|鬼|魂体)(?![市差门王怪屋])/u,
    /(?:只有|唯有|只能被|再也无法|仍无法|不能|看不见|听不见|认不出|无法触碰|不可见|不可闻|不可被|不能被|没有实体|无法被|不可能看见|不可能被|不能碰到|看得见|听得见).{0,28}(?:活人|普通人|凡人|主角|鬼魂|亡魂|魂魄|灵体|实体)/u,
    /(?:活人|普通人|凡人|其他人|别人|旁人).{0,12}(?:看不见|看不到|无法看见|不能看见|不能看到|不可能看见|不可能看到|听不见|听不到|看得见|能看见|能看到|可以看见|可以看到)/u,
    /(?:仅|只有|唯有)[\p{Script=Han}]{1,16}(?:知道|知晓|知情|获悉)|(?:其余人|其他人|旁人)(?:仍然|仍|都|均)?(?:不知道|不知情|尚未获悉)/u,
    /(?:is (?:a )?ghost|invisible to the living|returned to life)/iu,
];
const completedStoryAction = /(?:已经|已然|早已|已(?=送|换|寄|提交|交|修|归还|打开|关闭|找|付|销毁)|总算|终于|成功|完成了?|办妥|做完|送达|送到了?|交给了|换好了?|更换了|修好了?|锁上了|寄出了?|交付了|结清了?|关上了|取回了|解开了|拆除了|封上了|还清了|送过了|搞定|不必再|无需再|\bcompleted\b|\bfinished\b)/iu;
const canceledStoryAction = /(?:已经取消|已取消|正式取消|取消了|撤销了|已撤销|作罢|决定放弃|\bcancelled\b|\bcanceled\b)/iu;

function storyArchiveContinuityKind(
    fact: Pick<StoryArchiveFact, 'kind' | 'text' | 'modality' | 'continuity'>,
): StoryArchiveFact['continuity'] {
    if (storyArchiveModality(fact)) return;
    if (fact.kind === 'author') return persistentStoryRules.some(pattern => pattern.test(fact.text)) ? 'rule' : undefined;
    if (fact.continuity === 'rule' || fact.continuity === 'completed' || fact.continuity === 'canceled') return fact.continuity;
    if (unresolvedStoryClaim.test(fact.text)) return;
    if (persistentStoryRules.some(pattern => pattern.test(fact.text))) return 'rule';
    if (canceledStoryAction.test(fact.text)) return 'canceled';
    if (completedStoryAction.test(fact.text)) return 'completed';
}

// Match action + object. Mere co-occurrence of a person or an object isn't a
// match (e.g. repairing a key is separate from handing the key to someone).
const storyActions = [
    ['送', /(?:送(?:过|给|去|到|达|了)?|交(?:付|给|到|了)|递给)/gu],
    ['换', /(?:更换|替换|换(?:好|过|成|了)?)/gu],
    ['寄', /(?:邮寄|寄送|寄(?:出|过|了)?)/gu],
    ['提交', /(?:递交|提交|上交|交上)/gu],
    ['修', /(?:修理|修复|修(?:好|了)?)/gu],
    ['归还', /(?:归还|交还|还给|退还)/gu],
    ['打开', /(?:打开|拉开|开启|解开)/gu],
    ['关闭', /(?:关闭|关上|合上|锁上)/gu],
    ['找', /(?:找回|找到|找出|寻找|找)/gu],
    ['付', /(?:付清|支付|结清|缴清|还清)/gu],
    ['销毁', /(?:销毁|烧掉|拆除|毁掉)/gu],
] as const;
const actionFillers = /(?:早已经|已经|早已|终于|总算|成功|完成了?|打算|计划|接下来|接着|准备|答应|决定|约好|尚未|确认|宣布|取消了?|撤销了?|了|过)/gu;
const genericActionObject = /^(?:事情|任务|事项|工作|东西|物品|行动|要求|事|安排|约定)$/u;

function storyActionSignatures(text: string) {
    return text.split(/(?:[，,、；;。！？\n]|以及|并且|然后|同时|并(?=向|给|去|换|送|将|把|已|修|寄)|和(?=去|给|换|送|将|把|修|寄))/u).flatMap(clause => {
        return storyActions.flatMap(([verb, pattern]) => {
            const matches = [...clause.matchAll(pattern)];
            if (matches.length !== 1) return [];
            const [match] = matches;
            const before = clause.slice(0, match.index);
            const after = clause.slice(match.index + match[0].length);
            const beforeRecipient = before.match(/(?:给|向)([\p{Script=Han}]{1,10}?)(?:去|把[^把将]+|将[^把将]+)?$/u)?.[1];
            // Direct objects can be fronted (把门锁换好 / 橘子已经送到).
            const fronted = before.match(/[把将]([^把将]{1,25})$/u)?.[1]
                ?? before.match(/^(?:[\s【】]+)?([\p{Script=Han}]{1,12}?)(?:已经|早已|已)$/u)?.[1];
            const afterRecipient = after.match(/(?:给|交到)([\p{Script=Han}]{1,10})/u)?.[1]
                ?? (fronted && /^(?:送[给到]|交给|递给)$/u.test(match[0])
                    ? after.match(/^了?([\p{Script=Han}]{1,10}?)(?:手里|手中|家中|家里|门口|处|$)/u)?.[1] : undefined);
            const object = comparable((fronted || after.split(/(?:给|到|交给|换|送|修|寄|作为|时|之前|以后)/u)[0])
                .replace(actionFillers, '').replace(/^(?:一下|一把|一批|一些|一袋|一篮|两袋|一个|那把|这把|新的|新|旧的|旧)/u, '')
                .replace(/(?:的事|这件事|这项任务)$/u, ''));
            if (!object || object.length > 16 || genericActionObject.test(object)) return [];
            const recipient = beforeRecipient ?? afterRecipient;
            return [{ verb, object, recipient: recipient && comparable(recipient) }];
        });
    });
}

function storyPlanOutcomes(plan: StoryArchiveFact, outcomes: StoryArchiveFact[]) {
    const later = outcomes.filter(outcome => plan.sourceMessageId < outcome.sourceMessageId);
    const sameKey = later.find(outcome => plan.key === outcome.key);
    // An explicit repeat is a separate occurrence. Require the stable key
    // or independently sourced time before comparing it with an older alias.
    const repeated = /(?:再一次|再度|再次|又一次|重新|(?:明天|后天|次日|隔天|下次|下周)再)/u.test(plan.text);
    const comparableOutcomes = repeated ? later.filter(outcome => outcome === sameKey
        || (plan.storyTime && outcome.storyTime === plan.storyTime)) : later;
    const wanted = storyActionSignatures(plan.text);
    if (!wanted.length) return sameKey ? [sameKey] : [];
    const matched = wanted.map(task => comparableOutcomes.find(outcome =>
        (outcome === sameKey && (wanted.length === 1 || /(?:两件事|这几件事|所有事项).{0,6}(?:都|均|全部)/u.test(outcome.text)))
        || storyActionSignatures(outcome.text).some(result =>
        task.verb === result.verb && task.object === result.object
        && (!task.recipient || task.recipient === result.recipient)
        && (task.object.length >= 2 || comparable(plan.text).includes(result.verb + result.object)))));
    return matched.every(Boolean) ? matched.filter((fact): fact is StoryArchiveFact => Boolean(fact)) : [];
}

function storyContinuitySources(
    rows: readonly { id: number; content: string; role?: string }[],
    represented: readonly StoryArchiveFact[],
): StoryArchiveFact[] {
    const result: StoryArchiveFact[] = [];
    const representedTexts = new Set(represented.map(fact => fact.sourceMessageId + '/' + comparable(fact.text)));
    const editedSources = new Set(represented.filter(fact => fact.vectorTextState === 'synced' && fact.continuity === undefined
        && fact.key.startsWith('原文/')).map(fact => fact.sourceMessageId));
    const blockedSources = new Set(represented.filter(fact => fact.vectorTextState === 'deleted').map(fact => fact.sourceMessageId));
    for (const row of rows) {
        if (blockedSources.has(row.id) || editedSources.has(row.id)) continue;
        const content = extractContent({ choices: [{ message: { content: row.content } }] }, false);
        for (const sentence of storySentences(content)) {
            const original = sentence.trim();
            const text = row.role === 'user'
                ? original.replace(/^(?:作者(?:纠正|备注|设定)|补充设定|剧情设定|设定|纠正)[:：]\s*/u, '') : original;
            if (text.length < 5 || text.length > 180 || /[“”「」『』"'<>：:]|(?:说道|问道|台词)/u.test(text)
                || unresolvedStoryClaim.test(text) || representedTexts.has(row.id + '/' + comparable(text))) continue;
            const continuity = storyArchiveContinuityKind({ kind: 'fact', text });
            if (!continuity || (continuity !== 'rule' && row.role !== 'assistant')) continue;
            result.push({ key: '原文/' + row.id + '/' + result.length, kind: 'fact', text, terms: [],
                sourceMessageId: row.id, continuity });
        }
    }
    return result;
}

/** Build the effective state before ranking. A newer verified outcome must be
 * discovered even if the old plan would have ranked much higher on its own. */
export function reconcileStoryArchiveContinuity(
    facts: StoryArchiveFact[], archives: StoryTheaterArchive[], beforeId: number,
    archivedRows: readonly { id: number; content: string; role?: string }[],
    visibleRows: readonly { id: number; content: string; role?: string }[],
): { facts: StoryArchiveFact[]; active: StoryArchiveFact[]; closedPlans: StoryArchiveFact[] } {
    const past = archives.filter(box => box.toMessageId < beforeId);
    const stored = past.flatMap(box => [...(box.historyFacts ?? []), ...(box.facts ?? [])]);
    // Older, unstructured saves still carry source text. Use only bounded,
    // explicit assertions. Never send the full archived conversation again.
    const sourceBoxes = past.filter(box => box.strategy === 'summary' || box.facts);
    const sources = archivedRows.filter(row => sourceBoxes.some(box => box.fromMessageId <= row.id && row.id <= box.toMessageId));
    const attached = [...stored, ...facts];
    const storedRuleSources = new Set(stored.filter(fact => storyArchiveContinuityKind(fact) === 'rule').map(fact => fact.sourceMessageId));
    const recovered = storyContinuitySources(sources, attached).filter(fact =>
        fact.continuity !== 'rule' || !storedRuleSources.has(fact.sourceMessageId));
    const recent = storyContinuitySources(visibleRows, attached);
    const outcomes = [...facts, ...recovered, ...recent].filter(fact => {
        const kind = storyArchiveContinuityKind(fact);
        return kind === 'completed' || kind === 'canceled';
    }).sort((a, b) => b.sourceMessageId - a.sourceMessageId);
    const present = new Set(facts.map(storyArchiveFactIdentity));
    const closedPlans: StoryArchiveFact[] = [];
    const settled = new Set<StoryArchiveFact>();
    for (const plan of [...facts, ...stored.filter(fact => !present.has(storyArchiveFactIdentity(fact)))]) {
        if (plan.vectorTextState === 'deleted' || storyArchiveModality(plan) !== 'planned') continue;
        const resolution = storyPlanOutcomes(plan, outcomes);
        if (!resolution.length) continue;
        closedPlans.push(plan);
        for (const fact of resolution) settled.add(fact);
    }
    const closed = new Set(closedPlans.map(storyArchiveFactIdentity));
    const current = facts.filter(fact => !closed.has(storyArchiveFactIdentity(fact)));
    const selectedRules = [...current, ...recovered].filter(fact => storyArchiveContinuityKind(fact) === 'rule');
    const active = [...new Map([...selectedRules, ...settled].sort((a, b) => a.sourceMessageId - b.sourceMessageId)
        .map(fact => [comparable(fact.text), fact])).values()];
    return { facts: current, active, closedPlans };
}

export function formatStoryArchiveActiveState(
    active: StoryArchiveFact[], query: string, floorNumbers: ReadonlyMap<number, number>,
    sourceTimes: ReadonlyMap<number, string>,
) {
    // Reserve space for durable constraints and resolved work inside the usual
    // confirmed-facts budget. An unrelated flashback cannot displace them.
    const rules = active.filter(fact => storyArchiveContinuityKind(fact) === 'rule');
    const outcomes = active.filter(fact => storyArchiveContinuityKind(fact) !== 'rule');
    const pickedRules = storyArchiveFactLines(rankStoryArchiveFacts(rules, query), floorNumbers, 1000, sourceTimes);
    const used = pickedRules.reduce((total, item) => total + item.line.length + 1, 0);
    const pickedOutcomes = storyArchiveFactLines(rankStoryArchiveFacts(outcomes, query), floorNumbers, 1350 - used, sourceTimes)
        .sort((a, b) => a.fact.sourceMessageId - b.fact.sourceMessageId);
    const picked = [...pickedRules, ...pickedOutcomes];
    return {
        selected: new Set(picked.map(item => storyArchiveFactIdentity(item.fact))),
        cost: picked.length ? picked.reduce((total, item) => total + item.line.length + 14, 40) : 0,
        text: [
            ...(pickedRules.length ? ['【当前持续生效的剧情设定】', ...pickedRules.map(item => item.line)] : []),
            ...(pickedOutcomes.length ? ['【已经结案的事项】', ...pickedOutcomes.map(item =>
                item.line.replace(/^(\[[^\]]+\] )?/u, prefix => prefix + (storyArchiveContinuityKind(item.fact) === 'canceled' ? '【已取消】' : '【已完成】')))] : []),
        ].join('\n'),
    };
}

/** A bounded continuation cue backed by verified archive facts, with the original floor provenance. */
export function formatStoryArchiveScene(
    facts: StoryArchiveFact[], floorNumbers: ReadonlyMap<number, number>, sourceTimes: ReadonlyMap<number, string>,
) {
    const newest = [...facts].sort((a, b) => b.sourceMessageId - a.sourceMessageId);
    const potential = newest.filter(fact => fact.kind === 'fact' && !storyArchiveModality(fact)
        && !storyArchiveContinuityKind(fact));
    const latest = potential.length ? floorNumbers.get(potential[0].sourceMessageId) ?? 0 : 0;
    const nearScene = (fact: StoryArchiveFact) => (floorNumbers.get(fact.sourceMessageId) ?? 0) >= latest - 12;
    const scene = potential.filter(fact => nearScene(fact)
        && /(?:场景|地点|位置|在场|去向|当前|此刻|正待|正在|抵达|来到|停在|留在|藏在|待在|等候|等着|坐在|站在|走进|身旁|at the|arrived|standing|waiting)/iu.test(fact.key + ' ' + fact.text));
    const picked = storyArchiveFactLines((scene.length ? scene : potential).slice(0, 3),
        floorNumbers, 420, sourceTimes).sort((a, b) => a.fact.sourceMessageId - b.fact.sourceMessageId);
    const plan = newest.find(fact => storyArchiveModality(fact) === 'planned'
        && nearScene(fact));
    if (plan) picked.push(...storyArchiveFactLines([plan], floorNumbers, 190, sourceTimes));
    return {
        text: picked.map(item => item.line).join('\n'),
        facts: picked.map(item => item.fact),
    };
}

/** Match named entities and exact archive keys without needing a second model call. */
export function storyRelatedArchiveFacts(
    facts: StoryArchiveFact[], query: string, semanticRank: ReadonlyMap<string, number>,
): StoryArchiveFact[] {
    const needle = normalize(query);
    const terms = (fact: StoryArchiveFact) => [...new Set([...fact.terms, ...fact.key.split(/[\/：:·]/u)]
        .map(normalize).filter(term => term.length >= 2))];
    const frequency = new Map<string, number>();
    const tags = new Map(facts.map(fact => [fact, terms(fact)]));
    for (const values of tags.values()) for (const term of values) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    const specific = (term: string) => (frequency.get(term) ?? 0) <= Math.max(4, facts.length * 0.12)
        && !/^(?:事件|剧情|人物|地点|状态|计划|记录|结果|作者)$/u.test(term);
    const score = (fact: StoryArchiveFact) => (tags.get(fact) ?? []).filter(term => specific(term) && needle.includes(term)).length;
    const seeds = rankStoryArchiveFacts(facts.filter(fact => score(fact) > 0
        || (semanticRank.get(fact.vectorNodeId ?? '') ?? Infinity) < 2), query, semanticRank).slice(0, 3);
    const anchors = new Set(seeds.flatMap(fact => (tags.get(fact) ?? []).filter(specific)));
    const seedIds = new Set(seeds.map(storyArchiveFactIdentity));
    const neighbors = facts.filter(fact => !seedIds.has(storyArchiveFactIdentity(fact))
        && (tags.get(fact) ?? []).some(term => anchors.has(term)));
    return [...seeds, ...rankStoryArchiveFacts(neighbors, query, semanticRank).slice(0, 3)];
}

/** Only explicit, bounded scene statements can bridge a gap after the last archive. */
export function storyRecentSceneCue(
    rows: readonly { id: number; role: string; content: string }[], floorNumbers: ReadonlyMap<number, number>,
): string {
    for (const row of rows.slice(-2).reverse()) {
        if (row.role !== 'assistant') continue;
        const body = extractContent({ choices: [{ message: { content: row.content } }] }, false)
            .replace(/<[^>]*>/gu, '');
        for (const sentence of storySentences(body).reverse()) {
            if (/[“”「」『』"'？?]|据说|好像|仿佛|如果|假如|曾经|以前|梦见|梦里|回忆|打算|准备|将要/u.test(sentence)) continue;
            const clause = sentence.trim().match(/^([\p{Script=Han}]{1,12}?)(?:此刻|现在|刚刚)?(仍在|停在|站在|守在|等在|坐在|留在|抵达|来到|走进|回到|躲在|仍留在)([^，、；。！？]{2,32})(?:[，；。！？]|$)/u);
            if (clause) return '[第 ' + floorNumbers.get(row.id) + ' 楼] ' + clause[1] + ' · ' + clause[2] + clause[3].trim();
        }
    }
    return '';
}

const timeOfDay = '(?:凌晨|黎明|清晨|早晨|早上|上午|中午|下午|午后|傍晚|晚上|夜里|深夜|半夜)';
const date = '(?:[0-9]{4}年)?[0-9]{1,2}月[0-9]{1,2}日|[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}';
const count = '[一二三四五六七八九十百零两0-9]+';
const ritualTime = '(?:头七(?:(?:夜零点|子夜零点|子时|午夜|零点|时)?(?:阴阳)?交界(?:时)?|子时|前夜|当晚|当天|当夜|过后|之后|结束后|夜里|夜)?|(?:下葬|安葬|入殓|出殡)(?:之后|以前|前夜|当天|当夜|当晚|次日|后|前)|(?:去世|过世|死亡|死)后(?:第[一二三四五六七八九十百零两0-9]+[天日]|数日|几天|数天|翌日|次日|当晚|当夜)?)';
const season = '[春夏秋冬]日';
const day = `第${count}[天日]|${count}(?:天|日|周|个月|年|小时|分钟)(?:后|前)|翌日|次日|隔天|当天|当晚|今夜|昨日|昨天|今天|明天|后天|昨晚|前一天|${ritualTime}|${season}`;
const time = String.raw`(?:(?:${date}|${day})(?:(?:的)?(?:首个|第${count}个)?${season}${timeOfDay}|(?:的)?${timeOfDay})?|${timeOfDay})(?:\s*(?:[0-9]{1,2}:[0-9]{2}|${count}(?:点|时)(?:半|${count}分)?))?|[0-9]{1,2}:[0-9]{2}`;
const explicitTimes = new RegExp(time, 'gu');
// Relative milestones can naturally run into the subject without a comma.
const narrativeMilestone = new RegExp(String.raw`^\s*(?:(?!.*(?:打算|计划|预计|将要|还没|要到))([\p{Script=Han}]{2,8}?))?((?:${ritualTime})(?:(?:的)?(?:首个|第${count}个)?${season}${timeOfDay}|(?:的)?${timeOfDay})?)(?=$|[\s，,。！!？?；;：:、】\]]|[\p{Script=Han}])`, 'u');
const leadingTime = new RegExp(String.raw`^\s*(?:[【\[]|(?:剧情时间|时间)[:：]\s*)?(${time})(?=$|[\s，,。！!？?；;：:、】\]])`, 'u');

/** Read the scene's opening time. A time mentioned mid-paragraph may belong to a different event. */
export function storyTimeFromSource(source: string): string | undefined {
    const text = source.normalize('NFKC');
    const marked = text.match(leadingTime)?.[1];
    if (marked) return marked;
    const milestone = text.match(narrativeMilestone);
    return milestone && milestone[2] !== '头七' ? milestone[2] : undefined;
}

const storySentences = (text: string) => text.match(/[^。！？\r\n]+[。！？]?/gu) ?? [];

function unambiguousOpeningTime(source: string): string | undefined {
    const first = storyTimeFromSource(source);
    const otherTimes = storySentences(source).slice(1).map(storyTimeFromSource);
    return otherTimes.some(time => time && time !== first) ? undefined : first;
}

/** A standalone time heading can also label the immediately following floor. */
export function storyArchiveSourceTimes(rows: readonly { id: number; content: string; metadata?: { theaterContinue?: unknown } }[]): Map<number, string> {
    const times = new Map<number, string>();
    let heading: string | undefined;
    for (const row of rows) {
        if (row.metadata?.theaterContinue) continue;
        const time = unambiguousOpeningTime(row.content);
        const conflictingTimes = !time && storySentences(row.content).some(sentence => !!storyTimeFromSource(sentence));
        const sceneTime = time ?? (conflictingTimes ? undefined : heading);
        if (sceneTime) times.set(row.id, sceneTime);
        const rest = row.content.normalize('NFKC').replace(leadingTime, '').trim();
        heading = time && /^[\s，,。！!？?；;：:、】\]]*$/u.test(rest) ? time : undefined;
    }
    return times;
}

/** Older cards sometimes have a time in their text but no separate field. */
export function storyArchiveFactTime(
    fact: Pick<StoryArchiveFact, 'kind' | 'text' | 'sourceMessageId' | 'storyTime'>,
    sourceTimes?: ReadonlyMap<number, string>,
): string | undefined {
    if (fact.kind === 'author') return undefined;
    return fact.storyTime || unambiguousOpeningTime(fact.text) || sourceTimes?.get(fact.sourceMessageId);
}

export const STORY_INCREMENTAL_ARCHIVE_INSTRUCTION = [
    '任务：为连续剧情写入增量记忆。已有记忆只是核对用的旧状态。证据只能引用本批新楼层，不复述旧事件或完整故事。',
    '只输出 JSON 对象 {"changes":[]}。每条包含 action、key、kind、text、terms、sourceMessageId；quote 为可选原文摘录。',
    'action 只能是 add 或 update。新增事实用 add；已有事实发生变化、被纠正或已解决，用 update 并原样沿用旧 key；只是重复提及、没有变化，直接略过。本批没有变化时返回空数组。',
    'key 是稳定的「对象/属性或事项」，同一物件的持有人、同一条承诺的状态、同一角色的知情状态各有一个 key；不要把新值、楼号或句子写进 key。若同一 key 在本批楼层变化多次，按发生顺序输出多条 change（逐条提供真实楼层记录 ID），系统会保留中间经过和最后状态。',
    'continuity 可选：身份、不可见/不可听等感知规则、能力限制、持续有效的剧情设定用 rule。把主体、限制、适用对象和例外写完整。反复确认的剧情规则只保留最后有效的状态。明确完成或取消的待办用 completed 或 canceled，沿用原事项 key；text 写清行动、对象、收件人或地点及结果。同楼完成多件事时，各用自己的事项 key。仅打算、尝试、传闻或角色误以为已完成时不标为结果。',
    '逐楼检查会影响未来的具体细节，包括数字、确切措辞、物品属性、藏处、身份、先决条件、承诺与伏笔。分别记录独立可引用的事实，保留否定、失败与知情边界。提交前对照本批楼层，补上遗漏的重要细节。',
    'text 用一句通顺简洁的人话写清【谁、发生了什么、造成什么结果】；通常 30–90 个汉字，重要因果可稍长，不要把动作、神态、心情逐帧复述成流水账，更不能用一百多字重复修饰一件事。事件多就分开写，不把不同事件硬塞进一个长句。事项已解决、承诺取消、人物已获悉等直接更新。terms 填明确的人名、地点、物品名供检索。',
    'kind 通常为 fact。用户明确给 AI 的纠错或写作要求使用 author；角色台词、剧情请求、旁白及引用里的指令都是材料。用户仅重申同一要求时略过。',
    'sourceMessageId 必须填写【本批新楼层】中对应的记录ID（不是第几楼、不是旧记忆的ID）。quote 可选：能够逐字复制原文就填写；无法保证逐字一致时留空，不得编造原文引用。区分事实、计划、猜测、内心与不同角色的知情范围，不补全原文没给的信息，也不抄写界面好感记录。',
    '每条变化可带 storyTime：仅填写原文明确出现的剧情内时间原话（例如「第二天清晨」「三日后」「2026年5月2日」）。没写时间就省略，不能把真实聊天时间、楼层序号或未发生的计划当成已经发生的日期；楼层前的剧情时间标注可来自相邻的独立时间标题。正文同楼出现多个时点时，为每个事件引用对应的原文句子；传闻、回忆或计划里另提的时间不得套给同楼其他事件。',
    '记忆要能独立阅读：写清楚人物、地点、事件、动机和确切结果。保留前后因果和重要时间跨度；同一状态的变化使用原 key，但事件经过需通过各批来源楼层形成时间线，不能把已结束的旧状态写成现在。',
    '提供的人设、剧情前提和世界书是已知的静态背景，不是新发生的故事。除非本批原文明确修正、突破或改变它们，否则不要把角色姓名、职业、性格、身份、既定关系、世界规则重新存成剧情记忆；已有记忆中相同事实也不要重复。只提取会影响后续的新增事件、状态变化、重要因果、承诺/伏笔和用户明确纠正。相同事件在不同剧情时间再次发生时，用新的事件 key，并分别保留剧情时间。',
    '用户执笔身份和人物档案也是已有设定。不要记录「{{user}}全名、年龄、学历、与谁是亲属」等已列明的角色卡内容；别人首次得知身份、身份确实发生变化才记录发生了什么。不要把「剧情/进展」之类笼统的 key 用来连续覆盖不相干事件，必须用具体对象和事项。',
    '每条可填 modality：已确定发生的事实省略；尚未发生的计划、愿望、未来承诺用 planned；传闻、猜测、未知真伪的信息用 unverified。不能把计划/传闻改写成既成事实；后续有原文确认发生时更新同一 key，并去掉旧 modality。',
].join('\n');

export function storyArchiveFactIdentity(fact: StoryArchiveFact): string {
    return JSON.stringify([fact.key, fact.sourceMessageId, fact.kind, fact.text, storyArchiveModality(fact)]);
}

export function collectStoryArchiveFacts(
    archives: StoryTheaterArchive[], beforeId: number, vectorTexts: ReadonlyMap<string, string>,
    includeLastConfirmed = false,
): StoryArchiveFact[] {
    const current = new Map<string, StoryArchiveFact>();
    const confirmed = new Map<string, StoryArchiveFact>();
    const resolve = (fact: StoryArchiveFact) => {
        if (fact.vectorTextState === 'deleted') return undefined;
        // Only use vector text checked against the live node or persisted archive.
        const text = fact.vectorNodeId ? vectorTexts.get(fact.vectorNodeId) : fact.text;
        return text?.trim() ? { ...fact, text } : undefined;
    };
    for (const archive of archives.filter(item => item.toMessageId < beforeId).sort((a, b) => a.toMessageId - b.toMessageId)) {
        if (includeLastConfirmed) {
            for (const fact of [...(archive.historyFacts ?? []), ...(archive.facts ?? [])]) {
                if (fact.kind !== 'fact') continue;
                if (fact.vectorTextState === 'deleted') {
                    confirmed.delete(fact.key);
                    continue;
                }
                const resolved = resolve(fact);
                if (resolved && !storyArchiveModality(resolved)
                    && resolved.sourceMessageId >= (confirmed.get(resolved.key)?.sourceMessageId ?? -Infinity)) {
                    confirmed.set(resolved.key, resolved);
                }
            }
        }
        for (const fact of archive.facts ?? []) current.set(fact.key, fact);
    }
    return [...current.values()].flatMap(fact => {
        const resolved = resolve(fact);
        if (!resolved) return [];
        const previous = includeLastConfirmed && storyArchiveModality(resolved) ? confirmed.get(resolved.key) : undefined;
        return previous ? [previous, resolved] : [resolved];
    });
}

export function rankStoryArchiveFacts(
    facts: StoryArchiveFact[], query: string, semanticRank: ReadonlyMap<string, number> = new Map(),
    sourceTimes?: ReadonlyMap<number, string>,
): StoryArchiveFact[] {
    const text = normalize(query);
    const matchingTerms = facts.map(fact => [...new Set([...fact.terms, storyArchiveFactTime(fact, sourceTimes) ?? ''].map(normalize))]
        .filter(term => term.length >= 2 && text.includes(term)));
    const frequency = new Map<string, number>();
    for (const terms of matchingTerms) for (const term of terms) {
        frequency.set(term, (frequency.get(term) ?? 0) + 1);
    }
    const bySemanticMatch = (fact: StoryArchiveFact) => semanticRank.get(fact.vectorNodeId ?? storyArchiveFactIdentity(fact)) ?? Number.MAX_SAFE_INTEGER;
    return facts.map((fact, index) => {
        const terms = matchingTerms[index];
        const distinctive = terms.reduce((score, term) => frequency.get(term)! <= Math.max(2, facts.length * 0.15)
            ? Math.max(score, term.length / frequency.get(term)!) : score, 0);
        return { fact, distinctive, matches: terms.length };
    }).sort((a, b) => Number(b.fact.kind === 'author') - Number(a.fact.kind === 'author')
        || Number(storyArchiveContinuityKind(b.fact) === 'rule') - Number(storyArchiveContinuityKind(a.fact) === 'rule')
        || b.distinctive - a.distinctive || bySemanticMatch(a.fact) - bySemanticMatch(b.fact)
        || b.matches - a.matches || b.fact.sourceMessageId - a.fact.sourceMessageId).map(item => item.fact);
}

// Normalize only Unicode form and whitespace when checking a verbatim quote.
const comparableQuote = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
const quoteExistsIn = (source: string, quote: string) =>
    source.includes(quote) || comparableQuote(source).includes(comparableQuote(quote));

function decodeArchiveChanges(raw: string): unknown {
    const trimmed = raw.replace(/^\uFEFF/, '').trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const input = fence ? fence[1].trim() : trimmed;
    try {
        return JSON.parse(input);
    } catch {
        // Some OpenAI-compatible models add a short introduction after a complete
        // JSON object. Extract ONE balanced object, without repairing incomplete JSON.
        const begin = input.indexOf('{');
        if (begin < 0) throw new Error('无 JSON 对象');
        let depth = 0, quoted = false, escaped = false;
        for (let i = begin; i < input.length; i++) {
            const char = input[i];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
            } else if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) return JSON.parse(input.slice(begin, i + 1));
        }
        throw new Error('JSON 对象不完整');
    }
}

/** Conservative, source-preserving static-reference overlap test. A role profile
 * only wins for truly static descriptions; story discoveries and changed
 * relationships remain eligible for archiving and recall.
 */
export function storyArchiveRepeatsPreset(text: string, key: string, baseline: string, source = ''): boolean {
    if (/(?:得知|发现|揭露|确认|改名|成为|变成|身份暴露|认出|辞去|不再)/u.test(source + text)) return false;
    const profileWording = (value: string) => comparable(value)
        .replace(/(?:的职业|的身份|的职务)(?:为|是)/gu, '是')
        .replace(/(?:职业|职务)(?:为|是)/gu, '是');
    const fact = profileWording(text);
    const staticSentences = baseline.split(/[。！？；\n]/u).map(profileWording).filter(line => line.length >= 5);
    if (fact.length >= 5 && staticSentences.some(line => line === fact || line.endsWith(fact))) return true;
    if (!/(?:姓名|年龄|身份|背景|学历|家庭|亲属|关系|基本信息|人设)/u.test(key)
        && !/(?:\{\{user\}\}|(?:全名|现年|年龄|大学毕业|亲妹妹|亲哥哥|亲姐姐|亲弟弟))/iu.test(text)) return false;
    if (!/(?:全名|现年|年龄|大学毕业|亲妹妹|亲哥哥|亲姐姐|亲弟弟|职业是)/u.test(text)
        || /(?:得知|发现|揭露|确认|改名|成为|变成|身份暴露|认出)/u.test(source + text)) return false;
    const values = [
        text.match(/(?:全名(?:为|是)|名字叫|名叫)\s*([\p{L}]{2,8})/u)?.[1],
        text.match(/\d{1,3}\s*岁/u)?.[0],
        ...[...text.matchAll(/([\p{L}]{2,8})(?:的亲|的)?(?:妹妹|哥哥|姐姐|弟弟|父亲|母亲)/gu)]
            .map(match => match[1]),
    ].filter((value): value is string => Boolean(value));
    const body = comparable(baseline);
    return [...new Set(values.map(value => comparable(value)))].filter(value => value && body.includes(value)).length >= 2;
}

/** Read-time suppression for older archives: never delete saved data, only avoid
 * repeating static role/worldbook sentences already injected by the preset.
 * A key whose story state changed remains visible even if it later reverted.
 */
export function filterStoryArchiveBaselineRepeats(
    facts: StoryArchiveFact[], archives: StoryTheaterArchive[], baseline: string,
): StoryArchiveFact[] {
    if (!baseline.trim()) return facts;
    const variants = new Map<string, Set<string>>();
    for (const box of archives) for (const fact of box.facts ?? []) {
        const values = variants.get(fact.key) ?? new Set<string>();
        values.add(comparable(fact.text));
        variants.set(fact.key, values);
    }
    return facts.filter(fact => {
        if (fact.kind === 'author' || storyArchiveContinuityKind(fact) === 'rule' || (variants.get(fact.key)?.size ?? 0) > 1) return true;
        return !storyArchiveRepeatsPreset(fact.text, fact.key, baseline);
    });
}

// Explicit labelled codes are checkable without guessing what a model meant.
const archivedCodePattern = /(回执(?:编号|号码|号)|登记(?:编号|号码|号)|门禁(?:密码|口令)|校验码|识别码|序列号|通行码|档案编号)\s*(?:是|为|改为|[:：])?\s*([A-Z0-9][A-Z0-9-]{2,23})(?![A-Z0-9-])/giu;
function storyArchiveCodes(text: string) {
    return [...text.normalize('NFKC').matchAll(archivedCodePattern)].map(match => ({
        phrase: match[0],
        label: match[1].replace(/^回执(?:号码|号)$/u, '回执编号').replace(/^登记(?:号码|号)$/u, '登记编号')
            .replace(/^门禁口令$/u, '门禁密码'),
        value: match[2].toUpperCase(),
    })).filter(code => /[0-9]/u.test(code.value));
}

export class StoryArchiveIncompleteReply extends Error {}

export function parseStoryArchiveChanges(
    raw: string, sources: ReadonlyMap<number, { text: string; authorInput: boolean; floorNumber?: number }>, known: StoryArchiveFact[], baseline = '',
    onEarlierState?: (fact: StoryArchiveFact) => void, sourceTimes?: ReadonlyMap<number, string>,
): StoryArchiveFact[] {
    const invalid = (detail: string) => new Error(`增量归档格式或来源无效（${detail}），原文和旧归档已保留`);
    let value: unknown;
    try {
        value = decodeArchiveChanges(raw);
    } catch {
        throw new StoryArchiveIncompleteReply('模型没有返回完整的 changes JSON');
    }
    if (!value || typeof value !== 'object' || !('changes' in value) || !Array.isArray(value.changes)) {
        throw new StoryArchiveIncompleteReply('模型没有返回 changes 数组');
    }
    const existing = new Map(known.map(fact => [fact.key, fact]));
    const signature = (fact: Pick<StoryArchiveFact, 'kind' | 'text' | 'storyTime' | 'modality'>) =>
        JSON.stringify([fact.kind, comparable(fact.text), fact.storyTime ?? '', fact.modality ?? '']);
    const duplicateText = new Set(known.map(signature));
    // Only skip a new fact that repeats a whole existing role/worldbook
    // sentence. Do NOT reject changed states on semantic similarity.
    const facts = new Map<string, StoryArchiveFact>();
    for (const [index, change] of value.changes.entries()) {
        if (!change || typeof change.key !== 'string' || typeof change.text !== 'string'
            || !['fact', 'author', undefined].includes(change.kind)
            || !['add', 'update', undefined].includes(change.action)
            || (change.quote !== undefined && typeof change.quote !== 'string')
            || (change.storyTime !== undefined && typeof change.storyTime !== 'string')
            || (change.terms !== undefined && (!Array.isArray(change.terms)
                || !change.terms.every((term: unknown) => typeof term === 'string')))) {
            throw invalid(`第 ${index + 1} 条字段不完整`);
        }
        let key = normalize(change.key).replace(/\s+/g, '');
        let text = change.text.trim();
        const kind: 'fact' | 'author' = change.kind ?? 'fact';
        let modality = kind === 'fact' && (change.modality === 'planned' || change.modality === 'unverified')
            ? change.modality as 'planned' | 'unverified' : undefined;
        if (!/^[\p{L}\p{N}\p{M}\p{P}\p{S}]{2,120}$/u.test(key) || !comparable(text)) {
            throw invalid(`第 ${index + 1} 条记忆键或正文为空/不合法`);
        }
        const quote = typeof change.quote === 'string' ? change.quote.trim() : '';
        const sourceToken = String(change.sourceMessageId ?? '').trim();
        const floorRef = /^第\s*(\d+)\s*楼$/.exec(sourceToken);
        const sourceRef = /^(?:记录ID\s*)?(\d+)$/.exec(sourceToken);
        const providedId = Number((floorRef ?? sourceRef)?.[1]);
        const direct = !floorRef && Number.isSafeInteger(providedId) ? sources.get(providedId) : undefined;
        const floor = [...sources.entries()].find(([, source]) => source.floorNumber === providedId);
        const candidates = quote ? [...sources.entries()].filter(([, source]) => quoteExistsIn(source.text, quote)) : [];
        // Original records, not model-written quote strings, are the evidence.
        // A model may return an ordinal floor number rather than a database ID.
        // Match those only against the current batch's actual floor mapping.
        // A uniquely matching verbatim quote is stronger evidence than an ID
        // guessed by a smaller model. When the quote is paraphrased or omitted,
        // trust the valid direct source ID instead.
        const selected = candidates.length === 1 ? candidates[0]
            : direct ? [providedId, direct] as const
            : floorRef && floor ? floor
            : floorRef || sourceRef ? floor : undefined;
        if (!selected) throw invalid(`第 ${index + 1} 条没有有效的原文记录ID`);
        const [sourceMessageId, source] = selected;
        // An umbrella key causes unrelated scenes to overwrite each other and
        // creates huge fake "state transitions" (the exact video symptom).
        if (/^(?:剧情|故事|事件|情节|主线|进度)[\/：:](?:进展|发展|事件|经历|内容|动态|记录|状态)$/u.test(key)) {
            key = '独立事件/来源' + sourceMessageId + '/' + index;
        }
        if (kind === 'author' && !source.authorInput) {
            throw invalid(`第 ${index + 1} 条作者指令不是用户输入`);
        }
        // A quote anchors the actual clause, even when the model copies another clause's date.
        const quotedClauses = quote && quoteExistsIn(source.text, quote)
            ? storySentences(source.text).filter(clause => quoteExistsIn(clause, quote)) : [];
        const quotedClause = quotedClauses.length === 1 ? quotedClauses[0] : undefined;
        const claimedTime = typeof change.storyTime === 'string' ? change.storyTime.normalize('NFKC').trim() : '';
        const citedTimes = quotedClause && claimedTime
            ? new Set(quotedClause.normalize('NFKC').match(explicitTimes) ?? []) : undefined;
        const verifiedTime = citedTimes?.size === 1 && citedTimes.has(claimedTime) ? claimedTime : undefined;
        const storyTime = kind === 'fact'
            ? (quotedClause && storyTimeFromSource(quotedClause)) || verifiedTime
                || unambiguousOpeningTime(source.text) || sourceTimes?.get(sourceMessageId)
            : undefined;
        if (kind === 'fact') {
            const evidence = quotedClause ?? source.text;
            const evidenceModality = quotedClause || storySentences(source.text).length === 1
                ? storyArchiveModality({ text: evidence }) : undefined;
            modality = evidenceModality ?? modality;
            const codeClaims = storyArchiveCodes(text);
            let unsupportedCode = false;
            for (const claim of codeClaims) {
                const citedCodes = storyArchiveCodes(evidence).filter(code => code.label === claim.label);
                const sourceCodes = citedCodes.length ? citedCodes
                    : storyArchiveCodes(source.text).filter(code => code.label === claim.label);
                const values = [...new Set(sourceCodes.map(code => code.value))];
                if (values.length === 1 && values[0] !== claim.value) {
                    const sourceCode = sourceCodes[0];
                    text = text.includes(claim.phrase)
                        ? text.replace(claim.phrase, sourceCode.phrase)
                        : text.normalize('NFKC').replace(claim.phrase, sourceCode.phrase);
                } else if (!source.text.normalize('NFKC').toUpperCase().match(/[A-Z0-9-]+/g)?.includes(claim.value)) {
                    unsupportedCode = true;
                    break;
                }
            }
            if (unsupportedCode) continue;
        }
        const knownState = facts.get(key) ?? existing.get(key);
        if (kind === 'fact' && change.action === 'add' && storyTime && knownState?.storyTime
            && knownState.storyTime !== storyTime && comparable(knownState.text) === comparable(text)) {
            key += '/来源' + sourceMessageId;
        }
        const previous = existing.get(key);
        if (previous && previous.kind !== kind) throw invalid(`第 ${index + 1} 条改变了已有记忆类型`);
        const continuity = kind === 'fact' && !modality
            ? storyArchiveContinuityKind({ kind, text, continuity: change.continuity })
                ?? (previous?.continuity === 'rule' ? 'rule' : undefined)
            : undefined;
        const fact = { key, kind, text, sourceMessageId, ...(storyTime ? { storyTime } : {}),
            ...(modality ? { modality } : {}), ...(continuity ? { continuity } : {}) };
        const comparableText = signature(fact);
        const oldInBatch = facts.get(key);
        if (oldInBatch && oldInBatch.sourceMessageId > sourceMessageId) continue;
        if (oldInBatch && signature(oldInBatch) === comparableText) continue;
        const sameState = previous && comparable(previous.text) === comparable(text) && storyArchiveModality(previous) === storyArchiveModality(fact);
        if (sameState && !oldInBatch && change.action !== 'add') continue;
        if (duplicateText.has(comparableText) && !oldInBatch && (!previous || sameState)) continue;
        if (!previous && kind === 'fact' && continuity !== 'rule' && storyArchiveRepeatsPreset(text, key, baseline, quotedClause ?? source.text)) continue;
        const termCandidates: string[] = change.terms ?? key.split(/[\/：:·-]+/u);
        const terms = [...new Set<string>(termCandidates.map(term => normalize(term)).filter(term => term.length >= 2))];
        if (oldInBatch && oldInBatch.kind === 'fact' && kind === 'fact'
            && (oldInBatch.text !== text || storyArchiveModality(oldInBatch) !== storyArchiveModality(fact))) onEarlierState?.(oldInBatch);
        facts.set(key, { ...fact, terms });
        duplicateText.add(comparableText);
    }
    // Preserve a missed exact detail as a sourced one-line fact. Only single,
    // unambiguous assertions qualify; plans, quotes and multi-value comparisons
    // stay in the original floors for contextual retrieval.
    const recordedCodes = new Set([...known, ...facts.values()].flatMap(fact =>
        storyArchiveCodes(fact.text).map(code => code.label + '/' + code.value)));
    for (const [sourceMessageId, source] of sources) {
        for (const sentence of storySentences(source.text)) {
            const codes = storyArchiveCodes(sentence);
            if (codes.length !== 1 || sentence.length > 150 || storyArchiveModality({ text: sentence })
                || /[“”「」"'？?]|(?:计划|猜测|传闻|听说|据说|也许|可能|假如|如果|尚未|旧版|作废|撤销|取消|并非|不是|不再|之前|曾经|有人说|改为|更正|修正)/u.test(sentence)) continue;
            const [code] = codes;
            if (!/[:：]|(?:是|为|改为)\s*[A-Z0-9]/iu.test(code.phrase)) continue;
            const identity = code.label + '/' + code.value;
            if (recordedCodes.has(identity) || storyArchiveRepeatsPreset(sentence, code.label, baseline)) continue;
            const key = '剧情凭据/' + identity;
            const storyTime = storyTimeFromSource(sentence) || sourceTimes?.get(sourceMessageId);
            const text = sentence.replace(leadingTime, '').replace(/^[\s，,：:、】\]]+/u, '').trim();
            facts.set(key, { key, kind: 'fact', text, terms: [code.label, code.value],
                sourceMessageId, ...(storyTime ? { storyTime } : {}) });
            recordedCodes.add(identity);
        }
    }
    const sourceRows = [...sources].map(([id, source]) => ({
        id, content: source.text, role: source.authorInput ? 'user' : 'assistant',
    }));
    const recordedRules = new Set([...facts.values()].filter(fact => storyArchiveContinuityKind(fact) === 'rule')
        .map(fact => fact.sourceMessageId));
    for (const fact of storyContinuitySources(sourceRows, [...known, ...facts.values()])) {
        if (fact.continuity !== 'rule' || recordedRules.has(fact.sourceMessageId)) continue;
        facts.set(fact.key, { ...fact, storyTime: sourceTimes?.get(fact.sourceMessageId) });
    }
    return [...facts.values()];
}

function clipStoryMemoryText(text: string, limit: number): string {
    if (limit <= 0) return '';
    if (text.length <= limit) return text;
    return text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, '').trimEnd() + '…';
}

function storyArchiveFactLines(
    facts: StoryArchiveFact[], floorNumbers?: ReadonlyMap<number, number>, budget = Infinity,
    sourceTimes?: ReadonlyMap<number, string>, timelineStatus?: 'current' | 'past',
) {
    let used = 0;
    const selected: { fact: StoryArchiveFact; line: string }[] = [];
    for (const fact of facts) {
        const floor = floorNumbers?.get(fact.sourceMessageId);
        const storyTime = storyArchiveFactTime(fact, sourceTimes);
        const annotation = [
            ...(floor ? ['第 ' + floor + ' 楼'] : timelineStatus ? ['来源楼层缺失'] : []),
            ...(storyTime ? ['剧情时间：' + storyTime] : []),
        ];
        const modality = storyArchiveModality(fact);
        const status = timelineStatus === 'past' ? '【旧状态】'
            : timelineStatus === 'current' && fact.kind !== 'author' && !modality ? '【已发生】' : '';
        const qualifier = fact.kind === 'author' ? '用户协助指令：'
            : modality === 'planned' ? '【尚未发生的计划】' : modality === 'unverified' ? '【尚未核实的说法】' : '';
        const line = (annotation.length ? '[' + annotation.join(' · ') + '] ' : '') + status + qualifier + fact.text;
        if (used + line.length >= budget && selected.length) continue;
        const withinBudget = clipStoryMemoryText(line, budget - used);
        if (!withinBudget) break;
        selected.push({ fact, line: withinBudget });
        used += withinBudget.length + 1;
    }
    return selected;
}

/** Relevant facts are chosen first; the selected facts can then be sent in source order. */
export function formatStoryArchiveFacts(
    facts: StoryArchiveFact[], floorNumbers?: ReadonlyMap<number, number>, budget = Infinity,
    chronological = false, sourceTimes?: ReadonlyMap<number, string>,
): string {
    const selected = storyArchiveFactLines(facts, floorNumbers, budget, sourceTimes);
    if (chronological) selected.sort((a, b) => a.fact.sourceMessageId - b.fact.sourceMessageId);
    return selected.map(item => item.line).join('\n');
}

function storyArchiveRecallSections(facts: StoryArchiveFact[]) {
    return [
        {
            title: '已确认的剧情事实（仅表示已经发生，不要求再次发生）',
            entries: facts.filter(fact => fact.kind === 'fact' && !storyArchiveModality(fact)),
            budget: 3200,
        },
        {
            title: '尚未发生的计划和承诺（不是已完成事件）',
            entries: facts.filter(fact => storyArchiveModality(fact) === 'planned'),
            budget: 580,
        },
        {
            title: '未经证实的信息（不能当成已知真相）',
            entries: facts.filter(fact => storyArchiveModality(fact) === 'unverified'),
            budget: 500,
        },
        {
            title: '用户明确提出的写作要求',
            entries: facts.filter(fact => fact.kind === 'author'),
            budget: 800,
        },
    ];
}

export function storyArchiveNeedsRanking(
    facts: StoryArchiveFact[], floorNumbers: ReadonlyMap<number, number>, sourceTimes: ReadonlyMap<number, string>,
    timeline = false, activeCost = 0,
): boolean {
    return storyArchiveRecallSections(facts).some(({ entries, budget }) =>
        entries.length > 1 && storyArchiveFactLines(entries, floorNumbers, Infinity, sourceTimes, timeline ? 'current' : undefined)
            .reduce((size, item) => size + item.line.length + 1, 0) > budget - (budget === 3200 ? activeCost : 0));
}

/** Select relevant facts within each section's budget, then send them in floor order. */
export function formatStoryArchiveProseContext(
    facts: StoryArchiveFact[], query: string,
    floorNumbers?: ReadonlyMap<number, number>,
    semanticRank: ReadonlyMap<string, number> = new Map(),
    sourceTimes?: ReadonlyMap<number, string>, active?: ReturnType<typeof formatStoryArchiveActiveState>,
): string {
    const sections = storyArchiveRecallSections(facts).map(({ title, entries, budget }) => {
        if (!entries.length) return '';
        const text = formatStoryArchiveFacts(
            rankStoryArchiveFacts(entries.filter(fact => !active?.selected.has(storyArchiveFactIdentity(fact))),
                query, semanticRank, sourceTimes), floorNumbers, budget === 3200 ? budget - (active?.cost ?? 0) : budget, true, sourceTimes,
        );
        return text ? '【' + title + '】\n' + text : '';
    });
    return [active?.text, ...sections].filter(Boolean).join('\n\n');
}

/** Structured independent vectors share one source order across fact categories and old states. */
export function formatStoryArchiveRecallTimeline(
    facts: StoryArchiveFact[], historical: StoryArchiveFact[], query: string,
    floorNumbers: ReadonlyMap<number, number>, semanticRank: ReadonlyMap<string, number>,
    sourceTimes: ReadonlyMap<number, string>, active?: ReturnType<typeof formatStoryArchiveActiveState>,
    relatedKeys: ReadonlySet<string> = new Set(),
): string {
    const lines = storyArchiveRecallSections(facts).flatMap(({ entries, budget }) =>
        storyArchiveFactLines(rankStoryArchiveFacts(entries.filter(fact => !active?.selected.has(storyArchiveFactIdentity(fact))),
            query, semanticRank, sourceTimes), floorNumbers, budget === 3200 ? budget - (active?.cost ?? 0) : budget,
            sourceTimes, 'current'));
    const selectedKeys = new Set([...lines.map(item => item.fact.key), ...facts.filter(fact =>
        active?.selected.has(storyArchiveFactIdentity(fact))).map(fact => fact.key)]);
    const currentIdentities = new Set(facts.map(storyArchiveFactIdentity));
    lines.push(...storyArchiveFactLines(historical.filter(fact => (selectedKeys.has(fact.key) || relatedKeys.has(fact.key)) && !currentIdentities.has(storyArchiveFactIdentity(fact))),
        floorNumbers, Infinity, sourceTimes, 'past'));
    const timeline = lines.sort((a, b) =>
        (floorNumbers.get(a.fact.sourceMessageId) ?? Number.MAX_SAFE_INTEGER)
        - (floorNumbers.get(b.fact.sourceMessageId) ?? Number.MAX_SAFE_INTEGER),
    ).map(item => item.line).join('\n');
    return [active?.text, timeline].filter(Boolean).join('\n\n');
}

/** Pull a small, verbatim fallback only when archived text can add evidence. */
export function findStoryArchiveEvidence(
    rows: readonly { id: number; content: string; role?: string }[], archives: StoryTheaterArchive[], beforeId: number,
    query: string, alreadySent: string, baseline: string, floorNumbers: ReadonlyMap<number, number>,
    closedPlans: StoryArchiveFact[] = [], relatedByFloor: ReadonlyMap<number, readonly string[]> = new Map(),
): string {
    const known = normalize(alreadySent);
    const knownLines = known.split('\n');
    const needles = new Set<string>();
    const searchText = normalize(query).slice(-2000)
        .replace(/(?:什么时候|什么时间|什么地方|怎么回事|怎么样|怎么做|分别是什么|分别是|能不能|可不可以|是不是|有没有|请确认|请告诉|请区分|后来怎么样)/gu, ' ');
    for (const span of searchText.match(/\p{Script=Han}{4,}|[a-z0-9]{4,}/gu) ?? []) {
        if (/^[a-z0-9]+$/u.test(span)) needles.add(span);
        else for (let i = 0; i <= span.length - 4; i++) needles.add(span.slice(i, i + 4));
    }
    if (!needles.size && !relatedByFloor.size) return '';
    const boxes = archives.filter(box => box.toMessageId < beforeId && (box.strategy === 'summary' || box.facts));
    if (!boxes.length) return '';
    const deletedSources = new Set(boxes.flatMap(box =>
        (box.facts ?? []).filter(fact => fact.vectorTextState === 'deleted').map(fact => fact.sourceMessageId)));
    const hits: { id: number; excerpt: string; score: number }[] = [];
    for (const row of rows) {
        if (deletedSources.has(row.id) || !boxes.some(box => box.fromMessageId <= row.id && row.id <= box.toMessageId)) continue;
        const content = extractContent({ choices: [{ message: { content: row.content } }] }, false);
        for (const sentence of storySentences(content)) {
            if (closedPlans.some(plan => plan.sourceMessageId === row.id
                && (comparable(sentence).includes(comparable(plan.text))
                    || (storyArchiveModality({ text: sentence }) === 'planned'
                        && storyActionSignatures(sentence).some(task => storyActionSignatures(plan.text).some(item =>
                            item.verb === task.verb && item.object === task.object)))))) continue;
            const text = normalize(sentence);
            if (known.includes(text) || /[？?]$/u.test(text)
                || (row.role === 'user' && /^(?:请|问|核对|看看|检查|告诉|确认|向.{1,12}确认)/u.test(text))) continue;
            const body = text.replace(leadingTime, '').replace(/^[\s，,：:、】\]]+/u, '');
            const floor = floorNumbers.get(row.id);
            if (body !== text && floor !== undefined
                && knownLines.some(line => line.startsWith('[第 ' + floor + ' 楼') && line.includes(body))) continue;
            const codes = storyArchiveCodes(text);
            if (codes.length && codes.every(code => known.includes(code.value.toLowerCase()))) {
                const lastCode = normalize(codes[codes.length - 1].phrase);
                const rest = text.slice(text.lastIndexOf(lastCode) + lastCode.length);
                if (![...needles].some(word => rest.includes(word) && !known.includes(word))) continue;
            }
            let score = 0;
            let offset = -1;
            for (const word of needles) {
                const index = text.indexOf(word);
                if (index < 0) continue;
                score++;
                if (offset < 0 || index < offset) offset = index;
            }
            for (const term of relatedByFloor.get(row.id) ?? []) {
                const index = text.indexOf(normalize(term));
                if (index < 0) continue;
                score += 0.5;
                if (offset < 0 || index < offset) offset = index;
            }
            if (!score || storyArchiveRepeatsPreset(sentence, '', baseline)) continue;
            const start = Math.max(0, offset - 32);
            const excerpt = (start ? '…' : '') + sentence.slice(start, start + 128).trim()
                + (sentence.length > start + 128 ? '…' : '');
            hits.push({ id: row.id, excerpt, score });
        }
    }
    const seen = new Set<string>();
    const usedFloors = new Set<number>();
    return hits.sort((a, b) => b.score - a.score || b.id - a.id).filter(hit => {
        if (seen.has(hit.excerpt) || usedFloors.has(hit.id)) return false;
        seen.add(hit.excerpt);
        usedFloors.add(hit.id);
        return true;
    }).slice(0, 2).sort((a, b) => a.id - b.id)
        .map(hit => `[第 ${floorNumbers.get(hit.id)} 楼] ${hit.excerpt}`).join('\n');
}

/** One readable timeline for a single archive. Old events and end-of-segment
 * facts are sorted TOGETHER; printing the two arrays separately falsely makes
 * an event from floor 9 look older than a fact extracted from floor 1.
 */
export function storyArchiveReadableLines(
    archive: StoryTheaterArchive,
    floorNumbers?: ReadonlyMap<number, number>,
    sourceTimes?: ReadonlyMap<number, string>,
): string[] {
    if (!archive.facts && !archive.historyFacts) return archive.summary ? [archive.summary] : [];
    const ordered = [
        ...(archive.historyFacts ?? []).map(fact => ({ fact, phase: '历史' })),
        ...(archive.facts ?? []).map(fact => ({ fact, phase: '本段' })),
    ].sort((a, b) => a.fact.sourceMessageId - b.fact.sourceMessageId);
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const { fact, phase } of ordered) {
        const sig = [fact.sourceMessageId, comparable(fact.text), fact.kind].join(':');
        if (seen.has(sig) || fact.vectorTextState === 'deleted') continue;
        seen.add(sig);
        const body = formatStoryArchiveFacts([fact], floorNumbers, Infinity, false, sourceTimes);
        lines.push(phase === '历史' ? '（历史记录）' + body : '（本段记录）' + body);
    }
    if (archive.affinityLog?.length) lines.push('界面关系变化：' + archive.affinityLog.join('；'));
    return lines;
}

/** Keep important earlier states as a clearly labelled historical sequence.
 * The latest state is supplied separately, so old facts cannot overwrite it.
 */
export function selectStoryArchiveTransitions(
    archives: StoryTheaterArchive[], beforeId: number,
    floorNumbers: ReadonlyMap<number, number>, sourceTimes?: ReadonlyMap<number, string>, budget = 1400,
    query = '', baseline = '', timelineLabels = false, relatedKeys: ReadonlySet<string> = new Set(),
): StoryArchiveFact[] {
    const timeline = archives.filter(box => box.toMessageId < beforeId)
        .sort((a, b) => a.toMessageId - b.toMessageId)
        .flatMap(box => [...(box.historyFacts ?? []), ...(box.facts ?? [])])
        .filter(fact => fact.kind === 'fact' && fact.vectorTextState !== 'deleted'
            && (!baseline || !storyArchiveRepeatsPreset(fact.text, fact.key, baseline)))
        .sort((a, b) => a.sourceMessageId - b.sourceMessageId);
    const newer = new Map<string, string>();
    const earlier: StoryArchiveFact[] = [];
    for (let i = timeline.length - 1; i >= 0; i--) {
        const fact = timeline[i];
        const value = comparable(fact.text);
        const next = newer.get(fact.key);
        if (next !== undefined && next !== value) earlier.push(fact);
        newer.set(fact.key, value);
    }
    let used = 0;
    const selected: StoryArchiveFact[] = [];
    // Palace-style: choose relevant older evidence before applying the budget.
    // Afterwards restore chronological order so the model does not confuse
    // retrieval ranking with the actual order of events.
    const normalizedQuery = normalize(query);
    const directMatches = earlier.filter(fact => relatedKeys.has(fact.key)
        || (normalizedQuery && fact.terms.some(term => {
            const token = normalize(term);
            return token.length >= 2 && normalizedQuery.includes(token);
        })));
    // Do not flood the current scene with unrelated old states merely because
    // they are recent. A vague continuation gets at most the most recent two.
    const priority = directMatches.length
        ? rankStoryArchiveFacts(directMatches, query)
        : query.trim() ? earlier.slice(0, 2) : earlier;
    for (const { fact, line } of storyArchiveFactLines(priority, floorNumbers, Infinity, sourceTimes, timelineLabels ? 'past' : undefined)) {
        if (used + line.length + 1 > budget) continue;
        selected.push(fact);
        used += line.length + 1;
    }
    return selected;
}

export function formatStoryArchiveTransitions(
    archives: StoryTheaterArchive[], beforeId: number,
    floorNumbers: ReadonlyMap<number, number>, sourceTimes?: ReadonlyMap<number, string>, budget = 1400,
    query = '', baseline = '',
): string {
    const selected = selectStoryArchiveTransitions(archives, beforeId, floorNumbers, sourceTimes, budget, query, baseline);
    return formatStoryArchiveFacts(selected, floorNumbers, Infinity, true, sourceTimes);
}
