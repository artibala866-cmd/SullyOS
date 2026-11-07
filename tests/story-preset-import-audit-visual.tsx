import React from 'react';
import { createRoot } from 'react-dom/client';
import StoryPresetMaker from '../components/date/story/StoryPresetMaker';
import { STORY_THEME_CSS } from '../components/date/story/StoryTheaterTheme';
import { BUILTIN_NIGHT_SCREENING_PRESET, getStoryPresetPromptGroups, parseStoryTheaterPreset } from '../utils/storyTheater';

const q = new URLSearchParams(location.search);
const native = q.get('variant') === 'native';
const focus = q.get('focus') || 'overview';
const style = document.createElement('style');
style.textContent = STORY_THEME_CSS;
document.head.append(style);

const titles = ['抢话▣▣权限','语言▣▣设置','视角▣▣设置','剧情▣▣节奏','情绪▣▣温度',
    '对话▣▣占比','文风▣▣选择','小剧场▣▣设置','世界▣▣设定','输出▣▣格式','剧本▣▣补充'];
const prompts = [
    { identifier:'main',name:'酒馆主规则',role:'system',content:'角色 {{char}}' },
    { identifier:'charDescription',name:'酒馆角色资料',role:'system',marker:true },
    { identifier:'chatHistory',name:'酒馆历史',role:'system',marker:true },
    ...Array.from({length:370},(_,i)=>({
        identifier:'p'+i,
        name:i > 0 && i % 31 === 0 ? '<==' + titles[(i/31-1)%titles.length] + '==>' :
            ['视角体系','修改语言','正文篇幅','随机小剧场','文风设置'][i] || '开关 '+i,
        role:'system',
        content:i > 0 && i % 31 === 0 ? '' :
            i === 0 ? '<pov_user>第二人称</pov_user><pov_npc>第三人称</pov_npc>' :
            i === 1 ? '{{setvar::主要语言::简体中文}}' :
            i === 2 ? '<rule>正文字数必须在1421到2023字之间。</rule>' :
            i === 3 ? '<sidestory>每轮结尾生成一个随机小剧场，不改变正文事实。</sidestory>' :
            i === 4 ? '采用电影化写实文风和生活化细节，避免空泛的情绪旁白。'.repeat(8) :
                '<rule>作者正文 '+i+'</rule>',
    })),
];
const imported = parseStoryTheaterPreset(JSON.stringify({
    temperature: 1.05, top_p: 0.95, frequency_penalty: 0.4, presence_penalty: 0.4,
    openai_max_tokens: 10000,
    prompts,prompt_order:[
    {character_id:100001,order:prompts.map((p,i)=>({identifier:p.identifier,enabled:i<104}))}
]}),'373条模拟.json',1);
const groups = getStoryPresetPromptGroups(imported.document);
const authoredIds = imported.document.prompts.map(p=>p.id);
const groupingSafe = groups.length >= 11
    && groups.flatMap(group=>group.promptIds).join('|')===authoredIds.join('|')
    && groups.every(group=>group.autoGrouped)
    && imported.document.prompts.filter(p=>p.enabled).length===104;
createRoot(document.getElementById('visual')!).render(
    React.createElement('div',{className:'story-theme story-theme-dark story-decor-plain h-full w-full'},
        React.createElement(StoryPresetMaker,{
            preset:native ? BUILTIN_NIGHT_SCREENING_PRESET : imported,
            onBack:()=>{},onSave:async()=>{},onOpenCopy:async()=>{},onDelete:async()=>{},
        }),
    ),
);

let stage = 0;
let markerToggled = false;
let detailSelected = false;
const clickByText = (fragment: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes(fragment));
const inputText = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};
const check = () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
    const pro = buttons.find(b => b.textContent?.trim() === '专业版');
    if (!pro) { setTimeout(check, 100); return; }
    if (!native && (focus === 'slot' || focus === 'deep') && stage === 0) {
        pro.click(); stage = 1; setTimeout(check, 180); return;
    }
    if (!native && focus === 'slot') {
        if (stage === 1) {
            const group = clickByText('预设开头');
            if (group) { group.click(); stage = 2; setTimeout(check, 130); return; }
        }
        if (stage === 2) {
            const item = clickByText('酒馆角色资料');
            const toggle = item?.parentElement?.querySelector<HTMLButtonElement>('button');
            if (item && toggle && !toggle.disabled) {
                toggle.click(); item.click(); markerToggled = true;
                stage = 3; setTimeout(check, 130); return;
            }
        }
    }
    if (!native && focus === 'deep') {
        if (stage === 1) {
            const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索酒馆预设提示词"]');
            if (search) { inputText(search, '开关 369'); stage = 2; setTimeout(check, 150); return; }
        }
        if (stage === 2) {
            const group = buttons.find(b => b.querySelector('strong')
                && /其他条目|设置|选择|补充/.test(b.textContent || ''));
            if (group) { group.click(); stage = 3; setTimeout(check, 130); return; }
        }
        if (stage === 3) {
            const item = clickByText('开关 369');
            if (item) { item.click(); stage = 4; setTimeout(check, 170); return; }
        }
    }
    const proOn = pro.className.includes('bg-white');
    const fit = document.documentElement.scrollWidth <= innerWidth;
    const overview = Boolean(document.querySelector('input[aria-label="搜索酒馆预设提示词"]'));
    const quickEditor = Boolean(clickByText('返回提示词列表')
        && !document.querySelector('input[aria-label="搜索组内提示词"]'));
    const selectedTextarea = document.querySelector<HTMLTextAreaElement>('textarea');
    detailSelected = focus === 'deep' && quickEditor
        && Boolean(selectedTextarea?.value.includes('作者正文 369'))
        && !document.querySelector('select[aria-label="移动到分组"]');
    const headingText = [...document.querySelectorAll('h2')].map(node => node.textContent || '');
    const eightControls = ['文风', '人称', '输入转述', '你的执笔权',
        '场景张力', '小剧场', '语言', '篇幅'].every(x => headingText.includes(x));
    const nativeAuthorMapping = native || focus !== 'overview' || ['1421–2023字', '简体中文', '第二人称'].every(value => document.body.textContent?.includes(value));
    const generationControls = ['温度', '候选范围', '重复惩罚', '话题惩罚', '最大输出']
        .every(x => headingText.includes(x) || document.body.textContent?.includes(x));
    const success = fit && nativeAuthorMapping && (native ? !proOn && eightControls && generationControls : groupingSafe && (
        focus === 'overview' ? !proOn && eightControls && generationControls
            : focus === 'slot' ? proOn && markerToggled && quickEditor : proOn && detailSelected));
    document.body.dataset.storyPresetAuditReady = String(success);
    let output = document.getElementById('story-preset-audit-report');
    if (!output) {
        output = document.createElement('output');
        output.hidden = true; output.id = 'story-preset-audit-report'; document.body.append(output);
    }
    output.textContent = JSON.stringify({ native, focus, proOn, fit, groupCount: groups.length,
        groupingSafe, eightControls, nativeAuthorMapping, generationControls, markerToggled,
        quickEditor, detailSelected, stage, success });
    if (!success && stage < 5) setTimeout(check, 200);
};
setTimeout(check, 950);
