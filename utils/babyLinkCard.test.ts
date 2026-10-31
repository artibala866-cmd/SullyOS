import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { CharacterProfile, UserProfile } from '../types';
import { ContextBuilder } from './context';
import { extractBabyLinkCompressed, normalizeBabyLinkShare } from './babyLinkCard';
import { isWorldbookEntryActive, toMountedWorldbook } from './worldbook';

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: id, content: '正文：' + id, enabled: true,
    activation: 'keyword', keys: ['触发'], secondaryKeys: [],
    position: 'before-chat', order: 100, depth: 4, probability: 100, caseSensitive: false, ...extra,
});
const book = (id: string, enabled = true, entries = [entry('默认')]) => ({
    id, title: '设定 ' + id, scope: 'local', enabled, entries,
});
const char = (name: string, ids: string[], extra: Record<string, unknown> = {}) => ({
    name, nickname: '昵称' + name, description: '完整角色背景\n第二段不能丢失',
    signature: '角色签名', avatar: '', localWorldBookIds: ids,
    openings: [{ title: '开场', opening: '不许进入人格' }],
    textRegexRules: [{ find: 'regex', replace: '不要导入' }],
    voomFrequency: 'high', imageProfile: { seed: '过滤种子' },
    ...extra,
});
const share = (characters: unknown[], books: unknown[]) => ({
    magic: 'LINK_CHARACTER_SHARE_PNG_V1', version: 1, exportedAt: 123,
    characters, worldBooks: books, account: { key: 'SECRET' },
});

describe('BabyLink 1.1.10 share conversion', () => {
    it('keeps full stable persona, real name and nickname without openings or platform state', () => {
        const bundle = normalizeBabyLinkShare(share([char('路明', [])], []));
        expect(bundle.source).toBe('babylink');
        expect(bundle.cards).toHaveLength(1);
        const profile = bundle.cards[0].character;
        expect(profile.name).toBe('路明');
        expect(profile.systemPrompt).toContain('完整角色背景\n第二段不能丢失');
        expect(profile.systemPrompt).toContain('昵称路明');
        expect(profile.systemPrompt).toContain('角色签名');
        expect(bundle.cards[0].worldbooks).toHaveLength(0);
        const serialized = JSON.stringify(bundle);
        for (const forbidden of ['不许进入人格', '不要导入', '过滤种子', 'SECRET', 'high']) {
            expect(serialized).not.toContain(forbidden);
        }
    });
    it('preserves both enable levels, keyword order, probability and case sensitivity', () => {
        const bundle = normalizeBabyLinkShare(share([char('甲', ['one', 'off'])], [
            book('one', true, [
                entry('开', { keys: ['Moon'], enabled: true, order: 350, caseSensitive: true }),
                entry('关', { enabled: false, activation: 'constant' }),
            ]),
            book('off', false, [entry('整本关闭', { enabled: true, activation: 'constant' })]),
        ]));
        const books = bundle.cards[0].worldbooks;
        expect(books).toHaveLength(3);
        expect(books.filter(b => b.disable)).toHaveLength(2);
        expect(books[0]).toMatchObject({ key: ['Moon'], order: 350, caseSensitive: true });
        expect(isWorldbookEntryActive(books[0], [{ content: 'moon' }])).toBe(false);
        expect(isWorldbookEntryActive(books[0], [{ content: 'Moon' }])).toBe(true);
        expect(isWorldbookEntryActive(books[1], [{ content: '任意' }])).toBe(false);
        expect(isWorldbookEntryActive(books[2], [{ content: '任意' }])).toBe(false);
    });
    it('shares one converted book only between its bound characters, never by book name', () => {
        const result = normalizeBabyLinkShare(share([
            char('甲', ['shared', 'a']), char('乙', ['shared']), char('丙', ['b']),
        ], [
            book('shared'), book('a', true, [entry('甲私有')]),
            book('b', true, [entry('丙私有')]),
        ]));
        const [a, b, c] = result.cards.map(card => card.worldbooks);
        expect(a).toHaveLength(2);
        expect(b).toHaveLength(1);
        expect(c).toHaveLength(1);
        expect(a[0].id).toBe(b[0].id);
        expect(a[1].id).not.toBe(c[0].id);
        expect(new Set([...a, ...b, ...c].map(row => row.id)).size).toBe(3);
    });
    it('keeps priority as constant first, reports lossy after-chat semantics', () => {
        const card = normalizeBabyLinkShare(share([char('甲', ['one'])], [
            book('one', true, [entry('priority', { activation: 'priority', position: 'after-chat' })]),
        ]));
        expect(card.cards[0].worldbooks[0]).toMatchObject({ constant: true, position: 1, order: -9900 });
        expect(card.warnings.join(' ')).toContain('无法完全等价');
    });
    it('rejects invalid IDs, enums and excessive payloads without partial results', () => {
        expect(() => normalizeBabyLinkShare(share([char('甲', ['x'])], [book('x'), book('x')]))).toThrow('重复');
        expect(() => normalizeBabyLinkShare(share([char('甲', ['x'])], [book('x', true, [entry('wrong', { activation: 'regex' })])]))).toThrow('激活模式');
        expect(() => normalizeBabyLinkShare(share([char('甲', ['x'])], [book('x', true, [entry('wrong', { content: 'a'.repeat(200001) })])]))).toThrow('安全');
        expect(() => normalizeBabyLinkShare(share([char('甲', ['x'])], [book('x', true, [entry('wrong', { enabled: 'yes' })])]))).toThrow('启用状态');
    });
    it('sends only enabled, correctly bound lore to real ContextBuilder request', async () => {
        const bundle = normalizeBabyLinkShare(share([char('甲', ['one']), char('乙', ['two'])], [
            book('one', true, [entry('甲的秘密', { activation: 'constant' }),
                entry('已关闭秘密', { activation: 'constant', enabled: false })]),
            book('two', true, [entry('乙的秘密', { activation: 'constant' })]),
        ]));
        const source = bundle.cards[0];
        const character = { ...source.character, id: 'babylink-test-char', avatar: '',
            memories: [], mountedWorldbooks: source.worldbooks.map(toMountedWorldbook) } as CharacterProfile;
        const request = await ContextBuilder.buildCharacterRequest({
            char: character, user: { name: '测试用户', bio: '' } as UserProfile,
        }, [{ role: 'user', content: '你好' }]);
        const json = JSON.stringify(request);
        expect(json).toContain('甲的秘密');
        expect(json).toContain('完整角色背景');
        expect(json).not.toContain('乙的秘密');
        expect(json).not.toContain('已关闭秘密');
    });
});

describe('APK-compatible RGB LSB extraction', () => {
    const encodePixels = (payload: Uint8Array): Uint8ClampedArray => {
        const width = Math.ceil(payload.length * 8 / 3);
        const pixels = new Uint8ClampedArray(width * 4);
        for (let n = 0; n < width; n++) pixels[n * 4 + 3] = 255;
        for (let bit = 0; bit < payload.length * 8; bit++) {
            const pixel = Math.floor(bit / 3), channel = bit % 3;
            const value = (payload[bit >> 3] >> (7 - (bit % 8))) & 1;
            pixels[pixel * 4 + channel] = value;
        }
        return pixels;
    };
    it('extracts gzip bytes in exactly BabyLink export bit order', () => {
        const compressed = gzipSync(Buffer.from(JSON.stringify(share([char('示例', [])], []))));
        const bytes = new Uint8Array(compressed.length + 4);
        new DataView(bytes.buffer).setUint32(0, compressed.length, false);
        bytes.set(compressed, 4);
        const pixels = encodePixels(bytes);
        expect(extractBabyLinkCompressed(pixels)).toEqual(Uint8Array.from(compressed));
    });
    it('rejects broken gzip and does not pretend to import arbitrary screenshots', () => {
        const bytes = new Uint8Array([0, 0, 0, 4, 99, 99, 99, 99]);
        expect(() => extractBabyLinkCompressed(encodePixels(bytes))).toThrow('损坏');
        expect(extractBabyLinkCompressed(new Uint8ClampedArray(4 * 10))).toBeNull();
    });
});
