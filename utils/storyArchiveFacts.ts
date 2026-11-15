import type { StoryArchiveFact, StoryTheaterArchive } from '../types';

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
    if (/(?:据说|传闻|听说|怀疑|猜测|尚未证实|未经证实|无人证实|尚未核实|未确认|可能存在)/u.test(text)
        && !/(?:最终证实|已经证实|查明真相|明确证实|证据表明)/u.test(text)) return 'unverified';
    const intends = /(?:打算|计划|准备于|准备在|决定.{0,55}(?:后|前|以后|之后|明天|下周|改天)|承诺.{0,35}(?:以后|明天|今后|将来|下周)|将要|拟于)/u.test(text);
    if (intends && !/(?:计划已经完成|计划已完成|打算已取消|放弃计划|取消计划|终于做到了|最终完成|随后已经前往|后来已经前往)/u.test(text)) return 'planned';
    return undefined;
}


const timeOfDay = '(?:凌晨|清晨|早晨|早上|上午|中午|下午|午后|傍晚|晚上|夜里|深夜|半夜)';
const date = '(?:[0-9]{4}年)?[0-9]{1,2}月[0-9]{1,2}日|[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}';
const count = '[一二三四五六七八九十百零两0-9]+';
const day = `第${count}[天日]|${count}(?:天|日|周|个月|年|小时|分钟)(?:后|前)|翌日|次日|隔天|当天|当晚|今夜|昨日|昨天|今天|明天|后天|昨晚|前一天|头七(?:前夜|当天)?|[春夏秋冬]日`;
const time = String.raw`(?:(?:${date}|${day})(?:的)?(?:${timeOfDay})?|${timeOfDay})(?:\s*(?:[0-9]{1,2}:[0-9]{2}|${count}(?:点|时)(?:半|${count}分)?))?|[0-9]{1,2}:[0-9]{2}`;
const leadingTime = new RegExp(String.raw`^\s*(?:[【\[]|(?:剧情时间|时间)[:：]\s*)?(${time})(?=$|[\s，,。！!？?；;：:、】\]])`, 'u');

/** Read the scene's opening time. A time mentioned mid-paragraph may belong to a different event. */
export function storyTimeFromSource(source: string): string | undefined {
    return source.normalize('NFKC').match(leadingTime)?.[1];
}

/** A standalone time heading can also label the immediately following floor. */
export function storyArchiveSourceTimes(rows: readonly { id: number; content: string; metadata?: { theaterContinue?: unknown } }[]): Map<number, string> {
    const times = new Map<number, string>();
    let heading: string | undefined;
    for (const row of rows) {
        if (row.metadata?.theaterContinue) continue;
        const time = storyTimeFromSource(row.content);
        const sceneTime = time ?? heading;
        if (sceneTime) times.set(row.id, sceneTime);
        const rest = row.content.normalize('NFKC').replace(leadingTime, '').trim();
        heading = time && /^[\s，,。！!？?；;：:、】\]]*$/u.test(rest) ? time : undefined;
    }
    return times;
}

export const STORY_INCREMENTAL_ARCHIVE_INSTRUCTION = [
    '任务：为连续剧情写入增量记忆。已有记忆只是核对用的旧状态。证据只能引用本批新楼层，不复述旧事件或完整故事。',
    '只输出 JSON 对象 {"changes":[]}。每条包含 action、key、kind、text、terms、sourceMessageId；quote 为可选原文摘录。',
    'action 只能是 add 或 update。新增事实用 add；已有事实发生变化、被纠正或已解决，用 update 并原样沿用旧 key；只是重复提及、没有变化，直接略过。本批没有变化时返回空数组。',
    'key 是稳定的「对象/属性或事项」，同一物件的持有人、同一条承诺的状态、同一角色的知情状态各有一个 key；不要把新值、楼号或句子写进 key。若同一 key 在本批楼层变化多次，按发生顺序输出多条 change（逐条提供真实楼层记录 ID），系统会保留中间经过和最后状态。',
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

export function collectStoryArchiveFacts(
    archives: StoryTheaterArchive[], beforeId: number, vectorTexts: ReadonlyMap<string, string>,
): StoryArchiveFact[] {
    const current = new Map<string, StoryArchiveFact>();
    for (const archive of archives.filter(item => item.toMessageId < beforeId).sort((a, b) => a.toMessageId - b.toMessageId)) {
        for (const fact of archive.facts ?? []) current.set(fact.key, fact);
    }
    return [...current.values()].flatMap(fact => {
        if (fact.vectorTextState === 'deleted') return [];
        // The vector loader checks the latest persisted archive before falling
        // back to its synced copy. Never use an old tab's copy directly: that
        // could revive a fact explicitly deleted in a newer tab.
        const text = fact.vectorNodeId ? vectorTexts.get(fact.vectorNodeId) : fact.text;
        return text?.trim() ? [{ ...fact, text }] : [];
    });
}

export function rankStoryArchiveFacts(
    facts: StoryArchiveFact[], query: string, semanticRank: ReadonlyMap<string, number> = new Map(),
): StoryArchiveFact[] {
    const text = normalize(query);
    const bySemanticMatch = (fact: StoryArchiveFact) => semanticRank.get(fact.vectorNodeId ?? '') ?? Number.MAX_SAFE_INTEGER;
    return facts.map(fact => ({
        fact,
        matches: fact.terms.reduce((score, term) => score + (text.includes(normalize(term)) ? term.length : 0), 0),
    })).sort((a, b) => Number(b.fact.kind === 'author') - Number(a.fact.kind === 'author')
        || b.matches - a.matches || bySemanticMatch(a.fact) - bySemanticMatch(b.fact) || b.fact.sourceMessageId - a.fact.sourceMessageId).map(item => item.fact);
}

/** Normalize only Unicode form and whitespace when checking a verbatim source quote.
 * A fact without a quote grounded in the actual floors must never be archived. */
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
        if (fact.kind === 'author' || (variants.get(fact.key)?.size ?? 0) > 1) return true;
        return !storyArchiveRepeatsPreset(fact.text, fact.key, baseline);
    });
}

export function parseStoryArchiveChanges(
    raw: string, sources: ReadonlyMap<number, { text: string; authorInput: boolean; floorNumber?: number }>, known: StoryArchiveFact[], baseline = '',
    onEarlierState?: (fact: StoryArchiveFact) => void, sourceTimes?: ReadonlyMap<number, string>,
): StoryArchiveFact[] {
    const invalid = (detail: string) => new Error(`增量归档格式或来源无效（${detail}），原文和旧归档已保留`);
    let value: unknown;
    try {
        value = decodeArchiveChanges(raw);
    } catch {
        throw invalid('模型没有返回完整的 changes JSON');
    }
    if (!value || typeof value !== 'object' || !('changes' in value) || !Array.isArray(value.changes)) {
        throw invalid('缺少 changes 数组');
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
        const text = change.text.trim();
        const kind: 'fact' | 'author' = change.kind ?? 'fact';
        const modality = kind === 'fact' && (change.modality === 'planned' || change.modality === 'unverified')
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
        const claimedTime = typeof change.storyTime === 'string' ? change.storyTime.trim() : '';
        const localTime = storyTimeFromSource(source.text);
        // A quoted clause can establish an event's own time inside a multi-event floor.
        const quotedClause = quote && quoteExistsIn(source.text, quote)
            ? source.text.match(/[^。！？\r\n]+[。！？]?/gu)?.find(clause => quoteExistsIn(clause, quote)) : undefined;
        const quoteTime = quotedClause ? storyTimeFromSource(quotedClause) : undefined;
        const storyTime = kind === 'fact' ? (claimedTime && claimedTime === quoteTime
            ? quoteTime : localTime ?? sourceTimes?.get(sourceMessageId)) : undefined;
        const knownState = facts.get(key) ?? existing.get(key);
        if (kind === 'fact' && change.action === 'add' && storyTime && knownState?.storyTime
            && knownState.storyTime !== storyTime && comparable(knownState.text) === comparable(text)) {
            key += '/来源' + sourceMessageId;
        }
        const previous = existing.get(key);
        if (previous && previous.kind !== kind) throw invalid(`第 ${index + 1} 条改变了已有记忆类型`);
        const fact = { key, kind, text, sourceMessageId, ...(storyTime ? { storyTime } : {}), ...(modality ? { modality } : {}) };
        const comparableText = signature(fact);
        const oldInBatch = facts.get(key);
        if (oldInBatch && oldInBatch.sourceMessageId > sourceMessageId) continue;
        if (oldInBatch && signature(oldInBatch) === comparableText) continue;
        const sameState = previous && comparable(previous.text) === comparable(text) && previous.modality === modality;
        if (sameState && !oldInBatch && change.action !== 'add') continue;
        if (duplicateText.has(comparableText) && !oldInBatch && (!previous || sameState)) continue;
        if (!previous && kind === 'fact' && storyArchiveRepeatsPreset(text, key, baseline, source.text)) continue;
        const termCandidates: string[] = change.terms ?? key.split(/[\/：:·-]+/u);
        const terms = [...new Set<string>(termCandidates.map(term => normalize(term)).filter(term => term.length >= 2))];
        if (oldInBatch && oldInBatch.kind === 'fact' && kind === 'fact'
            && oldInBatch.text !== text) onEarlierState?.(oldInBatch);
        facts.set(key, { ...fact, terms });
        duplicateText.add(comparableText);
    }
    return [...facts.values()];
}

/** Relevant facts are chosen first; when sending them to the prose model, order
 * the chosen set by source floor so relevance cannot reverse the storyline.
 */
export function formatStoryArchiveFacts(
    facts: StoryArchiveFact[], floorNumbers?: ReadonlyMap<number, number>, budget = Infinity,
    chronological = false, sourceTimes?: ReadonlyMap<number, string>,
): string {
    let used = 0;
    const selected: { fact: StoryArchiveFact; line: string }[] = [];
    for (const fact of facts) {
        const floor = floorNumbers?.get(fact.sourceMessageId);
        const storyTime = fact.storyTime || sourceTimes?.get(fact.sourceMessageId);
        const annotation = [
            ...(floor ? ['第 ' + floor + ' 楼'] : []),
            ...(storyTime ? ['剧情时间：' + storyTime] : []),
        ];
        const line = (annotation.length ? '[' + annotation.join(' · ') + '] ' : '')
            + (fact.kind === 'author' ? '用户协助指令：' : storyArchiveModality(fact) === 'planned' ? '【尚未发生的计划】' : storyArchiveModality(fact) === 'unverified' ? '【尚未核实的说法】' : '') + fact.text;
        if (used + line.length + 1 > budget && selected.length) continue;
        selected.push({ fact, line });
        used += line.length + 1;
    }
    if (chronological) selected.sort((a, b) => a.fact.sourceMessageId - b.fact.sourceMessageId);
    return selected.map(item => item.line).join('\n');
}

function storyArchiveRecallSections(facts: StoryArchiveFact[]) {
    return [
        {
            title: '已确认的剧情事实（仅表示已经发生，不要求再次发生）',
            entries: facts.filter(fact => fact.kind === 'fact' && !storyArchiveModality(fact)),
            budget: facts.length > 12 ? 1450 : 3200,
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
): boolean {
    return storyArchiveRecallSections(facts).some(({ entries, budget }) =>
        entries.length > 1 && formatStoryArchiveFacts(entries, floorNumbers, Infinity, false, sourceTimes).length + 1 > budget);
}

/** Select relevant facts within each section's budget, then send them in floor order. */
export function formatStoryArchiveProseContext(
    facts: StoryArchiveFact[], query: string,
    floorNumbers?: ReadonlyMap<number, number>,
    semanticRank: ReadonlyMap<string, number> = new Map(),
    sourceTimes?: ReadonlyMap<number, string>,
): string {
    return storyArchiveRecallSections(facts).map(({ title, entries, budget }) => {
        if (!entries.length) return '';
        const text = formatStoryArchiveFacts(
            rankStoryArchiveFacts(entries, query, semanticRank), floorNumbers, budget, true, sourceTimes,
        );
        return text ? '【' + title + '】\n' + text : '';
    }).filter(Boolean).join('\n\n');
}

/** Pull a small, verbatim fallback only for an explicit query absent from the saved facts. */
export function findStoryArchiveEvidence(
    rows: readonly { id: number; content: string }[], archives: StoryTheaterArchive[], beforeId: number,
    query: string, alreadySent: string, baseline: string, floorNumbers: ReadonlyMap<number, number>,
): string {
    const known = normalize(alreadySent);
    const needles = new Set<string>();
    for (const span of normalize(query).match(/\p{Script=Han}{4,}|[a-z0-9]{4,}/gu) ?? []) {
        if (/^[a-z0-9]+$/u.test(span)) {
            if (!known.includes(span)) needles.add(span);
            continue;
        }
        for (let i = 0; i <= span.length - 4; i++) {
            const word = span.slice(i, i + 4);
            if (!known.includes(word)) needles.add(word);
        }
    }
    if (!needles.size) return '';
    const boxes = archives.filter(box => box.strategy === 'vector' && box.facts && box.toMessageId < beforeId);
    if (!boxes.length) return '';
    const deletedSources = new Set(boxes.flatMap(box =>
        (box.facts ?? []).filter(fact => fact.vectorTextState === 'deleted').map(fact => fact.sourceMessageId)));
    const hits: { id: number; excerpt: string; score: number }[] = [];
    for (const row of rows) {
        if (deletedSources.has(row.id) || !boxes.some(box => box.fromMessageId <= row.id && row.id <= box.toMessageId)) continue;
        for (const sentence of row.content.match(/[^。！？\r\n]+[。！？]?/gu) ?? []) {
            const text = normalize(sentence);
            let score = 0;
            let offset = -1;
            for (const word of needles) {
                const index = text.indexOf(word);
                if (index < 0) continue;
                score++;
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
    return hits.sort((a, b) => b.score - a.score || b.id - a.id).filter(hit => {
        if (seen.has(hit.excerpt)) return false;
        seen.add(hit.excerpt);
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
        lines.push(phase === '历史' ? '（当时发生）' + body : '（本段记录）' + body);
    }
    if (archive.affinityLog?.length) lines.push('界面关系变化：' + archive.affinityLog.join('；'));
    return lines;
}

/** Keep important earlier states as a clearly labelled historical sequence.
 * The latest state is supplied separately, so old facts cannot overwrite it.
 */
export function formatStoryArchiveTransitions(
    archives: StoryTheaterArchive[], beforeId: number,
    floorNumbers: ReadonlyMap<number, number>, sourceTimes?: ReadonlyMap<number, string>, budget = 1400,
    query = '', baseline = '',
): string {
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
    const directMatches = normalizedQuery ? earlier.filter(fact => fact.terms.some(term => {
        const token = normalize(term);
        return token.length >= 2 && normalizedQuery.includes(token);
    })) : [];
    // Do not flood the current scene with unrelated old states merely because
    // they are recent. A vague continuation gets at most the most recent two.
    const priority = directMatches.length
        ? rankStoryArchiveFacts(directMatches, query)
        : query.trim() ? earlier.slice(0, 2) : earlier;
    for (const fact of priority) {
        const line = formatStoryArchiveFacts([fact], floorNumbers, Infinity, false, sourceTimes);
        if (used + line.length + 1 > budget) continue;
        selected.push(fact);
        used += line.length + 1;
    }
    selected.sort((a, b) => a.sourceMessageId - b.sourceMessageId);
    return formatStoryArchiveFacts(selected, floorNumbers, Infinity, true, sourceTimes);
}
