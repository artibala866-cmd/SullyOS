import {validateScopedCss} from './scopedCss';
import type { JournalAppearance, JournalAppearancePresetId } from '../types';

export type JournalLayoutId = 'classic' | 'postal-archive' | 'celestial-album' | 'field-dossier' | 'memory-editor';

export interface JournalAppearancePreset {
    id: JournalAppearancePresetId;
    name: string;
    description: string;
    colors: [string, string, string];
    layout: JournalLayoutId;
    css: string;
}

export const JOURNAL_CSS_SCOPE_REGEX = /^\.sully-journal(?:\b|-)/;
export const JOURNAL_CSS_SCOPE_HINT = '.sully-journal-root / .sully-journal-*';

/**
 * Public CSS hooks for the exchange-journal skin editor. Keep this list in
 * sync with JournalApp and JournalThemeArtwork: it is copied verbatim into
 * the AI prompt so generated skins do not have to guess DOM class names.
 */
export const JOURNAL_CUSTOM_CSS_SELECTOR_GROUPS = [
    {
        label: 'App 与页面状态',
        selectors: [
            '.sully-journal-root', '.sully-journal-select', '.sully-journal-calendar',
            '.sully-journal-write', '.sully-journal-designed',
            '.sully-journal-theme-letterpress', '.sully-journal-theme-sakura',
            '.sully-journal-theme-forest', '.sully-journal-theme-midnight',
        ],
    },
    {
        label: '顶部与导航',
        selectors: [
            '.sully-journal-header', '.sully-journal-header-title', '.sully-journal-back',
            '.sully-journal-appearance-button', '.sully-journal-group-filter',
        ],
    },
    {
        label: '日记本选择页',
        selectors: [
            '.sully-journal-notebook-grid', '.sully-journal-notebook',
            '.sully-journal-notebook-avatar', '.sully-journal-notebook-name',
            '.sully-journal-notebook-label',
        ],
    },
    {
        label: '日记列表页',
        selectors: [
            '.sully-journal-calendar-hero', '.sully-journal-calendar-heading',
            '.sully-journal-calendar-kicker', '.sully-journal-calendar-title',
            '.sully-journal-calendar-list', '.sully-journal-new-entry',
            '.sully-journal-entry', '.sully-journal-entry-accent',
            '.sully-journal-entry-date', '.sully-journal-entry-text',
            '.sully-journal-entry-year', '.sully-journal-entry-badges',
            '.sully-journal-empty',
        ],
    },
    {
        label: '书写与双页',
        selectors: [
            '.sully-journal-editor-header', '.sully-journal-editor-stage',
            '.sully-journal-spread', '.sully-journal-spread-page',
            '.sully-journal-spread-page.is-inactive', '.sully-journal-spread-user',
            '.sully-journal-spread-char', '.sully-journal-paper',
            '.sully-journal-paper-user', '.sully-journal-paper-char',
            '.sully-journal-page-content', '.sully-journal-page-meta',
            '.sully-journal-page-title', '.sully-journal-page-date',
            '.sully-journal-textarea', '.sully-journal-sticker', '.sully-journal-texture',
        ],
    },
    {
        label: '底部工具',
        selectors: [
            '.sully-journal-bottom-controls', '.sully-journal-tabs', '.sully-journal-tab',
            '.sully-journal-tab-active', '.sully-journal-paper-picker',
            '.sully-journal-paper-swatch', '.sully-journal-sticker-button',
            '.sully-journal-sticker-panel',
        ],
    },
    {
        label: '主题装饰层',
        selectors: [
            '.sully-journal-theme-art', '.sully-journal-theme-art-letterpress',
            '.sully-journal-theme-art-sakura', '.sully-journal-theme-art-forest',
            '.sully-journal-theme-art-midnight', '.sully-journal-theme-art-select',
            '.sully-journal-theme-art-calendar', '.sully-journal-theme-art-write',
            '.sully-journal-post-route', '.sully-journal-post-plane',
            '.sully-journal-postmark', '.sully-journal-envelope-corner',
            '.sully-journal-airmail-stripe', '.sully-journal-celestial-map',
            '.sully-journal-orbits', '.sully-journal-constellation',
            '.sully-journal-star-medallion', '.sully-journal-photo-corners',
            '.sully-journal-satin-ribbon', '.sully-journal-botanical-sheet',
            '.sully-journal-botanical-stem', '.sully-journal-measure-lines',
            '.sully-journal-specimen-arrow', '.sully-journal-field-rings',
            '.sully-journal-field-tabs', '.sully-journal-specimen-seal',
            '.sully-journal-memory-circuit', '.sully-journal-window-chrome',
            '.sully-journal-inspector-ghost', '.sully-journal-cursor-spark',
        ],
    },
] as const;

export const JOURNAL_CUSTOM_CSS_SELECTORS = JOURNAL_CUSTOM_CSS_SELECTOR_GROUPS
    .flatMap(group => [...group.selectors]);

const journalSelectorPrompt = JOURNAL_CUSTOM_CSS_SELECTOR_GROUPS
    .map(group => `${group.label}：\n${group.selectors.join('、')}`)
    .join('\n\n');

export const JOURNAL_AI_CSS_PROMPT = `你是 CSS 设计师，请为 SullyOS·糯米机 的「交换日记」App 写一段完整的自定义 CSS。

要求：
1. 只能使用下列公开选择器；每条普通规则都必须以 .sully-journal-root 或 .sully-journal-* 开头。
2. 可以组合后代、子元素、伪类、伪元素和媒体查询，覆盖原样式时可使用 !important；不要输出 JavaScript、HTML 或全局 body/html 规则。
3. 顶部返回键和美化入口是安全出口，不得用 display:none、visibility:hidden、opacity:0、pointer-events:none 或移出屏幕的方式隐藏。
4. 同时适配手机单页与较宽屏幕；正文、日期、返回键、新建按钮、输入区和底部工具必须清晰可操作。
5. 请做成一套完整的实体手账界面，不只是换颜色。可以设计纸张层次、装订、贴纸、胶带、日期标签、角色照片与轻量动画，但装饰层必须 pointer-events:none，不能遮住正文和按钮。

全部可用选择器：
${journalSelectorPrompt}

请直接输出一整段可粘贴的 CSS，可以带少量注释，不要长篇解释。
我想要的风格是：______`;

/**
 * Written after preset/custom CSS. A broken imported skin may restyle the
 * header, but it must never remove the controls needed to leave the App or
 * reopen this editor and reset the skin.
 */
export const JOURNAL_APPEARANCE_SAFETY_CSS = `
html body .sully-journal-root.sully-journal-root{
  display:flex!important;
  visibility:visible!important;
  opacity:1!important;
  pointer-events:auto!important;
  min-height:100%!important;
}
html body .sully-journal-root.sully-journal-root .sully-journal-header,
html body .sully-journal-root.sully-journal-root .sully-journal-calendar-hero,
html body .sully-journal-root.sully-journal-root .sully-journal-editor-header{
  display:block!important;
  visibility:visible!important;
  opacity:1!important;
  pointer-events:auto!important;
}
html body .sully-journal-root.sully-journal-root::before,
html body .sully-journal-root.sully-journal-root::after,
html body .sully-journal-root.sully-journal-root *::before,
html body .sully-journal-root.sully-journal-root *::after{
  pointer-events:none!important;
}
html body .sully-journal-root.sully-journal-root .sully-journal-header,
html body .sully-journal-root.sully-journal-root .sully-journal-editor-header{
  padding-top:max(var(--chrome-top,0px),env(safe-area-inset-top,0px))!important;
}
html body .sully-journal-root.sully-journal-root .sully-journal-calendar-hero{
  padding-top:max(3rem,var(--safe-top,0px),env(safe-area-inset-top,0px))!important;
}
html body .sully-journal-root.sully-journal-root .sully-journal-back,
html body .sully-journal-root.sully-journal-root .sully-journal-appearance-button{
  display:grid!important;
  visibility:visible!important;
  opacity:1!important;
  pointer-events:auto!important;
  position:relative!important;
  z-index:2147483000!important;
}`;

/* 邮局档案：横向信封、打字机索引卡、航空邮路。 */
const MONO_SCRAPBOOK_CSS = `
.sully-journal-root{background:#f8f8f8!important;color:#252525}
.sully-journal-select{background:radial-gradient(circle,#d8d8d8 1.3px,transparent 1.6px) 0 0/27px 27px,#fafafa!important}
.sully-journal-header{background:rgba(255,255,255,.94)!important;border-color:#d8d8d8!important;color:#252525!important}
.sully-journal-calendar-hero{background:#292929!important;color:#fff!important;border-radius:0!important;box-shadow:none!important}
.sully-journal-calendar-hero *{color:#fff}
.sully-journal-notebook{background:#fff!important;border:1px solid #292929!important;box-shadow:5px 5px 0 #dedede!important}
.sully-journal-notebook-label{background:#eee!important;color:#333!important}
.sully-journal-entry{background:#fff!important;border:1px solid #dedede!important;box-shadow:none!important}
.sully-journal-entry-accent{background:#292929!important}
.sully-journal-new-entry{border-color:#666!important;color:#292929!important;background:#fafafa!important}
.sully-journal-write{background:#202020!important}
.sully-journal-spread-page{box-shadow:0 10px 28px rgba(0,0,0,.16)!important}
.sully-journal-paper{border:1px solid #c9c9c9!important}
.sully-journal-paper-user{background-color:#fff!important}
.sully-journal-paper-char{background-color:#f5f5f5!important}
.sully-journal-page-meta{letter-spacing:.13em}
.sully-journal-sticker-panel{background:#252525!important}
.sully-journal-sticker-button{background:#292929!important;color:#fff!important}
`;

export const JOURNAL_APPEARANCE_PRESETS: JournalAppearancePreset[] = [
    {
        id: 'original',
        name: '黑白拼贴手账',
        description: '黑白艺术记事本 · 波点纸张 · 杂志式留白',
        colors: ['#ffffff', '#292929', '#dedede'],
        layout: 'classic',
        css: MONO_SCRAPBOOK_CSS,
    },
];

export const resolveJournalPreset = (preset?: JournalAppearancePresetId) =>
    JOURNAL_APPEARANCE_PRESETS.find(candidate => candidate.id === (preset || 'original'))
    || JOURNAL_APPEARANCE_PRESETS[0];

export const resolveJournalAppearanceCss = (appearance?: JournalAppearance) => {
    const presetCss = resolveJournalPreset(appearance?.preset).css;
    const customCss = appearance?.customCss?.trim() || '';
    // A flattened export already contains the base theme: avoid injecting it twice.
    return customCss.startsWith(presetCss) ? customCss : [presetCss, customCss].filter(Boolean).join('\n');
};

/** 将“内置主题 + 用户覆盖”拍平成一份不依赖主题 ID 的独立 CSS。 */
export const flattenJournalAppearance = (appearance?: JournalAppearance): JournalAppearance => ({
    preset: 'original',
    customCss: resolveJournalAppearanceCss(appearance),
});

export function validateJournalAppearance(value:unknown):JournalAppearance {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('交换日记样式无效');const v=value as Record<string,unknown>;
 if(v.preset!==undefined&&(typeof v.preset!=='string'||!JOURNAL_APPEARANCE_PRESETS.some(p=>p.id===v.preset)))throw Error('交换日记主题无效');
 if(v.customCss!==undefined&&(typeof v.customCss!=='string'||v.customCss.length>1024*1024||/<\/?(?:script|style|html|iframe)\b/i.test(v.customCss)))throw Error('交换日记 CSS 无效');
 const css=typeof v.customCss==='string'?v.customCss:'';const check=validateScopedCss(css,JOURNAL_CSS_SCOPE_REGEX,JOURNAL_CSS_SCOPE_HINT);if(!check.isValid)throw Error(check.errors.join('\n'));
 return {preset:(v.preset||'original') as JournalAppearancePresetId,customCss:css};
}
