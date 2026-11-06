// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import EmojiDocumentFilePicker from '../components/chat/EmojiDocumentFilePicker';
import { importEmojiDocument } from './emojiDocumentImport';

vi.mock('./emojiDocumentImport', () => ({
    EMOJI_DOCUMENT_FILE_ACCEPT: '.txt,.doc,.docx,.pdf,.csv,.json',
    importEmojiDocument: vi.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const append = vi.fn();
beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

async function render(active = true, disabled = false) {
    await act(async () => {
        root.render(createElement(EmojiDocumentFilePicker, {
            active, disabled, onAppendText: append,
        }));
    });
}

async function pickFiles(files: File[]) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
    });
}

it('原表情导入对话框中额外提供独立文件按钮，识别后追加预览但不自动保存', async () => {
    vi.mocked(importEmojiDocument).mockResolvedValueOnce({
        name: 'A.docx',
        entries: [{ name: '开心', url: 'https://example.com/a.gif' }],
        text: '开心--https://example.com/a.gif',
        ignoredLines: 1,
    });
    await render();
    expect(container.querySelector('button')?.textContent).toContain('选择文件导入');
    expect(container.querySelector('input')?.getAttribute('accept')).toContain('.pdf');
    expect(container.querySelector('input')?.getAttribute('multiple')).not.toBeNull();
    await pickFiles([new File(['example'], 'A.docx')]);
    expect(append).toHaveBeenCalledWith('开心--https://example.com/a.gif');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('1 条表情');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('忽略 1 行');
});

it('多文件中有损坏格式时不写入半批内容，允许再次选择文件', async () => {
    vi.mocked(importEmojiDocument)
        .mockResolvedValueOnce({
            name: 'a.txt', entries: [{ name: 'A', url: 'https://example.com/a.png' }],
            text: 'A--https://example.com/a.png', ignoredLines: 0,
        })
        .mockRejectedValueOnce(new Error('PDF 没有可提取的文字'));
    await render();
    await pickFiles([new File(['a'], 'a.txt'), new File(['b'], 'b.pdf')]);
    expect(append).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('PDF 没有可提取的文字');
    expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(false);
});

it('关闭入口后不让前一次异步文件读取改写正在使用的表情库', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(importEmojiDocument).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['a'], 'a.txt')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await render(false);
    await act(async () => {
        resolve({ name: 'a.txt', text: 'A--https://example.com/a.png',
            entries: [{ name: 'A', url: 'https://example.com/a.png' }], ignoredLines: 0 });
        await Promise.resolve();
    });
    expect(append).not.toHaveBeenCalled();
});
