import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStoryInputDraft, readStoryInputDraft, saveStoryInputDraft } from './storyTheaterInputDraft';

const values = new Map<string, string>();
const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
};

beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('剧情输入草稿自动缓存', () => {
    it('输入原文、换行、空格和特殊字符原样保存，页面重新进入能恢复', () => {
        const text = '  他回过头说：“等等！”\n\n我还没想好…… 🕯️  ';
        saveStoryInputDraft('a', text);
        expect(readStoryInputDraft('a')).toBe(text);
    });

    it('不同剧情完全隔离，切换剧情不覆盖', () => {
        saveStoryInputDraft('a', '第一幕草稿');
        saveStoryInputDraft('b', '另一剧情的草稿');
        expect(readStoryInputDraft('a')).toBe('第一幕草稿');
        expect(readStoryInputDraft('b')).toBe('另一剧情的草稿');
    });

    it('用户主动清空输入后不再恢复旧草稿', () => {
        saveStoryInputDraft('a', '旧内容');
        saveStoryInputDraft('a', '');
        expect(readStoryInputDraft('a')).toBe('');
    });

    it('发送成功仅清除当次内容，续写期间新写的草稿不得误删', () => {
        saveStoryInputDraft('a', '待发送');
        saveStoryInputDraft('a', '新草稿');
        clearStoryInputDraft('a', '待发送');
        expect(readStoryInputDraft('a')).toBe('新草稿');
        clearStoryInputDraft('a', '新草稿');
        expect(readStoryInputDraft('a')).toBe('');
    });

    it('只删除对应剧情的草稿，不连带删除其他剧情', () => {
        saveStoryInputDraft('a', '要删除的剧情');
        saveStoryInputDraft('b', '保留的剧情');
        clearStoryInputDraft('a');
        expect(readStoryInputDraft('a')).toBe('');
        expect(readStoryInputDraft('b')).toBe('保留的剧情');
    });

    it('浏览器禁用缓存时不影响原本输入和编辑', () => {
        storage.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
        expect(() => saveStoryInputDraft('a', '能继续打字')).not.toThrow();
        storage.getItem.mockImplementationOnce(() => { throw new Error('denied'); });
        expect(readStoryInputDraft('a')).toBe('');
        storage.removeItem.mockImplementationOnce(() => { throw new Error('denied'); });
        expect(() => clearStoryInputDraft('a')).not.toThrow();
    });
});
