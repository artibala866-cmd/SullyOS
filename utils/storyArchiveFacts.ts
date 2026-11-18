import type { StoryArchiveEntity, StoryArchiveFact, StoryTheaterArchive } from '../types';
import { extractContent } from './safeApi';

const normalize = (text: string) => text.normalize('NFKC').trim().toLowerCase();
const comparable = (text: string) => normalize(text).replace(/[\p{P}\p{Z}\s]/gu, '');

/** Backward-compatible reading only: older saves have no modality field.
 * Classify explicit future intention and hearsay conservatively; keep the
 * actual memory wording and stored vector bytes unchanged.
 */
export function storyArchiveModality(fact: Pick<StoryArchiveFact, 'text' | 'modality' | 'continuity'>):
    'planned' | 'unverified' | undefined {
    if (fact.modality) return fact.modality;
    if (fact.continuity === 'completed' || fact.continuity === 'canceled') return undefined;
    const text = fact.text;
    const hearsay = /(?:据说|传闻|听说|怀疑|猜测|尚未证实|未经证实|无人证实|尚未核实|未经验证|未确认|没(?:有)?确认|有待确认|可能存在)/u;
    const negativeVerification = /(?:尚未|还没(?:有)?|没有|未能|尚待)(?:最终|已经|明确)?(?:确认|证实|核实|查明|验证)/u;
    if (hearsay.test(text) || negativeVerification.test(text)) {
        // A report can mention a verification inside the rumor itself. A
        // separate affirmative clause is needed to mark that report resolved.
        const resolved = text.split(/[，,；;。！？\n]/u).some(clause =>
            /(?:最终证实|已经证实|查明真相|明确证实|证据表明|(?:最终|已经|明确)验证)/u.test(clause)
            && !hearsay.test(clause) && !negativeVerification.test(clause));
        const assertion = text.replace(/[，,；;。]\s*(?:此前|先前|之前|原先|当时)的?(?:传闻|猜测)(?:[^。！？\n]*)[。！？]?$/u, '');
        const confirmed = /(?:确认(?:了|为|属实|正常|无误|安全|有效)|核实(?:了|为|属实|无误)|查明|证实)/u;
        const explainsPriorRumor = assertion !== text && confirmed.test(assertion)
            && !hearsay.test(assertion) && !negativeVerification.test(assertion);
        if (!resolved && !explainsPriorRumor) return 'unverified';
    }
    // A past route plan followed by an actual reroute is history, not an
    // outstanding intention. Future/planned reroutes still stay planned.
    const rerouted = /(?:原计划|原本打算|原先打算|最初计划)[^。！？]*[，,；;](?:遂|于是|因此|因而|最终|随后|后来)(?:改走|改道|绕道)/u.test(text);
    const intends = /(?:打算|计划|准备于|准备在|决定.{0,55}(?:后|前|以后|之后|明天|下周|改天)|承诺.{0,35}(?:以后|明天|今后|将来|下周)|将要|拟于)/u.test(text);
    if (!rerouted && (intends || /(?:^|[：:，,。])\s*(?:待办|下一步|接下来要|尚需|还需要|约好要|答应要)/u.test(text)) && !/(?:计划已经完成|计划已完成|打算已取消|放弃计划|取消计划|终于做到了|最终完成|随后已经前往|后来已经前往)/u.test(text)) return 'planned';
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
const uncertainStoryOutcome = /(?:如果|假如|要是|假设|(?:^|[，。；：])若|据说|听说|传闻|怀疑|猜测|预计|也许|可能|梦见|(?:想(?:要)?|拟|考虑|打算|将要|希望|试图)(?:取消|撤销|做完|办妥|完成|交付|签收))/u;
const specificStoryCancellation = /(?:取消(?:了)?[^，。；;]{2,38}(?:约定|行动|之约)|(?:约定|行动|之约)[^，。；;]{0,12}(?:已取消|取消了|作罢))/u;
const explicitStoryDelivery = /(?:已签收|签收完毕|签收并|签收后|交接完成|送达|交付完毕|(?:亲手|当场|最终|随后)交付|(?:亲手|当场|最终|随后)(?:将|把)[^，。！？]{1,45}(?:交付|交给))/u;
const partialStoryCompletion = /(?:只(?:完成|做完|办妥)|完成(?:了)?(?:一部分|一半|部分|第[一二三四五六七八九十0-9]+步)|完成度)/u;
const pastStoryPlan = /(?:原计划|原本(?:打算|计划|要)|原先(?:打算|计划)|本来(?:打算|计划)|最初(?:打算|计划))/u;

const unfinishedStoryAction = /(?:尚未|还未|还没|没有|未能|并未|未)(?:彻底|全部|完全)?(?:完成|修好|修复|办妥|取消|交付|送达)/u;

function storyArchiveClosingOutcome(text: string): 'completed' | 'canceled' | undefined {
    for (const sentence of storySentences(text).reverse()) {
        const clauses = sentence.split(/[，,；;]/u);
        const closingFromEnd = [...clauses].reverse().findIndex(clause => canceledStoryAction.test(clause) || specificStoryCancellation.test(clause)
            || explicitStoryDelivery.test(clause) || /(?:完成|办妥|做完|送到了?|交给了|换好了?|交付了|取回了|拆除了)/u.test(clause));
        if (closingFromEnd < 0) {
            if (unfinishedStoryAction.test(sentence)) return;
            continue;
        }
        const closing = clauses.length - 1 - closingFromEnd;
        const last = clauses[closing];
        if (unfinishedStoryAction.test(clauses.slice(closing + 1).join('，'))) return;
        if (/[？?]/u.test(sentence)
            || uncertainStoryOutcome.test(clauses.slice(0, closing + 1).join('，'))
            || storyArchiveModality({ text: last })
            || /(?:未|没有|还没|无需|不必|差点|尝试|打算|正在)/u.test(last) || partialStoryCompletion.test(last)) return;
        return canceledStoryAction.test(last) || specificStoryCancellation.test(last) ? 'canceled' : 'completed';
    }
}

export function storyArchiveContinuityKind(
    fact: Pick<StoryArchiveFact, 'kind' | 'text' | 'modality' | 'continuity' | 'authorScope'>,
): StoryArchiveFact['continuity'] {
    if (fact.authorScope === 'turn') return undefined;
    if (storyArchiveModality(fact)) return;
    if (fact.kind === 'author') return persistentStoryRules.some(pattern => pattern.test(fact.text)) ? 'rule' : undefined;
    if (fact.continuity === 'rule' || fact.continuity === 'completed' || fact.continuity === 'canceled') return fact.continuity;
    if (unresolvedStoryClaim.test(fact.text) || partialStoryCompletion.test(fact.text)) return;
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
    const turnScopedSources = new Set(represented.filter(fact => fact.authorScope === 'turn').map(fact => fact.sourceMessageId));
    for (const row of rows) {
        if (blockedSources.has(row.id) || editedSources.has(row.id) || (row.role === 'user' && turnScopedSources.has(row.id))) continue;
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
    const past = archives.filter(box => box.fromMessageId < beforeId && (box.facts || box.toMessageId < beforeId));
    const stored = past.flatMap(box => [...(box.historyFacts ?? []), ...(box.facts ?? [])])
        .filter(fact => fact.sourceMessageId < beforeId);
    // Older, unstructured saves still carry source text. Use only bounded,
    // explicit assertions. Never send the full archived conversation again.
    const sourceBoxes = past.filter(box => box.strategy === 'summary' || box.facts);
    const sources = archivedRows.filter(row => row.id < beforeId && sourceBoxes.some(box => box.fromMessageId <= row.id && row.id <= box.toMessageId));
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
    const pickedRules = storyArchiveFactLines(rankStoryArchiveFacts(rules, query), floorNumbers, 1000, sourceTimes, undefined, true);
    const used = pickedRules.reduce((total, item) => total + item.line.length + 1, 0);
    const pickedOutcomes = storyArchiveFactLines(rankStoryArchiveFacts(outcomes, query), floorNumbers, 1350 - used, sourceTimes, undefined, true)
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
        floorNumbers, 420, sourceTimes, undefined, true).sort((a, b) => a.fact.sourceMessageId - b.fact.sourceMessageId);
    const plan = newest.find(fact => storyArchiveModality(fact) === 'planned'
        && nearScene(fact));
    if (plan) picked.push(...storyArchiveFactLines([plan], floorNumbers, 190, sourceTimes, undefined, true));
    return {
        text: picked.map(item => item.line).join('\n'),
        facts: picked.map(item => item.fact),
    };
}

const specificArchiveTerm = (term: string) => term.length >= 2
    && !/^(?:事件|剧情|人物|地点|状态|计划|记录|结果|作者|关系|对话|主角|当前|之前|过去|以后|任务|东西|物品|名字|别名|这个|那个|event|story|character|location|history)$/iu.test(term);

function archiveLinkLabels(values: unknown, limit: number) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.filter((value): value is string => typeof value === 'string')
        .map(normalize).filter(value => value.length >= 2 && value.length <= 96))].slice(0, limit);
}

const archiveEntityTypes: StoryArchiveEntity['type'][] = ['person', 'place', 'object', 'organization', 'event', 'code'];

function readArchiveEntities(value: unknown, evidence?: string): StoryArchiveEntity[] {
    if (!Array.isArray(value)) return [];
    const found = new Map<string, StoryArchiveEntity>();
    const sourced = (label: string) => evidence === undefined || evidence.includes(normalize(label));
    for (const item of value) {
        if (!item || typeof item.name !== 'string' || !archiveEntityTypes.includes(item.type)) continue;
        const name = item.name.normalize('NFKC').trim();
        const key = normalize(name);
        if (name.length > 48 || !specificArchiveTerm(key) || !sourced(name) || found.has(key)) continue;
        const aliases = archiveLinkLabels(item.aliases, 4).filter(alias => alias !== key && specificArchiveTerm(alias) && sourced(alias));
        found.set(key, { name, type: item.type, ...(aliases.length ? { aliases } : {}) });
        if (found.size >= 10) break;
    }
    return [...found.values()];
}

export function storyArchiveSearchTerms(fact: StoryArchiveFact): string[] {
    const aliasesFromText = [...fact.text.matchAll(/(?:又称|也叫|别名[为是：:]?|简称[为：:]?)[「『“"]([^」』”"\p{Cc}]{2,30})[」』”"]/gu)]
        .slice(0, 4).map(match => match[1]);
    return [...new Set([
        ...fact.terms, ...(fact.aliases ?? []), ...aliasesFromText,
        ...(fact.entities ?? []).flatMap(entity => [entity.name, ...(entity.aliases ?? [])]),
        ...fact.key.split(/[\/：:·]/u), ...storyArchiveCodes(fact.text).map(code => code.value),
    ].map(normalize).filter(specificArchiveTerm))];
}

export function storyArchiveQueryFloors(query: string): Set<number> {
    const floors = new Set<number>();
    const text = normalize(query);
    for (const match of text.matchAll(/(?:第\s*)?(\d{1,8})\s*楼/gu)) floors.add(Number(match[1]));
    for (const match of text.matchAll(/第\s*(\d{1,8}(?:\s*[、,和]\s*\d{1,8})+)\s*楼/gu)) {
        for (const number of match[1].match(/\d+/gu) ?? []) floors.add(Number(number));
    }
    return floors;
}

/** Give each specific query target a route into the prompt before general ranking. */
export function selectExplicitStoryFacts(
    facts: StoryArchiveFact[], query: string, floorNumbers: ReadonlyMap<number, number>, rank: ReadonlyMap<string, number>,
): StoryArchiveFact[] {
    const text = normalize(query);
    if (!text) return [];
    const floors = storyArchiveQueryFloors(text);
    const matchedNames = new Map<string, StoryArchiveFact[]>();
    const result = new Map<string, StoryArchiveFact>();
    const add = (fact: StoryArchiveFact) => result.set(storyArchiveFactIdentity(fact), fact);
    for (const fact of facts) {
        if (fact.kind !== 'fact' || fact.vectorTextState === 'deleted') continue;
        if (floors.has(floorNumbers.get(fact.sourceMessageId) ?? -1)) add(fact);
        for (const term of storyArchiveSearchTerms(fact)) {
            const index = text.indexOf(term);
            if (index < 0 || (/^[a-z0-9-]+$/u.test(term)
                && (/[a-z0-9-]/u.test(text[index - 1] ?? '') || /[a-z0-9-]/u.test(text[index + term.length] ?? '')))) continue;
            const matching = matchedNames.get(term) ?? [];
            matching.push(fact);
            matchedNames.set(term, matching);
        }
    }
    const byName = [...matchedNames].sort(([a, aFacts], [b, bFacts]) => aFacts.length - bFacts.length || b.length - a.length);
    const rankedByName = byName.map(([, matching]) => rankStoryArchiveFacts(matching, text, rank));
    // Give every named target its first slot before filling up to three distinct
    // records per target. Shared names must not collapse independent facets.
    for (let pass = 0; pass < 3 && result.size < 8; pass++) {
        for (const ordered of rankedByName) {
            if (result.size >= 8) break;
            const next = ordered.find(fact => !result.has(storyArchiveFactIdentity(fact)));
            if (next) add(next);
        }
    }
    return [...result.values()].slice(0, 8);
}

/** Read older or partially exported archives without mutating the stored copy. */
export function readStoryRecallArchives(archives: StoryTheaterArchive[] | undefined): StoryTheaterArchive[] {
    if (!Array.isArray(archives)) return [];
    return archives.flatMap(box => {
        if (!box || typeof box.id !== 'string' || !Number.isFinite(box.fromMessageId)
            || !Number.isFinite(box.toMessageId) || box.fromMessageId > box.toMessageId
            || (box.strategy !== 'summary' && box.strategy !== 'vector')) return [];
        const facts = (entries: StoryArchiveFact[] | undefined) => Array.isArray(entries) ? entries.flatMap(fact => {
            if (!fact || typeof fact.key !== 'string' || !fact.key.trim() || typeof fact.text !== 'string'
                || (fact.kind !== 'fact' && fact.kind !== 'author')
                || !Number.isFinite(fact.sourceMessageId) || fact.sourceMessageId < box.fromMessageId || fact.sourceMessageId > box.toMessageId) return [];
            return [{ ...fact, sourceMessageIds: Array.isArray(fact.sourceMessageIds)
                ? [...new Set(fact.sourceMessageIds.filter(id => Number.isSafeInteger(id) && id >= box.fromMessageId && id <= fact.sourceMessageId))] : undefined,
                terms: Array.isArray(fact.terms) ? fact.terms.filter(term => typeof term === 'string') : [],
                aliases: archiveLinkLabels(fact.aliases, 8), relatedKeys: archiveLinkLabels(fact.relatedKeys, 6),
                entities: readArchiveEntities(fact.entities),
                storyTime: typeof fact.storyTime === 'string' ? fact.storyTime : undefined }];
        }) : undefined;
        const strings = (values: string[] | undefined) => Array.isArray(values)
            ? values.filter(value => typeof value === 'string') : undefined;
        return [{ ...box, facts: facts(box.facts), historyFacts: facts(box.historyFacts),
            summary: typeof box.summary === 'string' ? box.summary : undefined,
            vectorMemoryIds: strings(box.vectorMemoryIds), affinityLog: strings(box.affinityLog) }];
    });
}

/** Expand at most two links from verified matches. Each hop shares the recall budget. */
export function storyRelatedArchiveFacts(
    facts: StoryArchiveFact[], query: string, semanticRank: ReadonlyMap<string, number>,
): StoryArchiveFact[] {
    const candidates = facts.filter(fact => fact.kind === 'fact' && fact.vectorTextState !== 'deleted');
    const needle = normalize(query);
    const tags = new Map<StoryArchiveFact, string[]>();
    const byTerm = new Map<string, Set<StoryArchiveFact>>();
    const byKey = new Map<string, Set<StoryArchiveFact>>();
    const inbound = new Map<string, Set<StoryArchiveFact>>();
    const add = (index: Map<string, Set<StoryArchiveFact>>, key: string, fact: StoryArchiveFact) => {
        const matches = index.get(key) ?? new Set<StoryArchiveFact>();
        matches.add(fact);
        index.set(key, matches);
    };
    for (const fact of candidates) {
        const terms = storyArchiveSearchTerms(fact);
        tags.set(fact, terms);
        add(byKey, normalize(fact.key), fact);
        for (const term of terms) add(byTerm, term, fact);
        for (const key of fact.relatedKeys ?? []) add(inbound, normalize(key), fact);
    }
    const specific = (term: string) => (byTerm.get(term)?.size ?? 0) <= 4;
    const seeds = rankStoryArchiveFacts(candidates.filter(fact =>
        (tags.get(fact) ?? []).some(term => specific(term) && needle.includes(term))
        || (semanticRank.get(fact.vectorNodeId ?? storyArchiveFactIdentity(fact)) ?? Infinity) < 2), query, semanticRank).slice(0, 3);
    const visited = new Set(seeds.map(storyArchiveFactIdentity));
    const results = [...seeds];
    let frontier = seeds;
    for (let hop = 0; hop < 2 && frontier.length; hop++) {
        const links = new Map<StoryArchiveFact, number>();
        for (const fact of frontier) {
            const addNeighbors = (neighbors: Iterable<StoryArchiveFact>, weight: number) => {
                for (const neighbor of neighbors) {
                    if (!visited.has(storyArchiveFactIdentity(neighbor))) links.set(neighbor, Math.max(weight, links.get(neighbor) ?? 0));
                }
            };
            const key = normalize(fact.key);
            addNeighbors(byKey.get(key) ?? [], 3);
            for (const related of fact.relatedKeys ?? []) addNeighbors(byKey.get(normalize(related)) ?? [], 2);
            const incoming = inbound.get(key);
            if (incoming && incoming.size <= 6) addNeighbors(incoming, 2);
            for (const term of tags.get(fact) ?? []) {
                if (specific(term)) addNeighbors(byTerm.get(term) ?? [], 1);
            }
        }
        frontier = rankStoryArchiveFacts([...links.keys()], query, semanticRank)
            .sort((a, b) => links.get(b)! - links.get(a)!).slice(0, hop === 0 ? 3 : 2);
        for (const fact of frontier) visited.add(storyArchiveFactIdentity(fact));
        results.push(...frontier);
    }
    return results;
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
    '将本批选中的剧情整理成少量、能独立读懂的记忆段。所有新内容以【本批新楼层】为证据。先读取上一次归档，再对照较早记忆，保留新增、纠正和真实进展。',
    '第一步整理剧情。以独立事项分段，将起因、关键行动、受阻与转折、结果、条件和例外写在一起。同一事件跨多楼也合成一段。分别更新的事项才分开；已完成或取消的事只作为过去结果保留，保留经过和结案，不能改写为待办。只记录会影响后续的内容，省略末尾站位、最后动作和开场位置。',
    '第二步逐个核对每条用户输入。场外纠错、补充设定、人物行为限制和写作要求用自己的话归纳，写清对象、每项条件、例外和期限。即使没有OOC、即使与剧情混写，也要整理。角色在剧情里说的话、用户扮演的行动及引用示例不属于场外要求。',
    '第三步检查六项覆盖：事件因果和失败；有后效的时间地点与转场；人物关系、秘密、误会、谁知道什么；有依据的心理或态度变化与起因；身份、规则、能力限制、归属、金额、数量和编号等精确细节；未决事项、完成或取消状态，以及每项场外要求。六项用于检查覆盖，无需输出六个标题，不为缺项编造内容。',
    '同一次响应返回一个JSON对象，包含changes（剧情记忆段）和instructions（场外要求段）两个数组。输出次序为先instructions后changes，确保用户要求和剧情都整理完。无此类新增或变化时对应数组为空。',
    '每段字段：key为具体且稳定的对象/事项，text为整理后的完整段落，sourceMessageId为本批来源记录ID的纯数字，action为add或update。剧情段kind为fact，场外段kind为author。terms可填人名、地点、物件、编号。先写清text，再补检索字段。',
    '同一事项有进展或明确纠正才用update并沿用旧key。独立事项各用独立key，不用“剧情/进展”等笼统名称。同一项在本批多次变化且中间状态有后效时，才按顺序各记一次。回顾旧事、换词重述和重复要求略过。明确开启新一轮同类行动时另建key。',
    'sourceMessageId指向确认本段最新状态或结果的本批记录。跨楼合段可用sourceMessageIds列出本段实际参考的所有本批记录ID，最后一项为sourceMessageId。quote可选，只能填该来源楼的逐字证据，无法逐字引用就省略。',
    '准确分清已发生、仅打算、传闻、内心和各人知情。明确完成填continuity:"completed"，明确取消填"canceled"，持续身份或限制填"rule"。尚未做的计划填modality:"planned"，未证实说法填"unverified"。已结案段中的原计划属于经过，不再标planned；另一条传闻不能改变已确认事件。',
    '长期场外要求保留全部有效条件。只限当轮的要求另段并标authorScope:"turn"，不要将同楼长期要求一起标成turn。修改某一要求时保留其余仍有效的条件。场外要求不能写成角色已经实施的行为。',
    'storyTime仅填原文明确的剧情时间，不能用聊天日期、楼层或回忆中的时间替代现在。界面好感数值由程序另存。原有角色卡、世界书和前提用于区分已有设定，不重复当成新剧情。',
    'aliases仅用原文明示别名。entities仅列有证据的专名，格式为{"name":"专名","type":"person|place|object|organization|event|code","aliases":[]}。relatedKeys仅填有直接因果、同物交接或同一未决事项的key。没依据的可选字段直接省略。',
    '整批最终正文100～1500字符（含标点与换行）。先删重复、修饰、无后效过程，再精简句子；保留关键主体、否定、因果、条件、例外和状态。素材少时不编造凑字。不能用全文摘抄或逐楼流水账代替总结。',
    '提交前对照上一档和本批首、中、尾：每项新场外要求及其条件是否入instructions？每个新事项、结案与变化是否入changes？同件事是否被拆成重复段？如果发现遗漏，在这次响应里补齐再闭合JSON。只输出JSON。',
].join('\n');

export function storyArchiveFactIdentity(fact: StoryArchiveFact): string {
    return JSON.stringify([fact.key, fact.sourceMessageId, fact.kind, fact.text, storyArchiveModality(fact), fact.authorScope]);
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
        if (!text?.trim()) return undefined;
        return text === fact.text ? fact : { ...fact, text, aliases: undefined, entities: undefined, relatedKeys: undefined };
    };
    for (const archive of archives.filter(item => item.fromMessageId < beforeId).sort((a, b) => a.toMessageId - b.toMessageId)) {
        const visible = [...(archive.historyFacts ?? []), ...(archive.facts ?? [])]
            .filter(fact => fact.sourceMessageId < beforeId);
        if (includeLastConfirmed) {
            for (const fact of visible) {
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
        const active = archive.toMessageId < beforeId ? archive.facts ?? [] : visible;
        for (const fact of active) {
            if (!current.has(fact.key) || current.get(fact.key)!.sourceMessageId <= fact.sourceMessageId) current.set(fact.key, fact);
        }
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
    const matchingTerms = facts.map(fact => [...new Set([...storyArchiveSearchTerms(fact), storyArchiveFactTime(fact, sourceTimes) ?? ''].map(normalize))]
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
        // Extract one balanced object and tolerate a comma immediately before
        // a closing bracket. Never supply missing fields or closing brackets.
        const begin = input.indexOf('{');
        if (begin < 0) throw new Error('无 JSON 对象');
        let depth = 0, quoted = false, escaped = false;
        let segment = begin;
        const parts: string[] = [];
        for (let i = begin; i < input.length; i++) {
            const char = input[i];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
            } else if (char === '"') quoted = true;
            else if (char === ',') {
                let next = i + 1;
                while (/\s/u.test(input[next] ?? '')) next++;
                if (input[next] === '}' || input[next] === ']') {
                    const preceding = input.slice(segment, i).trimEnd();
                    if (!preceding || /[\[{,]$/u.test(preceding)) throw new Error('无效的 JSON 逗号');
                    parts.push(input.slice(segment, i));
                    segment = i + 1;
                }
            } else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) {
                parts.push(input.slice(segment, i + 1));
                return JSON.parse(parts.join(''));
            }
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
const archivedCodePattern = /(回执(?:编号|号码|号)|登记(?:编号|号码|号|(?=\s*为))|门禁(?:密码|口令)|校验码|识别码|序列号|通行码|档案编号)\s*(?:是|为|改为|[:：])?\s*([A-Z0-9][A-Z0-9-]{2,23})(?![A-Z0-9-])/giu;
function storyArchiveCodes(text: string) {
    return [...text.normalize('NFKC').matchAll(archivedCodePattern)].map(match => ({
        phrase: match[0],
        label: match[1].replace(/^回执(?:号码|号)$/u, '回执编号').replace(/^登记(?:号码|号)?$/u, '登记编号')
            .replace(/^门禁口令$/u, '门禁密码'),
        value: match[2].toUpperCase(),
    })).filter(code => /[0-9]/u.test(code.value));
}

/** Backfill only explicit aliases and codes backed by this record or its source. */
export function backfillStoryArchiveFactTags(fact: StoryArchiveFact, source = ''): StoryArchiveFact {
    if (fact.kind !== 'fact' || fact.vectorTextState === 'deleted') return fact;
    const labels = storyArchiveSearchTerms(fact);
    const aliases = new Set(fact.aliases ?? []);
    for (const match of (fact.text + '\n' + source).matchAll(/([^\n，,。！？；;「」『』“”]{2,32}?)(?:又称|也叫|别名[为是：:]?|简称[为：:]?)\s*[「『“"]([^」』”"\n]{2,30})[」』”"]/gu)) {
        const subject = normalize(match[1]);
        if (labels.some(label => subject.endsWith(label))) aliases.add(normalize(match[2]));
    }
    const entities = [...(fact.entities ?? [])];
    for (const { value } of storyArchiveCodes(fact.text)) {
        if (!entities.some(entity => normalize(entity.name) === normalize(value))) entities.push({ name: value, type: 'code' });
    }
    const retainedAliases = [...aliases].slice(0, 8);
    const retainedEntities = entities.slice(0, 10);
    if (retainedAliases.length === (fact.aliases?.length ?? 0) && retainedEntities.length === (fact.entities?.length ?? 0)) return fact;
    return { ...fact, aliases: retainedAliases, entities: retainedEntities };
}

export class StoryArchiveIncompleteReply extends Error {}

const authorTurnStart = /^(?:仅限|只限|仅在|只在)?(?:本轮|这一次|这次|这一轮|本次)(?:回复|续写)?(?:只|仅|请|要|用|别|不|略|省|，|：)/u;
const explicitTurnAuthorStart = /^(?:仅限|只限|仅在|只在)?(?:本轮|这一次|这次|这一轮|本次)(?=[\p{Script=Han}，：])/u;
const persistentAuthorStart = /^(?:此后|以后|往后|从此|长期|后续(?:正文|续写|回复))/u;

function splitStoryAuthorScopes<T extends { kind?: unknown; text?: unknown; authorScope?: unknown }>(change: T): T[] {
    if (typeof change?.kind !== 'string' || normalize(change.kind) !== 'author' || typeof change.text !== 'string') return [change];
    const text = change.text.trim();
    // Only split model-written summaries when both scopes are explicit. A
    // comma inside an exception or a plain conditional is kept with its rule.
    for (const boundary of text.matchAll(/[，,。；;]\s*/gu)) {
        const first = text.slice(0, boundary.index).trimEnd();
        const second = text.slice(boundary.index! + boundary[0].length);
        const turnAtSentenceStart = boundary[0].startsWith('。') && explicitTurnAuthorStart.test(second);
        const turnFirst = explicitTurnAuthorStart.test(first) && persistentAuthorStart.test(second);
        const persistentFirst = !explicitTurnAuthorStart.test(first)
            && (authorTurnStart.test(second) || turnAtSentenceStart);
        if (turnFirst || persistentFirst) return [
            { ...change, text: (turnFirst ? second : first).replace(/[。！？]$/u, '') + '。', authorScope: undefined },
            { ...change, text: (turnFirst ? first : second).replace(/[。！？]$/u, '') + '。', authorScope: 'turn' },
        ];
    }
    return [change];
}

export function parseStoryArchiveChanges(
    raw: string, sources: ReadonlyMap<number, { text: string; authorInput: boolean; floorNumber?: number }>, known: StoryArchiveFact[], baseline = '',
    onEarlierState?: (fact: StoryArchiveFact) => void, sourceTimes?: ReadonlyMap<number, string>,
    priorHistory: readonly StoryArchiveFact[] = [],
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
    if ('instructions' in value && !Array.isArray(value.instructions)) {
        throw new StoryArchiveIncompleteReply('场外要求必须是 instructions 数组');
    }
    const instructions = 'instructions' in value && Array.isArray(value.instructions) ? value.instructions : [];
    const changes = [...value.changes, ...instructions.map(change =>
        change && typeof change === 'object' ? { ...change, kind: 'author' } : change)];
    const existing = new Map(known.map(fact => [fact.key, fact]));
    const confirmedOutcomes = new Map(known.filter(fact => {
        const outcome = storyArchiveContinuityKind(fact);
        return outcome === 'completed' || outcome === 'canceled';
    }).map(fact => [fact.key, fact]));
    const batchCodes = [...sources].flatMap(([id, source]) => storyArchiveCodes(source.text).map(code => ({ ...code, id })));
    const signature = (fact: Pick<StoryArchiveFact, 'kind' | 'text' | 'storyTime' | 'modality' | 'authorScope'>) =>
        JSON.stringify([fact.kind, comparable(fact.text), fact.storyTime ?? '', fact.modality ?? '', fact.authorScope ?? '']);
    const duplicateKey = (fact: Parameters<typeof signature>[0] & { sourceMessageId: number }) =>
        signature(fact) + (fact.authorScope === 'turn' ? '/' + fact.sourceMessageId : '');
    const duplicateText = new Set(known.map(duplicateKey));
    // Only skip a new fact that repeats a whole existing role/worldbook
    // sentence. Do NOT reject changed states on semantic similarity.
    const facts = new Map<string, StoryArchiveFact>();
    let skippedOldSource = false;
    for (const [index, change] of changes.flatMap(splitStoryAuthorScopes).entries()) {
        const rawKind = typeof change?.kind === 'string' ? normalize(change.kind) : change?.kind;
        const action = typeof change?.action === 'string' ? normalize(change.action) : change?.action;
        if (!change || typeof change.key !== 'string' || typeof change.text !== 'string'
            || (rawKind != null && rawKind !== 'fact' && rawKind !== 'author')
            || (action != null && action !== 'add' && action !== 'update')) {
            throw invalid(`第 ${index + 1} 条字段不完整`);
        }
        let key = normalize(change.key).replace(/\s+/g, '');
        let text = change.text.trim();
        const kind: 'fact' | 'author' = rawKind ?? 'fact';
        let modality = kind === 'fact' && (change.modality === 'planned' || change.modality === 'unverified')
            ? change.modality as 'planned' | 'unverified' : undefined;
        if (!/^[\p{L}\p{N}\p{M}\p{P}\p{S}]{2,120}$/u.test(key) || !comparable(text)) {
            throw invalid(`第 ${index + 1} 条记忆键或正文为空/不合法`);
        }
        const quote = typeof change.quote === 'string' ? change.quote.trim() : '';
        const sourceToken = String(change.sourceMessageId ?? '').normalize('NFKC').trim();
        const floorRef = /^第\s*(\d+)\s*楼$/.exec(sourceToken);
        const sourceRef = /^(?:(记录\s*ID|record[\s_-]*id|sourceMessageId)[\s:_#-]*)?(\d+)$/i.exec(sourceToken);
        const providedId = Number(floorRef?.[1] ?? sourceRef?.[2]);
        const direct = !floorRef && Number.isSafeInteger(providedId) ? sources.get(providedId) : undefined;
        const floor = [...sources.entries()].find(([, source]) => source.floorNumber === providedId);
        const candidates = quote ? [...sources.entries()].filter(([, source]) => quoteExistsIn(source.text, quote)) : [];
        if (!direct && candidates.length !== 1 && sourceRef
            && !(Array.isArray(change.sourceMessageIds) && change.sourceMessageIds.some((id: unknown) => sources.has(Number(id))))) {
            const prior = [...known, ...priorHistory].filter(fact => fact.sourceMessageId === providedId && fact.kind === kind);
            if (prior.some(fact => comparable(fact.text) === comparable(text))) continue;
            if (action && prior.length) {
                // A proposed addition or update can cite an old record even when other changes are correctly sourced.
                // Never accept that record as new evidence or mistake its ID for a floor number.
                skippedOldSource = true;
                continue;
            }
        }
        // Original records, not model-written quote strings, are the evidence.
        // A model may return an ordinal floor number rather than a database ID.
        // Match those only against the current batch's actual floor mapping.
        // A uniquely matching verbatim quote is stronger evidence than an ID
        // guessed by a smaller model. When the quote is paraphrased or omitted,
        // trust the valid direct source ID instead.
        const providedSources = Array.isArray(change.sourceMessageIds)
            ? [...new Set<number>(change.sourceMessageIds.map((id: unknown) => Number(id))
                .filter((id: number) => Number.isSafeInteger(id) && sources.has(id)))].sort((a, b) => a - b) : [];
        const lastProvided = providedSources.at(-1);
        const anchored = candidates.length === 1 ? candidates[0]
            : direct ? [providedId, direct] as const
            : floorRef || (sourceRef && !sourceRef[1]) ? floor : undefined;
        // A multi-floor paragraph is current only after its last contributing
        // floor, even when its quote anchors a detail from an earlier floor.
        const selected = lastProvided !== undefined && (!anchored || lastProvided > anchored[0])
            ? [lastProvided, sources.get(lastProvided)!] as const : anchored;
        if (!selected && !sourceToken && action === 'update') {
            const previous = existing.get(key);
            // A provider may echo a settled paragraph and append an undated
            // claim without any source. Only discard this known recap; later
            // source-backed recovery can still recognize a fresh outcome.
            const priorText = previous?.kind === kind ? comparable(previous.text) : '';
            if (priorText && comparable(text).startsWith(priorText)) {
                if (comparable(text) !== priorText) skippedOldSource = true;
                continue;
            }
        }
        if (!selected) throw invalid(`第 ${index + 1} 条没有有效的原文记录ID`);
        const [sourceMessageId, source] = selected;
        const sourceMessageIds = [...new Set([...providedSources.filter(id => id <= sourceMessageId), sourceMessageId])];
        const sourceEvidence = sourceMessageIds.map(id => sources.get(id)!.text).join('\n');
        // An umbrella key causes unrelated scenes to overwrite each other and
        // creates huge fake "state transitions" (the exact video symptom).
        if (/^(?:剧情|故事|事件|情节|主线|进度)[\/：:](?:进展|发展|事件|经历|内容|动态|记录|状态)$/u.test(key)) {
            key = '独立事件/来源' + sourceMessageId + '/' + index;
        }
        if (kind === 'author' && !source.authorInput) {
            // Some providers duplicate an assistant-sourced plot paragraph in
            // both arrays. Keep its already-returned fact, never promote it to
            // a user direction and never discard the rest of the valid batch.
            const plotCopy = changes.some(other => other && (other.kind == null || other.kind === 'fact')
                && typeof other.text === 'string' && comparable(other.text) === comparable(text)
                && (Number(other.sourceMessageId) === sourceMessageId
                    || Array.isArray(other.sourceMessageIds) && other.sourceMessageIds.map(Number).includes(sourceMessageId)));
            if (plotCopy) continue;
            throw invalid(`第 ${index + 1} 条作者指令不是用户输入`);
        }
        const persistentClauses = kind === 'author' ? storySentences(source.text).map(sentence => sentence.trim()
            .replace(/^(?:OOC|场外|作者备注)[:：]\s*/iu, ''))
            .filter(sentence => !explicitTurnAuthorStart.test(sentence)
                && /(?:从此|此后|往后|长期|以后|接下来的正文|永远|始终|一律)/u.test(sentence)) : [];
        const sourceIsPersistent = persistentClauses.length > 0;
        // Scope is verified from the actual enduring clause, not optional
        // model-written terms or the scope of a different note on this floor.
        const persistentEvidence = persistentClauses.some(sentence => {
            const evidence = comparable(sentence), body = comparable(text);
            for (let i = 0; i <= body.length - 4; i++) if (evidence.includes(body.slice(i, i + 4))) return true;
            return false;
        });
        const persistentSummary = persistentAuthorStart.test(text)
            || (!explicitTurnAuthorStart.test(text) && persistentEvidence);
        if (kind === 'author' && persistentSummary && sourceIsPersistent) {
            text = text.replace(/[，,；;。]\s*此(?:项|条)?(?:规则|要求|限制)(?:仅|只)适用于本批(?:剧情)?[。！\s]*$/u, '。');
        }
        // Verify an otherwise identical scope against the user's words. A
        // model-written “以后” must not make “本轮” persist into future play.
        const authorCore = (value: string) => comparable(value.replace(/^(?:(?:OOC|场外|作者备注)[:：]\s*)?/iu, '')
            .replace(/^(?:(?:仅限|只限|仅在|只在)?(?:本轮|这一次|这次|这一轮|本次)(?:回复|续写)?|此后|以后|往后|从此|长期|后续(?:正文|续写|回复))[，：\s]*(?:只|仅)?/u, ''));
        const groundedTurn = kind === 'author' && storySentences(source.text).map(sentence => sentence.trim()
            .replace(/^(?:OOC|场外|作者备注)[:：]\s*/iu, ''))
            .find(sentence => explicitTurnAuthorStart.test(sentence) && authorCore(sentence).length >= 3
                && authorCore(sentence) === authorCore(text));
        if (groundedTurn && !explicitTurnAuthorStart.test(text)) text = groundedTurn;
        const authorScope = kind === 'author' && (!!groundedTurn || !persistentSummary && (change.authorScope === 'turn'
            || authorTurnStart.test(text)
            || /(?:[（(]|[，；、]\s*)?(?:仅限|只限|仅适用于|只适用于)(?:本轮|这一次|这次|这一轮|本次)(?:回复|续写)?[）)。！\s]*$/u.test(text))) ? 'turn' as const : undefined;
        if (authorScope) key = '场外当轮/' + sourceMessageId + '/' + index;
        if (kind === 'author' && !authorScope) {
            const previous = facts.get(key) ?? existing.get(key);
            // A broad author key is ambiguous. A second distinct add must not
            // replace another instruction with its own independent scope.
            const generic = /^(?:场外|作者|用户|写作)(?:[/:]?(?:指令|要求|协助指令|协助要求|备注|纠错|说明))?$/u.test(key);
            if (previous?.kind === 'author' && comparable(previous.text) !== comparable(text)
                && (action !== 'update' || generic)) key = '场外要求/' + sourceMessageId + '/' + index;
        }
        const collision = facts.get(key) ?? existing.get(key);
        if (kind === 'fact' && action === 'add' && collision?.kind === 'fact'
            && comparable(collision.text) !== comparable(text)) {
            const generic = /^(?:人物|事件|剧情|故事|主线|记录|事项)[/：:]?(?:进展|状态|内容|记录|结果|变化|事件)?$/u.test(key);
            if (generic || collision.sourceMessageId === sourceMessageId) {
                key += '/独立事项' + sourceMessageId + '/' + index;
            }
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
        let continuityHint = change.continuity;
        if (kind === 'fact') {
            // When a floor first states a new event and then recalls an old
            // plan, an exact summary of the opening clause uses that clause.
            // The old plan's wording must not reclassify today's event.
            const openingClause = source.text.split(/[，,；;。]/u, 1)[0];
            const recallsEarlier = /(?:提起|回顾|说起|聊起|谈起|重提)[^。！？]{0,40}(?:此前|之前|早先|原先|原本|过去|原计划|当时)/u
                .test(source.text.slice(openingClause.length));
            const exactOpening = recallsEarlier && comparable(openingClause) === comparable(text) ? openingClause : undefined;
            const exactSummarySentence = storySentences(source.text).find(sentence => comparable(sentence) === comparable(text));
            const evidence = quotedClause ?? exactOpening ?? exactSummarySentence ?? source.text;
            const groundedClause = quotedClause || exactOpening || exactSummarySentence;
            const evidenceModality = groundedClause || storySentences(source.text).length === 1
                ? storyArchiveModality({ text: evidence }) : undefined;
            modality = groundedClause ? evidenceModality : evidenceModality ?? modality;
            const closing = storyArchiveClosingOutcome(text);
            if (closing && (!modality || pastStoryPlan.test(text) || continuityHint === closing)
                && storyArchiveClosingOutcome(evidence) === closing && modality !== 'unverified') {
                modality = undefined;
                continuityHint = closing;
            }
            if ((continuityHint === 'completed' || continuityHint === 'canceled')
                && storyArchiveClosingOutcome(text) !== continuityHint
                && (partialStoryCompletion.test(text)
                    || unfinishedStoryAction.test(text))) {
                // A model's terminal flag cannot close the still-unfinished
                // task described by its own paragraph.
                continuityHint = undefined;
                modality = storyArchiveModality({ text });
            }
            const codeClaims = storyArchiveCodes(text);
            let unsupportedCode = false;
            for (const claim of codeClaims) {
                const citedCodes = storyArchiveCodes(evidence).filter(code => code.label === claim.label);
                const sourceCodes = citedCodes.length ? citedCodes
                    : storyArchiveCodes(source.text).filter(code => code.label === claim.label);
                const values = [...new Set(sourceCodes.map(code => code.value))];
                const earlierValues = values.length ? [] : [...new Set(batchCodes
                    .filter(code => code.id < sourceMessageId && code.label === claim.label).map(code => code.value))];
                if (values.length === 1 && values[0] !== claim.value) {
                    const sourceCode = sourceCodes[0];
                    text = text.includes(claim.phrase)
                        ? text.replace(claim.phrase, sourceCode.phrase)
                        : text.normalize('NFKC').replace(claim.phrase, sourceCode.phrase);
                } else if (!source.text.normalize('NFKC').toUpperCase().match(/[A-Z0-9-]+/g)?.includes(claim.value)
                    && !(earlierValues.length === 1 && earlierValues[0] === claim.value)) {
                    unsupportedCode = true;
                    break;
                }
            }
            if (unsupportedCode) continue;
        }
        const knownState = facts.get(key) ?? existing.get(key);
        const oldOutcome = knownState && storyArchiveContinuityKind(knownState);
        const latestConfirmedOutcome = knownState && storyArchiveModality(knownState) === 'unverified'
            ? confirmedOutcomes.get(key) : undefined;
        const terminal = kind === 'fact' && storyArchiveContinuityKind({ kind, text, modality, continuity: continuityHint });
        if ((terminal === 'completed' || terminal === 'canceled') && oldOutcome && oldOutcome !== terminal
            && (oldOutcome === 'completed' || oldOutcome === 'canceled')
            && !/(?:更正|纠正|此前误|其实|实际并未)/u.test(source.text)) {
            key += '/来源' + sourceMessageId;
        }
        if (kind === 'fact' && continuityHint === 'rule'
            && (oldOutcome === 'completed' || oldOutcome === 'canceled' || latestConfirmedOutcome)) {
            // A new rule may affect future occurrences, but it cannot replace
            // a settled occurrence. Guard this key collision with current evidence.
            const oldText = normalize((latestConfirmedOutcome ?? knownState)?.text ?? '');
            const sourceText = normalize(source.text);
            const hasNewTerm = Array.isArray(change.terms) && change.terms.some((term: unknown) => {
                if (typeof term !== 'string') return false;
                const word = normalize(term);
                return word.length >= 2 && sourceText.includes(word) && !oldText.includes(word);
            });
            if (!hasNewTerm && !sourceText.includes(normalize(text))) continue;
            key += '/规则/来源' + sourceMessageId;
        }
        if (kind === 'fact' && storyArchiveModality({ text, modality }) === 'planned'
            && (oldOutcome === 'completed' || oldOutcome === 'canceled' || latestConfirmedOutcome)) {
            const evidence = quotedClause ?? source.text;
            const restarted = /(?:重新|再次|再一次|又一次|另一次|另约|再约|又打算|又准备|(?:下次|明天|次日|改天|下周)[^，。！？]{0,10}再)/u.test(evidence);
            if (restarted || (storyTime && knownState?.storyTime && storyTime !== knownState.storyTime && action === 'add')) {
                key += '/来源' + sourceMessageId;
            } else if (/(?:此前|之前|当时|回顾|提起|原本|原计划|已经|早已|已完成|已取消)/u.test(evidence)) {
                continue;
            }
        }
        if (kind === 'fact' && action === 'add' && storyTime && knownState?.storyTime
            && knownState.storyTime !== storyTime && comparable(knownState.text) === comparable(text)) {
            key += '/来源' + sourceMessageId;
        }
        const previous = existing.get(key);
        if (previous && previous.kind !== kind) throw invalid(`第 ${index + 1} 条改变了已有记忆类型`);
        const continuity = kind === 'fact' && !modality
            ? storyArchiveContinuityKind({ kind, text, continuity: continuityHint })
                ?? (previous?.continuity === 'rule' ? 'rule' : undefined)
            : undefined;
        const fact = { key, kind, text, sourceMessageId, ...(sourceMessageIds.length > 1 ? { sourceMessageIds } : {}), ...(authorScope ? { authorScope } : {}), ...(storyTime ? { storyTime } : {}),
            ...(modality ? { modality } : {}), ...(continuity ? { continuity } : {}) };
        const comparableText = signature(fact);
        const oldInBatch = facts.get(key);
        if (oldInBatch && oldInBatch.sourceMessageId > sourceMessageId) continue;
        const sameState = previous && comparable(previous.text) === comparable(text) && storyArchiveModality(previous) === storyArchiveModality(fact);
        if (!previous && kind === 'fact' && continuity !== 'rule' && storyArchiveRepeatsPreset(text, key, baseline, quotedClause ?? source.text)) continue;
        const termCandidates: string[] = Array.isArray(change.terms)
            ? change.terms.filter((term: unknown): term is string => typeof term === 'string')
            : key.split(/[\/：:·-]+/u);
        const terms = [...new Set<string>(termCandidates.map(term => normalize(term)).filter(term => term.length >= 2))];
        if (oldInBatch && oldInBatch.kind === 'fact' && kind === 'fact'
            && (oldInBatch.text !== text || storyArchiveModality(oldInBatch) !== storyArchiveModality(fact))) onEarlierState?.(oldInBatch);
        let aliases = kind === 'fact' ? archiveLinkLabels(change.aliases, 4)
            .filter(alias => normalize(sourceEvidence).includes(alias)) : [];
        let relatedKeys = kind === 'fact' ? archiveLinkLabels(change.relatedKeys, 3)
            .filter(link => link !== normalize(key)) : [];
        let entities = kind === 'fact' ? readArchiveEntities(change.entities, normalize(sourceEvidence)) : [];
        const state = oldInBatch ?? previous;
        if (state?.kind === 'fact' && action === 'update') {
            aliases = [...new Set([...(state.aliases ?? []), ...aliases])].slice(0, 8);
        }
        const sameEntry = state && (signature(state) === comparableText || (!oldInBatch && sameState));
        let metadataChanged = false;
        if (sameEntry && state.kind === 'fact') {
            const oldAliases = state.aliases ?? [], oldLinks = state.relatedKeys ?? [], oldEntities = state.entities ?? [];
            const byName = new Map(oldEntities.map(entity => [normalize(entity.name), entity]));
            for (const entity of entities) {
                const prior = byName.get(normalize(entity.name));
                byName.set(normalize(entity.name), prior
                    ? { ...prior, aliases: [...new Set([...(prior.aliases ?? []), ...(entity.aliases ?? [])])].slice(0, 4) }
                    : entity);
            }
            aliases = [...new Set([...oldAliases, ...aliases])].slice(0, 8);
            relatedKeys = [...new Set([...oldLinks, ...relatedKeys])].slice(0, 6);
            entities = [...byName.values()].slice(0, 10);
            metadataChanged = terms.some(term => !state.terms.includes(term))
                || aliases.length !== oldAliases.length || relatedKeys.length !== oldLinks.length
                || entities.length !== oldEntities.length || entities.some((entity, i) => (entity.aliases?.length ?? 0) > (oldEntities[i]?.aliases?.length ?? 0));
            if (metadataChanged) terms.push(...state.terms.filter(term => !terms.includes(term)));
        }
        if (!metadataChanged && (oldInBatch && signature(oldInBatch) === comparableText
            || sameState && !oldInBatch && action !== 'add'
            || duplicateText.has(duplicateKey(fact)) && !oldInBatch && (!previous || sameState))) continue;
        if (metadataChanged && oldInBatch && oldInBatch.sourceMessageId < sourceMessageId) onEarlierState?.(oldInBatch);
        facts.set(key, { ...fact, ...(metadataChanged && state ? { storyTime: state.storyTime, continuity: state.continuity } : {}), terms, ...(aliases.length ? { aliases } : {}),
            ...(relatedKeys.length ? { relatedKeys } : {}), ...(entities.length ? { entities } : {}) });
        duplicateText.add(duplicateKey(fact));
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
    for (const [sourceMessageId, source] of sources) {
        if (source.authorInput) {
            // Explicit one-reply writing limits are safe to preserve locally
            // when the model omits them. They never enter later prompts.
            const subjects = /天气|场景|段落|对白|时间|环境|动作|旁白|独白|人称|视角|字数|正文/gu;
            const hasTurnNote = [...facts.values()].filter(fact => fact.sourceMessageId === sourceMessageId && fact.authorScope === 'turn');
            for (const sentence of storySentences(source.text).slice(0, 24)) {
                const clause = sentence.trim();
                if (!authorTurnStart.test(clause) || clause.length > 65 || /[“”「」『』"'<>？?]/u.test(clause)) continue;
                const names = clause.match(subjects);
                if (!names?.length || hasTurnNote.some(fact => names.some(name => fact.text.includes(name)))) continue;
                const text = clause.replace(/^(?:仅限|只限|仅在|只在)?(?:本轮|这一次|这次|这一轮|本次)(?:回复|续写)?[，： ]*/u, '');
                if (!text.trim()) continue;
                const key = '场外当轮/补录/' + sourceMessageId + '/' + hasTurnNote.length;
                const recovered: StoryArchiveFact = { key, kind: 'author', authorScope: 'turn', text, terms: names, sourceMessageId };
                facts.set(key, recovered);
                hasTurnNote.push(recovered);
            }
            continue;
        }
        const clean = source.text.trim();
        if (!clean || clean.length > 280 || uncertainStoryOutcome.test(clean)
            || /[“”「」『』"'<>？?]|(?:曾经|没(?:有)?取消|并未取消)/u.test(clean)) continue;
        const represented = [...facts.values()].filter(fact => fact.sourceMessageId === sourceMessageId && fact.kind === 'fact');
        // Only add exact, bounded state evidence where the model omitted it.
        const cancel = storySentences(clean).find(sentence =>
            specificStoryCancellation.test(sentence)
            && !/(?:打算|如果|未能|没有|并未|想要|将要|希望)/u.test(sentence));
        const pending = /(?:仍|尚|还|没有|未).{0,10}(?:没有修好|卡住|卡着|未修好|未完成|修好|完工|解决)/u.test(clean);
        const partial = clean.match(/^(?:[^。！？]{2,55}(?:原计划|原本打算)[^。！？]{2,48}[。！])?[^。！？]{0,22}只完成(?:了)?([^；;，,。！？]{2,44})[；;，,]([^。！？]{4,95})/u);
        if (cancel && !represented.some(fact => storyArchiveContinuityKind(fact) === 'canceled')) {
            const key = '取消事项/来源' + sourceMessageId;
            const detail = cancel.trim().replace(/[。！]$/u, '');
            if (![...known, ...facts.values()].some(fact => comparable(fact.text).includes(comparable(detail)))) {
                facts.set(key, { key, kind: 'fact', text: detail + '。', terms: [], sourceMessageId,
                    storyTime: storyTimeFromSource(cancel) ?? sourceTimes?.get(sourceMessageId), continuity: 'canceled' });
            }
        }
        if (partial && pending && !represented.some(fact => storyArchiveModality(fact) === 'planned'
            && /(?:只完成|已拆|只拆|仍|尚|还|未|没)/u.test(fact.text))) {
            const key = '部分进展/来源' + sourceMessageId;
            const goal = partial[0].match(/^[^。！？]+[。！？]/u)?.[0] ?? '';
            const done = partial[1].replace(/这一项$/u, '').trim();
            facts.set(key, { key, kind: 'fact', text: goal + '已做：' + done + '。尚未完成：' + partial[2] + '。',
                terms: [], sourceMessageId, storyTime: sourceTimes?.get(sourceMessageId), modality: 'planned' });
        }
    }
    // Merge a closing record only with directly linked causal evidence for the
    // same object/action. An unambiguous route reference can supply the link.
    // Keep the earlier record for rerolling a floor before the outcome.
    for (const [key, outcome] of facts) {
        const status = storyArchiveContinuityKind(outcome);
        if (outcome.kind !== 'fact' || (status !== 'completed' && status !== 'canceled')) continue;
        const routeMentioned = /(?:绕路|绕道|改走|改道)/u.test(outcome.text);
        const routeCandidates = routeMentioned ? [...facts].filter(([, fact]) => fact.sourceMessageId < outcome.sourceMessageId
            && /(?:改走|改道|绕路|绕道)/u.test(fact.text)) : [];
        const links = [...new Set([...(outcome.relatedKeys ?? []), ...(routeCandidates.length === 1 ? [routeCandidates[0][0]] : [])])];
        for (const link of links) {
            const earlier = facts.get(link);
            if (!earlier || earlier.kind !== 'fact' || earlier.sourceMessageId >= outcome.sourceMessageId
                || storyArchiveModality(earlier) ||
                !/(?:因为|由于|因.{1,32}(?:改|受阻|没|无法)|改走|绕道|受阻|失败|不得不)/u.test(earlier.text)) continue;
            const outcomeObjects = new Set(storyActionSignatures(outcome.text).map(action => action.verb + '/' + action.object));
            const namedObjects = new Set((outcome.entities ?? []).filter(entity => entity.type === 'event' || entity.type === 'object')
                .map(entity => normalize(entity.name)));
            const sharedObject = storyActionSignatures(earlier.text).some(action => outcomeObjects.has(action.verb + '/' + action.object))
                || (earlier.entities ?? []).some(entity => namedObjects.has(normalize(entity.name)))
                || earlier.terms.some(term => /(?:回执|凭证|文书|信件|账册|文件|钥匙|契约|封条|约定|包裹|门锁|闸机|证件)$/u.test(term)
                    && normalize(earlier.text).includes(term) && normalize(outcome.text).includes(term));
            if (!sharedObject || storyArchiveContinuityKind(earlier) === 'rule') continue;
            const combined = [...new Map([...storySentences(earlier.text), ...storySentences(outcome.text)]
                .map(sentence => [comparable(sentence), sentence])).values()]
                .map(sentence => /[。！？.!?]$/u.test(sentence) ? sentence : sentence + '。').join('');
            if (!combined || combined.length > 1500) continue;
            facts.delete(link);
            onEarlierState?.({ ...earlier, mergedIntoKey: key });
            facts.set(key, {
                ...outcome, text: combined,
                sourceMessageIds: [...new Set([...(earlier.sourceMessageIds ?? [earlier.sourceMessageId]),
                    ...(outcome.sourceMessageIds ?? [outcome.sourceMessageId])])].sort((a, b) => a - b),
                terms: [...new Set([...earlier.terms, ...outcome.terms])],
                aliases: [...new Set([...(earlier.aliases ?? []), ...(outcome.aliases ?? [])])].slice(0, 8),
                entities: readArchiveEntities([...(outcome.entities ?? []), ...(earlier.entities ?? [])]),
            });
            break;
        }
    }
    if (skippedOldSource && !facts.size) throw invalid('模型只引用了旧归档，没有提取到本批记录');
    return [...facts.values()];
}

function clipStoryMemoryText(text: string, limit: number): string {
    if (limit <= 0) return '';
    if (text.length <= limit) return text;
    return text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, '').trimEnd() + '…';
}

function storyArchiveFactLines(
    facts: StoryArchiveFact[], floorNumbers?: ReadonlyMap<number, number>, budget = Infinity,
    sourceTimes?: ReadonlyMap<number, string>, timelineStatus?: 'current' | 'past', requireFullLine = false,
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
        if (used + line.length > budget && (requireFullLine || selected.length)) continue;
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
    chronological = false, sourceTimes?: ReadonlyMap<number, string>, onSelected?: (fact: StoryArchiveFact, complete: boolean) => void,
): string {
    const selected = storyArchiveFactLines(facts, floorNumbers, budget, sourceTimes);
    if (chronological) selected.sort((a, b) => a.fact.sourceMessageId - b.fact.sourceMessageId);
    return selected.map(item => { onSelected?.(item.fact, item.line.endsWith(item.fact.text)); return item.line; }).join('\n');
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
            entries: facts.filter(fact => fact.kind === 'fact' && storyArchiveModality(fact) === 'planned'),
            budget: 580,
        },
        {
            title: '未经证实的信息（不能当成已知真相）',
            entries: facts.filter(fact => fact.kind === 'fact' && storyArchiveModality(fact) === 'unverified'),
            budget: 500,
        },
        {
            title: '用户明确提出的写作要求',
            entries: facts.filter(fact => fact.kind === 'author' && fact.authorScope !== 'turn'),
            budget: 800,
        },
    ];
}

function selectStoryArchiveRecallLines(
    facts: StoryArchiveFact[], query: string, floorNumbers: ReadonlyMap<number, number> | undefined,
    semanticRank: ReadonlyMap<string, number>, sourceTimes: ReadonlyMap<number, string> | undefined,
    active: ReturnType<typeof formatStoryArchiveActiveState> | undefined, explicit: readonly StoryArchiveFact[],
    timelineStatus?: 'current',
) {
    const reserved = new Map<string, { fact: StoryArchiveFact; line: string }>();
    const available = new Set(facts.map(storyArchiveFactIdentity));
    const targets = explicit.filter(fact => available.has(storyArchiveFactIdentity(fact))
        && !active?.selected.has(storyArchiveFactIdentity(fact)));
    let reserveRemaining = Math.min(1600, Math.max(0, 3200 - (active?.cost ?? 0)));
    for (const fact of targets) {
        const item = storyArchiveFactLines([fact], floorNumbers, reserveRemaining - 1, sourceTimes, timelineStatus, true)[0];
        if (!item) continue;
        reserved.set(storyArchiveFactIdentity(fact), item);
        reserveRemaining -= item.line.length + 1;
    }
    let borrowed = 0;
    const sections = storyArchiveRecallSections(facts).map(({ title, entries, budget }) => {
        const priority = entries.flatMap(fact => reserved.get(storyArchiveFactIdentity(fact)) ?? []);
        const cost = priority.reduce((size, item) => size + item.line.length + 1, 0);
        if (budget !== 3200) borrowed += Math.max(0, cost - budget);
        return { title, entries, budget, priority, cost };
    });
    // Keep conditions and exceptions together in smaller sections. Unused
    // reserved space can come from the confirmed-facts budget within the
    // same overall limit. Count what was actually used before filling facts.
    const confirmed = sections[0];
    let shared = Math.max(0, Math.min(reserveRemaining, confirmed.budget - confirmed.cost - (active?.cost ?? 0) - borrowed));
    const selectSection = ({ title, entries, budget, priority, cost }: typeof confirmed) => {
        const rankable = entries.filter(fact => {
            const id = storyArchiveFactIdentity(fact);
            return !reserved.has(id) && !active?.selected.has(id);
        });
        const isConfirmed = budget === confirmed.budget;
        const space = Math.max(0, budget - cost - (isConfirmed ? (active?.cost ?? 0) + borrowed : 0));
        const ranked = rankStoryArchiveFacts(rankable, query, semanticRank, sourceTimes);
        const lines = storyArchiveFactLines(ranked, floorNumbers, space + (isConfirmed ? 0 : shared),
            sourceTimes, timelineStatus, !isConfirmed);
        if (!isConfirmed) {
            const extra = Math.max(0, lines.reduce((size, item) => size + item.line.length + 1, 0) - space);
            shared = Math.max(0, shared - extra);
            borrowed += extra;
        }
        return { title, lines: [...priority, ...lines] };
    };
    const other = sections.slice(1).reverse().map(selectSection).reverse();
    return [selectSection(confirmed), ...other];
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
    sourceTimes?: ReadonlyMap<number, string>, active?: ReturnType<typeof formatStoryArchiveActiveState>, explicit: readonly StoryArchiveFact[] = [],
    onSelected?: (fact: StoryArchiveFact, complete: boolean) => void,
): string {
    const sections = selectStoryArchiveRecallLines(facts, query, floorNumbers, semanticRank, sourceTimes, active, explicit).map(({ title, lines }) => {
        const text = lines.sort((a, b) => a.fact.sourceMessageId - b.fact.sourceMessageId).map(item => {
            onSelected?.(item.fact, item.line.endsWith(item.fact.text));
            return item.line;
        }).join('\n');
        return text ? '【' + title + '】\n' + text : '';
    });
    return [active?.text, ...sections].filter(Boolean).join('\n\n');
}

/** Structured independent vectors share one source order across fact categories and old states. */
export function formatStoryArchiveRecallTimeline(
    facts: StoryArchiveFact[], historical: StoryArchiveFact[], query: string,
    floorNumbers: ReadonlyMap<number, number>, semanticRank: ReadonlyMap<string, number>,
    sourceTimes: ReadonlyMap<number, string>, active?: ReturnType<typeof formatStoryArchiveActiveState>,
    relatedKeys: ReadonlySet<string> = new Set(), explicit: readonly StoryArchiveFact[] = [],
    explicitFloors: ReadonlySet<number> = new Set(),
    onSelected?: (fact: StoryArchiveFact, complete: boolean) => void,
): string {
    const lines = selectStoryArchiveRecallLines(facts, query, floorNumbers, semanticRank, sourceTimes, active, explicit, 'current')
        .flatMap(section => section.lines);
    const selectedKeys = new Set([...lines.map(item => item.fact.key), ...facts.filter(fact =>
        active?.selected.has(storyArchiveFactIdentity(fact))).map(fact => fact.key)]);
    const currentIdentities = new Set(facts.map(storyArchiveFactIdentity));
    lines.push(...storyArchiveFactLines(historical.filter(fact => (selectedKeys.has(fact.key) || relatedKeys.has(fact.key)
        || explicitFloors.has(floorNumbers.get(fact.sourceMessageId) ?? -1)) && !currentIdentities.has(storyArchiveFactIdentity(fact))),
        floorNumbers, Infinity, sourceTimes, 'past'));
    const timeline = lines.sort((a, b) =>
        (floorNumbers.get(a.fact.sourceMessageId) ?? Number.MAX_SAFE_INTEGER)
        - (floorNumbers.get(b.fact.sourceMessageId) ?? Number.MAX_SAFE_INTEGER),
    ).map(item => {
        onSelected?.(item.fact, item.line.endsWith(item.fact.text));
        return item.line;
    }).join('\n');
    return [active?.text, timeline].filter(Boolean).join('\n\n');
}

/** Pull a small, verbatim fallback only when archived text can add evidence. */
export function findStoryArchiveEvidence(
    rows: readonly { id: number; content: string; role?: string }[], archives: StoryTheaterArchive[], beforeId: number,
    query: string, alreadySent: string, baseline: string, floorNumbers: ReadonlyMap<number, number>,
    closedPlans: StoryArchiveFact[] = [], relatedByFloor: ReadonlyMap<number, readonly string[]> = new Map(),
    explicitFloors: ReadonlySet<number> = new Set(),
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
    for (const match of searchText.matchAll(/[「『“"]([^」』”"]{2,36})[」』”"]/gu)) needles.add(match[1]);
    const shortTarget = searchText.replace(/[\s？?。！!]+/gu, '').replace(/(?:在哪里|在哪|是什么|是谁|哪来的|呢)$/u, '');
    if (shortTarget !== searchText.trim() && /^\p{Script=Han}{2,3}$/u.test(shortTarget) && specificArchiveTerm(shortTarget)
        && !/^(?:继续|接着|后来|之前|然后|以后|过去|怎样|什么|如何|记得|知道|有人|结果)$/u.test(shortTarget)) needles.add(shortTarget);
    if (!needles.size && !relatedByFloor.size && !explicitFloors.size) return '';
    const boxes = archives.filter(box => box.fromMessageId < beforeId && (box.facts || (box.strategy === 'summary' && box.toMessageId < beforeId)));
    if (!boxes.length) return '';
    const deletedSources = new Set(boxes.flatMap(box =>
        (box.facts ?? []).filter(fact => fact.vectorTextState === 'deleted').map(fact => fact.sourceMessageId)));
    const turnScopedSources = new Set(boxes.flatMap(box =>
        (box.facts ?? []).filter(fact => fact.authorScope === 'turn').map(fact => fact.sourceMessageId)));
    const hits: { id: number; index: number; excerpt: string; score: number; explicit: boolean }[] = [];
    for (const row of rows) {
        if (row.id >= beforeId || deletedSources.has(row.id) || (row.role === 'user' && turnScopedSources.has(row.id))
            || !boxes.some(box => box.fromMessageId <= row.id && row.id <= box.toMessageId)) continue;
        const content = extractContent({ choices: [{ message: { content: row.content } }] }, false);
        for (const [index, sentence] of storySentences(content).entries()) {
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
            const explicit = floor !== undefined && explicitFloors.has(floor);
            if ((!score && !explicit) || storyArchiveRepeatsPreset(sentence, '', baseline)) continue;
            const start = Math.max(0, offset - 32);
            const excerpt = (start ? '…' : '') + sentence.slice(start, start + 128).trim()
                + (sentence.length > start + 128 ? '…' : '');
            hits.push({ id: row.id, index, excerpt, score, explicit });
        }
    }
    const seen = new Set<string>();
    const firstByFloor = new Map<number, typeof hits>();
    const extra: typeof hits = [];
    const limit = explicitFloors.size || [...needles].some(term => term.length < 4) ? 4 : 2;
    hits.sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.score - a.score || b.id - a.id);
    for (const hit of hits) {
        if (seen.has(hit.excerpt)) continue;
        seen.add(hit.excerpt);
        if (firstByFloor.has(hit.id)) extra.push(hit);
        else if (firstByFloor.size < limit) firstByFloor.set(hit.id, [hit]);
    }
    let spare = limit - firstByFloor.size;
    for (const hit of extra) {
        if (spare <= 0) break;
        const floorHits = firstByFloor.get(hit.id);
        if (!floorHits || floorHits.length >= 2) continue;
        floorHits.push(hit);
        spare--;
    }
    return [...firstByFloor].sort(([a], [b]) => a - b).map(([id, excerpts]) =>
        `[第 ${floorNumbers.get(id)} 楼] ${excerpts.sort((a, b) => a.index - b.index).map(hit => hit.excerpt).join(' … ')}`).join('\n');
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
        ...(archive.historyFacts ?? []).filter(fact => !fact.mergedIntoKey).map(fact => ({ fact, phase: '历史' })),
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
    vectorTexts?: ReadonlyMap<string, string>, explicitFloors: ReadonlySet<number> = new Set(),
): StoryArchiveFact[] {
    const timeline = archives.filter(box => box.fromMessageId < beforeId)
        .sort((a, b) => a.toMessageId - b.toMessageId)
        .flatMap(box => [...(box.historyFacts ?? []), ...(box.facts ?? [])])
        .filter(fact => fact.sourceMessageId < beforeId)
        .flatMap(fact => {
            if (!vectorTexts || !fact.vectorNodeId) return [fact];
            const text = vectorTexts.get(fact.vectorNodeId);
            return text ? [{ ...fact, text }] : [];
        })
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
    const requestedFloor = (fact: StoryArchiveFact) => explicitFloors.has(floorNumbers.get(fact.sourceMessageId) ?? -1);
    const directMatches = earlier.filter(fact => requestedFloor(fact) || relatedKeys.has(fact.key)
        || (normalizedQuery && storyArchiveSearchTerms(fact).some(term => {
            const token = normalize(term);
            return token.length >= 2 && normalizedQuery.includes(token);
        })));
    // Do not flood the current scene with unrelated old states merely because
    // they are recent. A vague continuation gets at most the most recent two.
    const priority = directMatches.length
        ? rankStoryArchiveFacts(directMatches, query).sort((a, b) => Number(requestedFloor(b)) - Number(requestedFloor(a)))
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
