import { describe, expect, it } from 'vitest';
import { normalizedQuickApiFields, quickApiConfigurationIssue } from './quickApiValidation';
import { normalizeApiPresets } from './apiConfigNormalize';

describe('悬浮窗切换和备份导入的容错', () => {
  it('阻止格式错误与不完整的 API，不对外发请求', () => {
    for (const baseUrl of ['', 'not a url', 'ftp://example.com/v1', 'https://key:secret@example.com/v1']) {
      expect(quickApiConfigurationIssue({ baseUrl, apiKey: '123', model: 'example' })).not.toBeNull();
    }
    expect(quickApiConfigurationIssue({ baseUrl: 'https://demo.invalid/v1', model: '' })).not.toBeNull();
    expect(quickApiConfigurationIssue(null)).not.toBeNull();
  });
  it('允许无 Key 代理，清理粘贴隐形字符并保留完整三件套', () => {
    expect(quickApiConfigurationIssue({ baseUrl: 'https://test.invalid/v1', apiKey: '', model: 'm' })).toBeNull();
    expect(normalizedQuickApiFields({ baseUrl: ' https://test.invalid/v1/ ', apiKey: ' sk-test\u200b', model: ' gemini\u200b ' })).toEqual({
      baseUrl: 'https://test.invalid/v1',
      apiKey: 'sk-test',
      model: 'gemini',
    });
  });
  it('旧备份混入 null、空对象、重复 ID、缺少名称，不应导致整批导入失败', () => {
    const imported = normalizeApiPresets([
      null, {}, { id: 'one', name: ' 甲 ', config: { baseUrl: ' https://a.invalid/v1/ ', apiKey: 'x', model: 'm' } },
      { id: 'one', name: '乙', config: { baseUrl: 'https://b.invalid/v1', apiKey: 'y', model: 'n' } },
      { name: '', config: { baseUrl: '', model: '' } }, { id: 'bad', config: null },
    ]);
    expect(imported).toHaveLength(3);
    expect(imported.map(p => p.id)).toEqual(['one', 'one-import-4', 'imported-preset-5']);
    expect(imported.map(p => p.name)).toEqual(['甲', '乙', '未命名预设 5']);
    expect(imported[0].config.baseUrl).toBe('https://a.invalid/v1');
    expect(quickApiConfigurationIssue(imported[2].config)).not.toBeNull();
    expect(normalizeApiPresets({ presets: [] })).toEqual([]);
  });
  it('导入配置保留其他专用 API / 流式与温度参数而非重置', () => {
    const [preset] = normalizeApiPresets([{ id: 'x', name: 'A', config: {
      baseUrl: 'https://demo.invalid/v1', apiKey: 'k', model: 'm',
      stream: true, temperature: 1.1, visionApi: { enabled: true, baseUrl: 'https://vision.invalid/v1', apiKey: 'v', model: 'vm' },
    } }]);
    expect(preset.config.stream).toBe(true);
    expect(preset.config.temperature).toBe(1.1);
    expect(preset.config.visionApi?.model).toBe('vm');
  });
});
