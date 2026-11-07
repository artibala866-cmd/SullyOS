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
    expect(ball).toContain("addToast('已切换到「' + preset.name + '」，立即生效', 'success')");
  });
  it('URL、Key、模型整套保存，与设置页共享云端凭据同步路径', () => {
    expect(ball).toContain("Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>");
    expect(ball).toContain('updateApiConfig(patch)');
    expect(ball).toContain('syncAmsgLlmCredentials({ ...apiConfig, ...patch })');
    expect(ball).toContain('onManualApi(manual)');
    expect(ball).toContain('type="password"');
    expect(ball).toContain('只切换全局对话 API；角色或玩法独立 API 不会被覆盖。');
  });
});
