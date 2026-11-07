import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ball = readFileSync(fileURLToPath(new URL('../components/os/NavigationBall.tsx', import.meta.url)), 'utf8');
const style = readFileSync(fileURLToPath(new URL('../components/os/NavigationBall.css', import.meta.url)), 'utf8');

describe('悬浮窗紧凑交互', () => {
  it('旧九宫格已替换为列表，未配置槽位不占空间', () => {
    expect(style).not.toMatch(/grid-template-columns:\s*repeat\(3/);
    expect(ball).toMatch(/if \(!shortcut\) return null/);
    expect(ball).toMatch(/slots\.some\(Boolean\)/);
    expect(ball).toMatch(/Math\.min\(232, parentSize\.width - 16\)/);
    expect(ball).toMatch(/Math\.min\(288, Math\.max\(80,/);
    expect(style).toContain('backdrop-filter:blur(23px)');
  });
  it('菜单在边界内展开并保持拖动和复位行为', () => {
    expect(ball).toMatch(/clampBubblePos\(state\.origin\.x \+ dx, state\.origin\.y \+ dy, state\.bounds\)/);
    expect(ball).toMatch(/Math\.min\(preferredX, parentSize\.width - panelWidth - 8\)/);
    expect(ball).toMatch(/parentSize\.height - parentSize\.bottom - visiblePanelHeight - 10/);
    expect(ball).toContain('subscribeNavigationBallPositionReset');
    expect(ball).toContain('setOpen(false)');
  });
  it('API 预设就在浮窗内切换，不进入设置页', () => {
    expect(ball).toMatch(/navigation-ball-api-entry["] onClick=\{\(\) => showView\('api'\)\}/);
    expect(ball).toContain('onClick={() => run(() => onSwitchPreset(preset))}');
    expect(ball).toContain('findActivePresetId(apiPresets, apiConfig)');
    expect(ball).toContain('applyApi(configFromPreset(preset))');
    expect(ball).toContain("addToast('已切换到「' + preset.name + '」，下一次请求生效', 'success')");
  });
  it('URL、Key、模型整套保存，与设置页共享云端凭据同步路径', () => {
    expect(ball).toContain("Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>");
    expect(ball).toContain('updateApiConfig(patch) === false');
    expect(ball).toContain('quickApiConfigurationIssue(manual)');
    expect(ball).toContain('quickApiConfigurationIssue(preset.config)');
    expect(ball).toContain('disabled={!!issue}');
    expect(ball).toContain('syncAmsgLlmCredentials({ ...apiConfig, ...patch })');
    expect(ball).toContain('onManualApi(normalizedQuickApiFields(manual))');
    expect(ball).toContain('type="password"');
    expect(ball).toContain('角色或玩法 API 不会被覆盖。');
  });
});

describe('真机交互风险防护', () => {
  it('键盘缩小可视高度时恢复拖动目标位置，而不是永久贴在中部', () => {
    expect(ball).toContain('window.visualViewport?.addEventListener(\'resize\', constrain)');
    expect(ball).toContain('const preferredPosition = useRef(position)');
    expect(ball).toContain('preferredPosition.current = next;');
    expect(ball).toContain('parentH: visibleHeight');
    expect(style).toContain('overflow-y:auto');
  });
  it('有独立 API 的角色得到明确作用范围提示，避免误以为普通见面已切换', () => {
    expect(ball).toContain('independentApiCharacterName');
    expect(ball).toContain('普通见面继续使用角色配置；剧情剧场使用此处的全局配置');
    expect(ball).toContain('enabled && isDataLoaded && !isLocked && !pickerOpen');
  });
});
