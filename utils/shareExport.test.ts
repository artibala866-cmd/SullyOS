import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareOrDownloadBlob, shareOrDownloadFile } from './shareExport';

const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
const originalCanShare = Object.getOwnPropertyDescriptor(navigator, 'canShare');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
  else Reflect.deleteProperty(navigator, 'share');
  if (originalCanShare) Object.defineProperty(navigator, 'canShare', originalCanShare);
  else Reflect.deleteProperty(navigator, 'canShare');
});

describe('shareOrDownloadBlob web file sharing', () => {
  it('hands the real file to Web Share before considering a browser download', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });

    const result = await shareOrDownloadBlob({
      blob: new Blob(['real file'], { type: 'application/pdf' }),
      fileName: '协同交付.pdf',
      shareTitle: '协同交付',
    });

    expect(result).toBe('shared');
    expect(canShare).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0][0] as ShareData;
    expect(payload.title).toBe('协同交付');
    expect(payload.files?.[0]?.name).toBe('协同交付.pdf');
    expect(payload.files?.[0]?.size).toBe(9);
  });
});

describe('剧情 TXT 网页导出', () => {
  it.each([false, true])('在分享被拒绝或主动选择下载时保存原文件（直接下载：%s）', async preferDownloadOnWeb => {
    const share = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    const click = vi.fn();
    const anchor = { click, remove: vi.fn() };
    const createObjectURL = vi.fn().mockReturnValue('blob:story');
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await shareOrDownloadFile({
      content: '第 12 楼：打开侧门。', fileName: '剧情.txt', mimeType: 'text/plain;charset=utf-8', preferDownloadOnWeb,
    });
    expect(result).toBe('downloaded');
    expect(share).toHaveBeenCalledTimes(preferDownloadOnWeb ? 0 : 1);
    expect(logError).not.toHaveBeenCalled();
    expect(anchor).toMatchObject({ href: 'blob:story', download: '剧情.txt' });
    expect(click).toHaveBeenCalledOnce();
    expect(await createObjectURL.mock.calls[0][0].text()).toBe('第 12 楼：打开侧门。');
  });
});
