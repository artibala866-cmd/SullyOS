import type { CharacterProfile, Emoji, Message } from '../types';
import { adaptTavernOpeningGreeting, normalizeOpeningText } from './tavernOpeningGreeting';

type Role = 'user' | 'assistant';
type Clock = { hour: number; minute: number; second: number };
type Day = { year?: number; month: number; day: number };
type Line = { role: Role; text: string; clock?: Clock; day?: Day };
type OpeningNames = { character: string; user?: string; originalName?: string };
export type PrivateChatOpeningSource = { field: 'tavernGreetings' | 'linkGreetings'; id: string; content: string };
export type PrivateChatOpening = { id: string; title: string; lines: Line[]; source?: PrivateChatOpeningSource };

const datePattern = '(?:(\\d{4})[年./-])?(\\d{1,2})[月./-](\\d{1,2})[日号]?';
const timePattern = '(?:(上午|下午|中午|晚上|凌晨)\\s*)?(\\d{1,2})[:：](\\d{2})(?:[:：](\\d{2}))?\\s*(AM|PM)?';
const dayOnly = new RegExp('^' + datePattern + '$');
const timestampPattern = '(?:' + datePattern + '[\\sT-]+)?' + timePattern;
const clockOnly = new RegExp('^' + timestampPattern + '(?:Z|[+-]\\d{2}:?\\d{2})?$', 'i');
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

const nameKey = (value: string) => normalizeOpeningText(value).toLowerCase().replace(/^\{\{(char|user)\}\}$/, '$1');
const speaker = (name: string, names: OpeningNames): Role | undefined => {
    const key = nameKey(name);
    if (!key) return;
    if (/^(?:我|我方|用户|玩家|己方|自己|本人|user|me|self|own|human|player|outgoing|sent|send|right|outbound)$/.test(key)
        || key === nameKey(names.user || '')) return 'user';
    if (/^(?:对方|角色|助手|char|character|assistant|bot|other|incoming|received|receive|left|inbound)$/.test(key)
        || key === nameKey(names.character) || key === nameKey(names.originalName || '')) return 'assistant';
};

const recordRole = (label: string, names: OpeningNames): Role | undefined => {
    const key = label.trim().replace(/^(?:收到|接收)(?:的)?(?=消息|短信)/, '对方')
        .replace(/^(?:发出|发送)(?:的)?(?=消息|短信)/, '己方')
        .replace(/(?:发送的|发来的)?(?:私聊)?(?:消息|讯息|短信|发言|[-_ ]?(?:message|msg))$/i, '');
    const parentheticalName = /[（(]([^）)]+)[）)]$/.exec(key)?.[1];
    return speaker(label, names) || speaker(key, names) || (parentheticalName ? speaker(parentheticalName, names) : undefined);
};
const isAvatar = (value: string) => /^(?:https?:\/\/\S+|(?:[^\s<>|｜]*\/)?[^\s<>|｜]+\.(?:png|webp|gif|jpe?g|avif|svg)|(?:默认)?头像|null|none)$/i.test(value);
const cleanBody = (value: string) => value.replace(/<br\s*\/?>/gi, '\n').trim();

const hasGroupContext = (text: string) => /(?:^|\n)\s*[\[【]?(?:和[^\n\]】]+的)?(?:群聊(?:记录|消息|对话)?|group chat)(?=\s|[\]】:：|｜]|$)|[\[【](?:群聊消息|group[ _-]?message)\s*[|｜]/im.test(text);
const phoneHeading = /^(?:\[|【|#+\s*)?(?:手机(?:聊天|对话|消息|记录)|私聊(?:记录|对话)?|(?:微信|短信|QQ|聊天)(?:聊天|对话|消息)?(?:记录)?|(?:和|与).{1,50}的(?:聊天|私聊|对话)|(?:private|direct|phone) chat)\s*[\]】:：]?$/i;
const markupText = (text: string) => cleanBody(text.replace(/<\/?(?:b|strong|em|i|span|p|div)\b[^>]*>/gi, '')
    .replace(/&(?:amp|nbsp|lt|gt|quot);/gi, entity => ({ '&amp;':'&', '&nbsp;':' ', '&lt;':'<', '&gt;':'>', '&quot;':'"' })[entity.toLowerCase()] || entity));
const object = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const field = (row: Record<string, unknown>, keys: string[]) => keys.map(key => row[key])
    .find((value): value is string => typeof value === 'string' && !!value.trim())?.trim() || '';

function structuredOpening(text: string, names: OpeningNames): Line[] | undefined {
    const payload = /^```(?:json|jsonl)?[ \t]*\n([\s\S]*?)^```[ \t]*$/im.exec(text)?.[1] || text.trim();
    if (!/^[\[{]/.test(payload.trimStart())) return;
    let data: unknown;
    try { data = JSON.parse(payload); } catch { return; }
    const root = object(data);
    const conversation = object(root?.conversation ?? root?.chat) || root;
    if (root?.isGroup === true || conversation?.isGroup === true ||
        /^(?:group|group_chat|群聊)$/i.test(field(conversation || {}, ['type', 'kind', 'chatType']))) return [];
    const messages = Array.isArray(data) ? data :
        [conversation?.messages, conversation?.chat, conversation?.conversation, conversation?.transcript, conversation?.['聊天记录']]
            .find(Array.isArray);
    if (!messages) return;
    let day = parseHeaderDay(field(conversation || {}, ['date', 'day', '日期']));
    const rows: Line[] = [];
    for (const message of messages) {
        const row = object(message);
        if (!row) return [];
        if (/^(?:system|tool|notification|系统)$/i.test(field(row, ['role', 'sender']))) continue;
        const text = markupText(field(row, ['content', 'text', 'body', 'message', '内容', '消息']));
        const role = ['role', 'direction', 'sender', 'from', 'author', 'speaker', '发送者', '发件人']
            .map(key => recordRole(field(row, [key]), names)).find(Boolean)
            || (typeof row.isSelf === 'boolean' ? row.isSelf ? 'user' : 'assistant' : undefined)
            || (typeof row.is_user === 'boolean' ? row.is_user ? 'user' : 'assistant' : undefined);
        if (!role || !text) return [];
        const stamp = parseClock(field(row, ['timestamp', 'time', 'datetime', 'sentAt', '时间']));
        day = stamp?.day || day;
        rows.push({ role, text, day, clock: stamp?.clock });
    }
    return rows;
}

function parseHeaderDay(text: string): Day | undefined {
    const dated = dayOnly.exec(text);
    return dated ? parseDay(dated[1], dated[2], dated[3]) : undefined;
}

/** Read pre-rendered bubbles as inert text. Template contents never enter the live DOM. */
function htmlOpening(text: string, names: OpeningNames): Line[] {
    if (typeof document === 'undefined' || !/<(?:div|span|li|p|article|section)\b/i.test(text)) return [];
    const template = document.createElement('template');
    template.innerHTML = text;
    const nodes = template.content.querySelectorAll('[data-role], [data-direction], [data-sender], [class]');
    const rows: Line[] = [];
    let lastMessage: Element | undefined;
    for (const node of nodes) {
        if (lastMessage?.contains(node)) continue;
        const classes = (node.getAttribute('class') || '').toLowerCase().split(/\s+/);
        const hint = classes.find(word => /^(?:(?:message|msg|bubble|chat|wechat)[-_])?(?:sent|received|incoming|outgoing|left|right|user|assistant|self|other)$/.test(word));
        const side = hint?.replace(/^(?:message|msg|bubble|chat|wechat)[-_]/, '');
        const explicit = node.getAttribute('data-role') || node.getAttribute('data-direction') || node.getAttribute('data-sender');
        const role = recordRole(explicit || side || '', names);
        if (!role) continue;
        const body = node.querySelector('[data-content], .message-text, .msg-text, .bubble-text, .message-content');
        if (!body && !explicit && !classes.some(word => /message|msg|bubble|chat/.test(word))) continue;
        const clockNode = node.querySelector('time, .timestamp, .message-time, .msg-time');
        const stamp = parseClock(node.getAttribute('data-time') || '') ||
            parseClock(clockNode?.getAttribute('datetime') || '') || parseClock(clockNode?.textContent || '');
        const copy = (body || node).cloneNode(true) as Element;
        copy.querySelectorAll('time, .timestamp, .message-time, .msg-time, .sender, .avatar, script, style, iframe, template').forEach(element => element.remove());
        copy.querySelectorAll('br').forEach(element => element.replaceWith('\n'));
        const content = copy.textContent?.trim() || '';
        if (content) rows.push({ role, text: content, ...stamp });
        lastMessage = node;
    }
    return rows;
}

const hasCharacterLine = (lines: Line[]) => lines.some(line => line.role === 'assistant');
const bracketConversation = /^\s*[\[【](?:和|与)(.{1,50}?)的(?:聊天|私聊|对话)[\]】]\s*$/im;
const phonePanel = /^\s*<(?:手机(?:界面|聊天|对话)|私聊|微信聊天)(?:[:：][^>\n]*)?>\s*$/im;
const messageSeparator = /[|｜丨]/;

function statusOpeningStamp(text: string): Pick<Line, 'clock' | 'day'> | undefined {
    const status = /<status\b[^>]*>([\s\S]*?)<\/status>/i.exec(text)?.[1];
    // A status header may give the scene clock. Ignore times buried in
    // notifications and only use an explicit full date and time at the row end.
    const header = status?.match(/^\s*\|[^|\n]+\|([^|\n]+)\s*$/m)?.[1];
    const stamp = header && parseClock(header);
    return stamp && stamp.day?.year ? stamp : undefined;
}

/** Detect a private transcript by its message structure and speaker roles. */
export function parsePrivateChatOpening(source: string, names: OpeningNames, phoneHint = false): Line[] {
    const text = source.replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|iframe|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/\r\n?/g, '\n');
    if (hasGroupContext(text)) return [];
    const structured = structuredOpening(text, names);
    if (structured) return hasCharacterLine(structured) ? structured : [];
    const html = htmlOpening(text, names);
    if (hasCharacterLine(html)) return html;
    const conversation = bracketConversation.exec(text)?.[1];
    const phoneContext = phoneHint || !!conversation || phonePanel.test(text) ||
        text.split('\n').some(line => phoneHeading.test(line.trim()));
    // A new record or tag bounds continuation, so an unclosed bracket
    // cannot consume the next message while a wrapped multiline body still works.
    const records = text.replace(/^[ \t]+/gm, '').match(/<(?:msg|message|chatmsg)\b[^>]*>[\s\S]*?<\/(?:msg|message|chatmsg)\s*>|[\[【][^\n|｜丨\]】]{1,50}[|｜丨][^\n]*(?:\n(?![\[【<])[^\n]*)*?[\]】](?=[ \t]*(?:\n|$))|[^\n]+/gi) || [];
    const lines: Line[] = [];
    const incomingAvatars = new Set<string>();
    let currentDay: Day | undefined;
    let currentClock: Clock | undefined;
    let currentSpeaker: Role | undefined;
    for (const item of records) {
        const line = item.trim();
        const label = /^[\[【]([^\]】]+)[\]】]\s*[:：]\s*(.+)$/.exec(line);
        const wrapped = /^(?:<(?:msg|message|chatmsg)\b[^>]*>([\s\S]*?)<\/(?:msg|message|chatmsg)\s*>|[\[【]([\s\S]*)[\]】])$/i.exec(line);
        const incomplete = phoneContext && !wrapped && !label && /^[\[【][^\]】]+$/.test(line) && messageSeparator.test(line);
        const inner = wrapped?.[1] ?? wrapped?.[2] ?? label?.[1] ?? (incomplete ? line.slice(1) : line);
        const parts = inner.split(messageSeparator).map(part => part.trim());
        const unwrappedFields = !wrapped && phoneContext && parts.length >= 3;
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
        if ((wrapped || label || incomplete || unwrappedFields) && parts.length >= 2) {
            const leadingClock = parseClock(parts[0]);
            const offset = leadingClock ? 1 : 0;
            const generic = /^(?:私聊|微信|手机|QQ)?(?:消息|讯息|短信|msg|message)$/i.test(parts[offset]);
            const role = recordRole(parts[offset + Number(generic)] || '', names);
            if (!role) continue;
            const fields = parts.slice(offset + Number(generic) + 1);
            const lastClock = parseClock(fields.at(-1) || '');
            if (lastClock) fields.pop();
            if (fields.length > 1 && (isAvatar(fields[0]) || speaker(fields[0], names) || fields[0] === '')) {
                if (role === 'assistant' && isAvatar(fields[0]) && !/^(?:默认)?头像|null|none$/i.test(fields[0])) {
                    incomingAvatars.add(fields[0].toLowerCase());
                }
                fields.shift();
            }
            const firstClock = !lastClock && fields.length > 1 ? parseClock(fields[0]) : null;
            if (firstClock) fields.shift();
            const stamp = lastClock || firstClock || leadingClock;
            if (stamp?.day) currentDay = stamp.day;
            if (stamp?.clock) currentClock = stamp.clock;
            const body = cleanBody(label?.[2] ?? fields.join('|'));
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
        const plainLine = markupText(line).replace(/^[-*]>?\s+|^>\s*/, '').replace(/\*\*/g, '');
        const timed = textRecord.exec(plainLine)?.groups;
        const plain = /^([^:：]{1,50})[:：]\s*(.+)$/.exec(plainLine);
        const role = recordRole(timed?.sender ?? plain?.[1] ?? '', names);
        const tail = !timed && /^(.*?)[ \t]+[（(\[【]([^）)\]】]+)[）)\]】]$/.exec(plain?.[2] || '');
        const inlineStamp = timed ? parseClock(timed.stamp) : tail ? parseClock(tail[2]) : null;
        if (role && (inlineStamp || currentClock || phoneContext || /(?:消息|短信|讯息)$/.test(plain?.[1] || ''))) {
            if (inlineStamp?.day) currentDay = inlineStamp.day;
            if (inlineStamp?.clock) currentClock = inlineStamp.clock;
            lines.push({ role, text: cleanBody(timed?.body ?? (tail && inlineStamp ? tail[1] : plain?.[2] ?? '')),
                day: currentDay, clock: currentClock });
        } else if (currentSpeaker && !wrapped && line && !/^<|^```/.test(line)) {
            lines.push({ role: currentSpeaker, text: cleanBody(line), day: currentDay, clock: currentClock });
        }
    }
    // Some group layouts reuse the exact private message label. An unmatched
    // conversation name plus multiple incoming avatars is evidence of multiple senders.
    if (conversation && !recordRole(conversation, names) && incomingAvatars.size > 1) return [];
    if (!hasCharacterLine(lines)) return [];
    const sceneStamp = lines.every(line => !line.clock && !line.day) ? statusOpeningStamp(text) : undefined;
    return sceneStamp ? lines.map(line => ({ ...line, ...sceneStamp })) : lines;
}

type OpeningCharacter = Pick<CharacterProfile, 'name' | 'cardImportOrigin' | 'tavernGreetings' | 'linkGreetings'>;
export function collectPrivateChatOpenings(character: OpeningCharacter, user?: string): PrivateChatOpening[] {
    const tavern = Array.isArray(character.tavernGreetings) ? character.tavernGreetings : [];
    const link = Array.isArray(character.linkGreetings) ? character.linkGreetings : [];
    const manifest = tavern.find(greeting => greeting?.id === 'tavern-first')?.content;
    const titles = new Map(Array.from((typeof manifest === 'string' ? manifest : '').matchAll(/^\s*开场白\s*(\d+)\s*[:：]\s*(.+)$/gm), match => [match[1], match[2].trim()]));
    return (['tavernGreetings', 'linkGreetings'] as const).flatMap(field =>
        (field === 'tavernGreetings' ? tavern : link).flatMap(greeting => {
            if (typeof greeting?.id !== 'string' || typeof greeting.content !== 'string' ||
                greeting.id.startsWith('story-custom-')) return [];
            const adapted = adaptTavernOpeningGreeting(greeting);
            const index = /^tavern-alt-(\d+)(?:$|-)/.exec(greeting.id)?.[1];
            const title = index && adapted.title === '备选开场白 ' + index
                ? titles.get(index) || adapted.title : adapted.title;
            if (/(?:[（(]群聊[)）]|群聊开场)/.test(title)) return [];
            const lines = parsePrivateChatOpening(adapted.content,
                { character: character.name, originalName: character.cardImportOrigin?.originalName, user },
                /(?:[（(]手机[)）]|手机(?:聊天|对话|记录|开场)|私聊|微信聊天|短信记录)/.test(title + ' ' + (adapted.description || '')));
            return lines.length ? [{ id: greeting.id, title, lines,
                source: { field, id: greeting.id, content: greeting.content } }] : [];
        }));
}

export const privateChatOpeningKey = (opening: PrivateChatOpening): string =>
    JSON.stringify(opening.lines.map(({ role, text, day, clock }) => [
        role, normalizeOpeningText(text), day?.year, day?.month, day?.day, clock?.hour, clock?.minute, clock?.second,
    ]));

export function listPrivateChatOpenings(character: OpeningCharacter, user?: string): PrivateChatOpening[] {
    const seen = new Set<string>();
    return collectPrivateChatOpenings(character, user).filter(opening => {
        const key = privateChatOpeningKey(opening);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
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
