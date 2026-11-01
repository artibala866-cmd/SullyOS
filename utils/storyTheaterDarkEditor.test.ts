import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const editor = readFileSync(fileURLToPath(new URL('../components/date/story/StoryTheaterEditor.tsx', import.meta.url)), 'utf8');
const theme = readFileSync(fileURLToPath(new URL('../components/date/story/StoryTheaterTheme.tsx', import.meta.url)), 'utf8');

const cssBlock = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = theme.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    if (!match) throw new Error(`Missing CSS selector: ${selector}`);
    return match[1];
};
const rgb = (hex: string): number[] => {
    const color = hex.replace('#', '');
    return [0, 2, 4].map(index => parseInt(color.slice(index, index + 2), 16));
};
const luminance = (hex: string): number => {
    const rgbLinear = rgb(hex).map(channel => {
        const x = channel / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return rgbLinear[0] * .2126 + rgbLinear[1] * .7152 + rgbLinear[2] * .0722;
};
const contrast = (a: string, b: string): number => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + .05) / (dark + .05);
};

describe('见面剧情深色界面三处白块', () => {
    it('顶部和底部保存都使用同一个局部专用灰色按钮，不影响保存行为', () => {
        expect((editor.match(/className='story-setup-save /g) || []).length).toBe(2);
        expect(editor).toContain("onClick={save} disabled={saving} className='story-setup-save");
        expect(editor).not.toContain('disabled={saving || !draft.title.trim() || !canStart}');
        const rule = cssBlock('.story-theme.story-theme-dark .story-setup-save');
        expect(rule).toContain('background-color: #424242 !important');
        expect(rule).toContain('color: #f0f0f0 !important');
        expect(contrast('#424242', '#f0f0f0')).toBeGreaterThan(8);
    });
    it('真实时间陪伴说明板在黑色界面使用深灰，所有说明文字保持清晰可读', () => {
        expect(editor).toContain("story-memory-live-card mt-5 p-4");
        expect(editor).toContain('内置真实性保护');
        const panel = cssBlock('.story-theme.story-theme-dark .story-memory-live-card');
        expect(panel).toContain('background-color: #303030 !important');
        expect(panel).toContain('border-color: #494949 !important');
        expect(cssBlock('.story-theme.story-theme-dark .story-memory-live-card .text-amber-700')).toContain('color: #c9c9c9 !important');
        expect(cssBlock('.story-theme.story-theme-dark .story-memory-live-card .text-amber-800')).toContain('color: #efefef !important');
        expect(contrast('#303030', '#c9c9c9')).toBeGreaterThan(7);
    });
    it('只在深色剧情主题作用，浅色剧情和陪伴模式不覆盖', () => {
        for (const selector of [
            '.story-theme.story-theme-dark .story-setup-save',
            '.story-theme.story-theme-dark .story-memory-live-card',
            '.story-theme.story-theme-dark .story-memory-live-card .text-amber-700',
            '.story-theme.story-theme-dark .story-memory-live-card .text-amber-800',
        ]) {
            expect(cssBlock(selector)).toMatch(/!important/);
        }
        expect(theme).not.toMatch(/\.story-theme-light\s+\.story-(?:setup-save|memory-live-card)/);
        expect(theme).not.toMatch(/\.story-theme \.story-(?:setup-save|memory-live-card)\s*\{/);
    });
});
