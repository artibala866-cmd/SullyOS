import type { CharacterProfile, Emoji, Message } from '../types';
import { adaptTavernOpeningGreeting } from './tavernOpeningGreeting';

type Role = 'user' | 'assistant';
type Clock = { hour: number; minute: number; second: number };
type Day = { year?: number; month: number; day: number };
type Line = { role: Role; text: string; clock?: Clock; day?: Day };
type OpeningNames = { character: string; user?: string; originalName?: string };
export type PrivateChatOpening = { id: string; title: string; lines: Line[] };

const datePattern = '(?:(\\d{4})[年./-])?(\\d{1,2})[月./-](\\d{1,2})[日号]?';
const timePattern = '(?:(上午|下午|中午|晚上|凌晨)\\s*)?(\\d{1,2})[:：](\\d{2})(?:[:：](\\d{2}))?\\s*(AM|PM)?';
const dayOnly = new RegExp('^' + datePattern + '$');
const timestampPattern = '(?:' + datePattern + '[\\sT]+)?' + timePattern;
const clockOnly = new RegExp('^' + timestampPattern + '$', 'i');
const textRecord = new RegExp('^[\\[【]?(?<stamp>' + timestampPattern + ')[\\]】]?(?:\\s*[·|｜]\\s*|\\s+)(?<sender>[^:：]{1,50})[:：]\\s*(?<body>.+)$', 'i');

function parseDay(year: string | undefined, month: string, day: string): Day | undefined {
    const parts = { year: year ? Number(year) : undefined, month: Number(month), day: Number(day) };
    const date = new Date(parts.year ?? 2000, parts.month - 1, parts.day);
    if (date.getMonth() + 1 === parts.month && date.getDate() === parts.day && (!parts.year || date.getFullYear() === parts.year)) return parts;
}

function parseClock(raw: string): Pick<Line, 'clock' | 'day'> | null {
    const match = clockOnly.exec(raw.trim());
    if (!match) return null;
    const [, year, month, date, period, hours, minutes, seconds, meridiem] = match;
    const day = month ? parseDay(year, month, date) : undefined;
    if (month && !day) return null;
    let hour = Number(hours);
    const minute = Number(minutes);
    const second = Number(seconds ?? 0);
    if (hour > 23 || minute > 59 || second > 59 || (meridiem && (hour < 1 || hour > 12))) return null;
    if (/^(下午|中午|晚上|pm)$/i.test(period || meridiem || '') && hour < 12) hour += 12;
    if (/^(上午|凌晨|am)$/i.test(period || meridiem || '') && hour === 12) hour = 0;
    return { day, clock: { hour, minute, second } };
}

const nameKey = (value: string) => value.trim().toLowerCase();
const speaker = (name: string, names: OpeningNames): Role | undefined => {
    const key = nameKey(name);
    if (!key) return;
    if (['我', '用户', '玩家', '己方', '自己', '本人', 'user', 'me', '{{user}}', nameKey(names.user || '')].includes(key)) return 'user';
    if (['对方', '角色', '助手', 'char', 'assistant', '{{char}}', nameKey(names.character), nameKey(names.originalName || '')].includes(key)) return 'assistant';
};

const recordRole = (label: string, names: OpeningNames): Role | undefined => {
    const key = label.trim().replace(/^(?:收到的|发出的)(?=消息)/, prefix => prefix === '收到的' ? '对方' : '己方')
        .replace(/(?:发送的|发来的)?(?:私聊)?(?:消息|讯息|短信|发言|message)$/i, '');
    return speaker(key, names);
};
const isAvatar = (value: string) => /^(?:https?:\/\/\S+|(?:[^\s<>|｜]*\/)?[^\s<>|｜]+\.(?:png|webp|gif|jpe?g|avif|svg)|(?:默认)?头像|null|none)$/i.test(value);
const cleanBody = (value: string) => value.replace(/<br\s*\/?>/gi, '\n').trim();

/** Detect a private transcript by its message structure and speaker roles. */
export function parsePrivateChatOpening(source: string, names: OpeningNames): Line[] {
    const text = source.replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|iframe|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/\r\n?/g, '\n');
    if (/^\s*[\[【](?:和[^\n\]】]+的)?群聊|^\s*[\[【](?:群聊消息|group[ _-]?message)\s*[|｜]/im.test(text)) return [];
    const records = text.match(/<(?:msg|message|chatmsg)\b[^>]*>[\s\S]*?<\/(?:msg|message|chatmsg)\s*>|[\[【][^\n|｜\]】]{1,50}[|｜][\s\S]*?[\]】](?=[ \t]*(?:\n|$))|[^\n]+/gi) || [];
    const lines: Line[] = [];
    let currentDay: Day | undefined;
    let currentClock: Clock | undefined;
    let currentSpeaker: Role | undefined;
    for (const item of records) {
        const line = item.trim();
        const wrapped = /^(?:<(?:msg|message|chatmsg)\b[^>]*>([\s\S]*?)<\/(?:msg|message|chatmsg)\s*>|[\[【]([\s\S]*)[\]】])$/i.exec(line);
        const inner = wrapped?.[1] ?? wrapped?.[2] ?? line;
        const parts = inner.split(/[|｜]/).map(part => part.trim());
        const tag = /^<(?:msg|message|chatmsg)\b([^>]*)>/i.exec(line);
        if (tag && /\S/.test(tag[1])) {
            const attrs = new Map(Array.from(tag[1].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g),
                match => [match[1].toLowerCase(), match[2] ?? match[3]]));
            const role = speaker(attrs.get('role') || attrs.get('sender') || attrs.get('from') || '', names);
            const stamp = parseClock(attrs.get('timestamp') || attrs.get('time') || '');
            if (role && cleanBody(inner)) {
                currentDay = stamp?.day || currentDay;
                currentClock = stamp?.clock || currentClock;
                lines.push({ role, text: cleanBody(inner), day: currentDay, clock: currentClock });
                continue;
            }
        }
        if (wrapped && parts.length >= 2) {
            const leadingClock = parseClock(parts[0]);
            const offset = leadingClock ? 1 : 0;
            const generic = /^(?:私聊)?(?:消息|讯息|短信|msg|message)$/i.test(parts[offset]);
            const role = recordRole(parts[offset + Number(generic)] || '', names);
            if (!role) continue;
            const fields = parts.slice(offset + Number(generic) + 1);
            const lastClock = parseClock(fields.at(-1) || '');
            const firstClock = lastClock ? null : parseClock(fields[0] || '');
            if (lastClock) fields.pop();
            if (firstClock) fields.shift();
            if (fields.length > 1 && (isAvatar(fields[0]) || speaker(fields[0], names) || fields[0] === '')) fields.shift();
            const stamp = lastClock || firstClock || leadingClock;
            if (stamp?.day) currentDay = stamp.day;
            if (stamp?.clock) currentClock = stamp.clock;
            const body = cleanBody(fields.join('|'));
            if (body) lines.push({ role, text: body, day: currentDay, clock: currentClock });
            continue;
        }
        const header = inner.replace(/^\*\*|\*\*$/g, '').trim();
        const dated = dayOnly.exec(header);
        if (dated) {
            currentDay = parseDay(dated[1], dated[2], dated[3]) || currentDay;
            currentClock = undefined;
            currentSpeaker = undefined;
            continue;
        }
        const stamp = parseClock(header);
        if (stamp) {
            currentDay = stamp.day || currentDay;
            currentClock = stamp.clock;
            currentSpeaker = undefined;
            continue;
        }
        const grouped = /^(.*?)\s*[·｜|]\s*(.+)$/.exec(header);
        if (grouped) {
            const stamp = parseClock(grouped[1]) || parseClock(grouped[2]);
            const role = speaker(grouped[1], names) || speaker(grouped[2], names);
            if (stamp && role) {
                currentDay = stamp.day || currentDay;
                currentClock = stamp.clock;
                currentSpeaker = role;
                continue;
            }
        }
        const timed = textRecord.exec(line)?.groups;
        const plain = /^([^:：]{1,50})[:：]\s*(.+)$/.exec(line);
        const role = timed ? speaker(timed.sender, names) : plain ? speaker(plain[1], names) : undefined;
        if (role && (timed || currentClock)) {
            const stamp = timed && parseClock(timed.stamp);
            if (stamp && stamp.day) currentDay = stamp.day;
            if (stamp && stamp.clock) currentClock = stamp.clock;
            lines.push({ role, text: cleanBody(timed?.body ?? plain?.[2] ?? ''), day: currentDay, clock: currentClock });
        } else if (currentSpeaker && !wrapped && line && !/^<|^```/.test(line)) {
            lines.push({ role: currentSpeaker, text: cleanBody(line), day: currentDay, clock: currentClock });
        }
    }
    return lines.some(line => line.role === 'assistant') ? lines : [];
}

type OpeningCharacter = Pick<CharacterProfile, 'name' | 'cardImportOrigin' | 'tavernGreetings' | 'linkGreetings'>;
export function listPrivateChatOpenings(character: OpeningCharacter, user?: string): PrivateChatOpening[] {
    const tavern = Array.isArray(character.tavernGreetings) ? character.tavernGreetings : [];
    const link = Array.isArray(character.linkGreetings) ? character.linkGreetings : [];
    const manifest = tavern.find(greeting => greeting?.id === 'tavern-first')?.content;
    const titles = new Map(Array.from((typeof manifest === 'string' ? manifest : '').matchAll(/^\s*开场白\s*(\d+)\s*[:：]\s*(.+)$/gm), match => [match[1], match[2].trim()]));
    return [...tavern, ...link].flatMap(greeting => {
        if (typeof greeting?.content !== 'string') return [];
        const adapted = adaptTavernOpeningGreeting(greeting);
        const lines = parsePrivateChatOpening(adapted.content, { character: character.name, originalName: character.cardImportOrigin?.originalName, user });
        if (!lines.length) return [];
        const index = /^tavern-alt-(\d+)(?:$|-)/.exec(greeting.id)?.[1];
        const title = index && adapted.title === '备选开场白 ' + index
            ? titles.get(index) || adapted.title : adapted.title;
        return [{ id: greeting.id, title, lines }];
    });
}

const clockSeconds = (clock: Clock) => clock.hour * 3600 + clock.minute * 60 + clock.second;
const sticker = /^\s*(?:<(?:bqb|emoji|sticker)>([\s\S]*?)<\/(?:bqb|emoji|sticker)>|[\[【［](?:表情包?|贴纸|emoji|sticker)\s*[:：]\s*(.*?)[\]】］])\s*$/i;
const stickerName = (raw: string) => raw.trim().split('/').at(-1)!.replace(/\.(?:gif|jpe?g|png|webp)$/i, '').trim();

export function privateChatDisplayTimestamp(message: Pick<Message, 'timestamp' | 'metadata'>): number {
    const plotTime = message.metadata?.privateChatOpeningTimestamp;
    return message.metadata?.source === 'private_chat_opening' && Number.isFinite(plotTime) ? plotTime : message.timestamp;
}

export function buildPrivateChatOpeningMessages(
    opening: PrivateChatOpening, charId: string, names: OpeningNames, emojis: readonly Emoji[], now = new Date(),
): Array<Omit<Message, 'id'>> {
    let day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let explicitDay: Day | undefined;
    let previousClock: Clock | undefined;
    const insertedAt = now.getTime();
    let plotTime = insertedAt;
    return opening.lines.map(line => {
        if (line.day && line.day !== explicitDay) {
            explicitDay = line.day;
            day = new Date(line.day.year ?? now.getFullYear(), line.day.month - 1, line.day.day);
            previousClock = undefined;
        }
        if (line.clock) {
            if (previousClock && clockSeconds(previousClock) - clockSeconds(line.clock) > 12 * 3600) {
                day.setDate(day.getDate() + 1);
            }
            plotTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), line.clock.hour, line.clock.minute, line.clock.second).getTime();
            previousClock = line.clock;
        } else if (explicitDay) {
            plotTime = day.getTime();
        }
        const body = line.text.replace(/\{\{\s*(char|user)\s*\}\}/gi,
            (_macro, name: string) => name.toLowerCase() === 'char' ? names.character : names.user || '我');
        const match = sticker.exec(body);
        const stem = match ? stickerName(match[1] ?? match[2]) : '';
        const label = match?.[0].startsWith('<bqb>') ? stem.replace(/([^\x00-\x7F])[a-z0-9]{6}$/i, '$1') : stem;
        const emoji = label && emojis.find(item => [label, stem].includes(item.name.trim()));
        return {
            charId, role: line.role, timestamp: insertedAt,
            type: emoji ? 'emoji' : 'text',
            content: emoji ? emoji.url : match ? `［表情包${label ? '：' + label : ''}］` : body,
            // Plot clocks can be in the future. Keep the actual append time for
            // context ordering, unread counters and reply pacing.
            metadata: {
                source: 'private_chat_opening', openingId: opening.id, historyImported: true,
                countsAsReply: false, privateChatOpeningTimestamp: plotTime,
            },
        };
    });
}
