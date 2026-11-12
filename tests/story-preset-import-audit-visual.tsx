import React from 'react';
import { createRoot } from 'react-dom/client';
import StoryPresetMaker from '../components/date/story/StoryPresetMaker';
import { STORY_THEME_CSS } from '../components/date/story/StoryTheaterTheme';
import { BUILTIN_NIGHT_SCREENING_PRESET, getStoryPresetPromptGroups, parseStoryTheaterPreset } from '../utils/storyTheater';

const q = new URLSearchParams(location.search);
const native = q.get('variant') === 'native';
const dialect = q.get('dialect') || '';
const light = q.get('theme') === 'light';
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
// Realistic, minimal excerpts (not the uploaded authors' full presets).
// Test each author's own source choices in the same maker layout, not copied native option labels.
const dialectCases: Record<string, {
    temperature: number; top_p: number; frequency_penalty: number;
    presence_penalty: number; openai_max_tokens: number;
    items: Array<{ id?: string; name: string; content: string; enabled?: boolean }>; labels: string[];
    sourceGroups?: Array<{ id: string; name: string; memberIdentifiers?: string[]; startIdentifier?: string; endIdentifier?: string }>;
}> = {
    unseen: {
        temperature: .85, top_p: .91, frequency_penalty: .1, presence_penalty: .2, openai_max_tokens: 9100,
        sourceGroups: [
            { id: 'novel-lunar', name: '月潮调色盘（任选其一）', memberIdentifiers: ['unknownDawn', 'unknownDusk'] },
            { id: 'novel-poem', name: '星屿造景', memberIdentifiers: ['unknownAmber', 'unknownMist'] },
        ],
        items: [
            { id: 'unknownDawn', name: '晨星', content: 'ONLY-UNKNOWN-DAWN' },
            { id: 'unknownDusk', name: '晦夜', content: 'ONLY-UNKNOWN-DUSK', enabled: false },
            { id: 'unknownAmber', name: '琥珀光', content: 'ONLY-UNKNOWN-AMBER' },
            { id: 'unknownMist', name: '薄雾蓝', content: 'ONLY-UNKNOWN-MIST', enabled: false },
            { id: 'unknownCore', name: '必开底座', content: 'UNCHANGED-CORE' },
        ],
        labels: ['月潮调色盘', '晨星', '晦夜', '星屿造景', '琥珀光'],
    },
    edge: {
        temperature: 1, top_p: .95, frequency_penalty: 0, presence_penalty: 0,
        openai_max_tokens: 10000,
        sourceGroups: [{id:'edge-source',name:'作者自定义结构区',
            memberIdentifiers:['edgeOpen','edgeOne','edgeGap','edgeTwo','edgeLite','edgeClose']}],
        items: [
            {id:'edgeOpen',name:'结构开头',content:'<scene>'},
            {id:'edgeOne',name:'前段正文',content:'用于结构审查的第一条有效规则'},
            {id:'edgeGap',name:'空白插槽',content:'  '},
            {id:'edgeTwo',name:'后段正文',content:'用于结构审查的第二条有效规则'},
            {id:'edgeLite',name:'Lite占位',content:'[Lite未包含此扩展.]'},
            {id:'edgeClose',name:'结构结尾',content:'</scene>'},
        ],
        labels: ['作者自定义结构区','前段正文','后段正文'],
    },
    gomora: {
        temperature: 1.05, top_p: .98, frequency_penalty: 0, presence_penalty: 0,
        openai_max_tokens: 32000,
        sourceGroups: [
            { id: 'genre', name: '小说类型', memberIdentifiers: ['genreA','genreB'] },
            { id: 'style', name: '小说文风', memberIdentifiers: ['styleA','styleB'] },
        ],
        items: [
            { id: 'genreA', name: '群像', content: '群像多角色叙述。' },
            { id: 'genreB', name: '言情', content: '言情向叙述。', enabled: false },
            { id: 'styleA', name: '文风-恋爱喜剧@电波系', content: '原作者恋爱喜剧文风。' },
            { id: 'styleB', name: '文风-诗童话', content: '原作者诗童话文风。', enabled: false },
            { id: 'core', name: 'set-不要关', content: '原作者底座。' },
        ],
        labels: ['小说类型', '小说文风', '群像', '文风-恋爱喜剧'],
    },
    ivory: {
        temperature: 1.5, top_p: .88, frequency_penalty: 1.5, presence_penalty: 1.5,
        openai_max_tokens: 30000,
        sourceGroups: [{ id: 'theater', name: '🎪小剧场', startIdentifier: 'theaterOpen', endIdentifier: 'theaterClose' }],
        items: [
            { id: 'theaterOpen', name: '╔小剧场开启╗', content: '<theater>' },
            { id: 'aurora', name: '🎪极光交互小剧场', content: '作者极光剧场。', enabled: false },
            { id: 'plain', name: '🎪简约文字小剧场', content: '作者简约小剧场。' },
            { id: 'theaterClose', name: '╚小剧场结束╝', content: '</theater>' },
        ],
        labels: ['小剧场', '简约文字小剧场'],
    },
    yuki: {
        temperature: 1, top_p: 1, frequency_penalty: 0, presence_penalty: 0,
        openai_max_tokens: 20000,
        items: [
            { name: '——📌⬇️文风区⬇️——', content: '<writing_style>' },
            { name: '⌨️浪漫文风@小白狗', content: '原作者浪漫文风。' },
            { name: '⌨️克制白描文风@电波系', content: '原作者白描风格。', enabled: false },
            { name: '——📌⬆️文风区⬆️——', content: '</writing_style>' },
            { name: '===💡⬇️小剧场区⬇️💡===', content: '<theater>' },
            { name: '💡4选1🌌 极光小剧场@电波系', content: '极光小剧场。' },
            { name: '💡4选1❄️小回小剧场@小回', content: '小回小剧场。', enabled: false },
            { name: '🔦完全随机小剧场', content: '完全随机小剧场。' },
            { name: '===⬆️小剧场区⬆️===', content: '</theater>' },
        ],
        labels: ['文风区', '小剧场区', '完全随机小剧场'],
    },
    phantasm: {
        temperature: 1.05, top_p: .98, frequency_penalty: 0, presence_penalty: 0,
        openai_max_tokens: 65536,
        items: [
            { name: '▍文风 [择一]', content: '主文风仅选一。' },
            { name: '📘轻快自然', content: '轻快自然写作。' },
            { name: '📘慢活治愈', content: '慢活治愈写作。', enabled: false },
            { name: '📒轻小说 [可叠加]', content: '附加轻小说风格。' },
            { name: '✏ 表现&修辞手法', content: '采用不同的修辞技巧。' },
            { name: '📙白描', content: '白描技巧。' },
            { name: '▍功能&守则', content: '下一组规则。' },
        ],
        labels: ['文风 [择一]', '轻快自然', '轻小说 [可叠加]', '白描'],
    },
    pluto: {
        temperature: 1, top_p: .9, frequency_penalty: 0, presence_penalty: 0, openai_max_tokens: 60000,
        items: [
            { name: '修改语言', content: '{{setvar::主要语言::简体中文}}' },
            { name: '修改字数', content: '{{setvar::正文字数::800-1500字}}' },
            { name: 'Char视角-TA&你', content: 'POV: Immersive Third-Person. (He/She & You). 用“你/您”指代<user>。' },
            { name: '随机小剧场', content: '每轮生成一段随机小剧场，保留<RandomTheater>作者格式</RandomTheater>。' },
        ],
        labels: ['修改语言', '修改字数', 'Char视角-TA&你', '随机小剧场'],
    },
    ako: {
        temperature: 1, top_p: .97, frequency_penalty: .32, presence_penalty: .48, openai_max_tokens: 65535,
        items: [
            { name: '主文风: 严肃', content: '主要参考严肃文学与世界名著，保持客观文字和真实的节奏。'.repeat(8) },
            { name: '第三人称上帝视角', content: '<POV>正文使用第三人称写作。</POV>' },
            { name: 'RP转述', content: '<转述>把用户输入扩写回放，再开始新剧情。</转述>' },
            { name: '不抢话', content: '禁止代写用户台词，不可代替玩家决定。' },
            { name: '中文语言', content: '正文要求使用简体中文。' },
            { name: '正文篇幅', content: '字数要求：1500字。' },
        ],
        labels: ['主文风: 严肃', '第三人称上帝视角', 'RP转述', '不抢话', '中文语言', '正文篇幅'],
    },
    mur: {
        temperature: 1, top_p: 1, frequency_penalty: 0, presence_penalty: 0, openai_max_tokens: 20000,
        items: [
            { name: '语言', content: '<language_forms>language: Chinese.</language_forms>' },
            { name: '字数要求', content: '<creation_form>Word_budget: 900~1000</creation_form>' },
            { name: '抢话 · 第三人称', content: 'Narrative must unfold from an immersive third-person perspective. Make major decisions and deliver key dialogue on behalf of the user.' },
        ],
        labels: ['语言', '字数要求', '抢话 · 第三人称'],
    },
    janus: {
        temperature: 1.05, top_p: .95, frequency_penalty: .4, presence_penalty: .4, openai_max_tokens: 10000,
        items: [
            { name: '动态-内置文风', content: '<Dynamic_Writing_Style>动态随机文风，依情景选不同文字风格。</Dynamic_Writing_Style>'.repeat(3) },
            { name: '视角体系', content: '<Perspective_System><pov_user>第二人称</pov_user><pov_npc>第三人称</pov_npc></Perspective_System>' },
            { name: '字数设置', content: 'Then write a 800-1,200-word pure plot story in zh-CN, and close </content>.' },
        ],
        labels: ['动态-内置文风', '视角体系', '字数设置'],
    },
};

const babyNames=['上帝：user你','上帝：user我','上帝：user她','上帝：char你','上帝：char我',
    '上帝User我char你','上帝User你char我','user你','user我','user她','char你','char我','User我char你','User你char我'];
const babySource=[
    {identifier:'a-header',name:'<==抢话▣▣权限==>',role:'system',content:''},
    ...['不抢','微量','适度','协同','完全'].map((name,i)=>({
        identifier:'a'+i,name:'▢'+name,role:'system',
        content:'<rule name="演绎权限·'+(i+1)+'档">原作者抢话：'+name+'</rule>',
    })),
    {identifier:'r-header',name:'<==复述▣▣权限==>',role:'system',content:''},
    ...['完全扩写','扩写为主','扩写优先','复述均衡','复述不限','简要复述','精简复述','不复述','绝不复述'].map((name,i)=>({
        identifier:'r'+i,name:'▢'+name,role:'system',
        content:'<rule name="回复处理·'+(i+1)+'档">原作者复述：'+name+'</rule>',
    })),
    {identifier:'p-header',name:'<==人称▣▣选1个==>',role:'system',content:''},
    ...babyNames.map((name,i)=>({identifier:'p'+i,name:'▢'+name,role:'system',
        content:'<rule name="人称·'+(i+1)+'">原作者人称：'+name+'</rule>'})),
    {identifier:'style-start',name:'┏╔拖拖📚文风╗┓',role:'system',content:'<writing_style>'},
    {identifier:'style-random',name:'📩随机适配📩',role:'system',
        content:'<writing_style:随机适配>根据剧情自动选择原作者文风。</writing_style>'},
    {identifier:'style-lemon',name:'🎵拖：柠檬糖',role:'system',
        content:'<writing_style:柠檬糖>原作者柠檬糖专属文风。</writing_style>'},
    {identifier:'style-rain',name:'🎵拖：梅雨季',role:'system',
        content:'<writing_style:梅雨季>原作者梅雨季专属文风。</writing_style>'},
    {identifier:'style-end',name:'┗╚拖拖📚文风╝┛',role:'system',content:'</writing_style>'},
];
const babyEnabled=new Set(['a-header','a4','r-header','r7','p-header','p0',
    'style-start','style-random','style-end']);
const babyPreset=parseStoryTheaterPreset(JSON.stringify({
    temperature:1,top_p:.9,frequency_penalty:0,presence_penalty:0,openai_max_tokens:10000,
    prompts:babySource,prompt_order:[{character_id:100001,
        order:babySource.map(p=>({identifier:p.identifier,enabled:babyEnabled.has(p.identifier)}))}],
}),'宝宝我是char-作者选择模拟.json');
const dialectCase = dialectCases[dialect];
const mappedPreset = dialect === 'baby' ? babyPreset : dialectCase
    ? parseStoryTheaterPreset(JSON.stringify({
        temperature: dialectCase.temperature, top_p: dialectCase.top_p,
        frequency_penalty: dialectCase.frequency_penalty, presence_penalty: dialectCase.presence_penalty,
        openai_max_tokens: dialectCase.openai_max_tokens,
        prompts: dialectCase.items.map((item, i) => ({
            identifier: item.id || 'v' + i, role: 'system', name: item.name, content: item.content,
        })),
        prompt_order: [{ character_id: 100001,
            order: dialectCase.items.map((item, i) => ({ identifier: item.id || 'v' + i, enabled: item.enabled !== false })) }],
        extensions: { entryGrouping: dialectCase.sourceGroups || [] },
    }), dialect + '.json') : imported;
const groups = getStoryPresetPromptGroups(mappedPreset.document);
const authoredIds = imported.document.prompts.map(p=>p.id);
const groupingSafe = (dialect === 'baby' || Boolean(dialectCase)) || groups.length >= 11
    && groups.flatMap(group=>group.promptIds).join('|')===authoredIds.join('|')
    && groups.every(group=>group.autoGrouped)
    && imported.document.prompts.filter(p=>p.enabled).length===104;
createRoot(document.getElementById('visual')!).render(
    React.createElement('div',{className:`story-theme story-theme-${light ? 'light' : 'dark'} story-decor-plain h-full w-full`},
        React.createElement(StoryPresetMaker,{
            preset:native ? BUILTIN_NIGHT_SCREENING_PRESET : mappedPreset,
            onBack:()=>{},onSave:async()=>{},onOpenCopy:async()=>{},onDelete:async()=>{},
        }),
    ),
);

let stage = 0;
let markerToggled = false;
let detailSelected = false;
let edgeHiddenProtected = false;
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
    if (!native && dialect === 'edge' && ['structure-hidden', 'structure', 'added'].includes(focus)) {
        if (stage === 0) {
            pro.click(); stage = 1; setTimeout(check, 180); return;
        }
        if (stage === 1) {
            const group = buttons.find(b => b.textContent?.includes('作者自定义结构区')
                && b.textContent?.includes('条有效'));
            if (!group) { setTimeout(check, 180); return; }
            group.click(); stage = 2; setTimeout(check, 180); return;
        }
        if (stage === 2 && focus !== 'structure-hidden') {
            const down = document.querySelector<HTMLButtonElement>('button[aria-label="前段正文：下移"]');
            edgeHiddenProtected = down?.disabled === true
                && !document.querySelector('button[aria-label="空白插槽：下移"]')
                && !document.querySelector('button[aria-label="Lite占位：下移"]');
            if (!edgeHiddenProtected) { setTimeout(check, 180); return; }
            const show = clickByText('显示空条目');
            if (!show) { setTimeout(check, 180); return; }
            show.click(); stage = 3; setTimeout(check, 180); return;
        }
        if (stage === 3 && focus === 'added') {
            const add = clickByText('在本区新增提示词');
            if (!add) { setTimeout(check, 180); return; }
            add.click(); stage = 4; setTimeout(check, 180); return;
        }
        if (stage === 4 && focus === 'added') {
            const back = clickByText('返回提示词列表');
            if (!back) { setTimeout(check, 180); return; }
            back.click(); stage = 5; setTimeout(check, 180); return;
        }
    }
    if (!native && dialect === 'unseen' && (focus === 'inspect' || focus === 'returned')) {
        if (stage === 0) {
            const view = document.querySelector<HTMLElement>('main.story-page-scroll');
            const preview = clickByText('查看原文');
            if (!view || !preview) { setTimeout(check, 180); return; }
            view.scrollTop = 200;
            preview.click();
            stage = 1; setTimeout(check, 180); return;
        }
        if (stage === 1) {
            const inspector = document.querySelector('[role="dialog"][aria-label="查看原作者原文"]');
            const choice = inspector && [...inspector.querySelectorAll<HTMLButtonElement>('button')]
                .find(button => button.textContent?.includes('晦夜'));
            if (!choice) { setTimeout(check, 180); return; }
            choice.click(); stage = 2; setTimeout(check, 180); return;
        }
        if (stage === 2 && focus === 'returned') {
            const back = document.querySelector<HTMLButtonElement>('button[aria-label="返回原作选择"]');
            if (!back) { setTimeout(check, 180); return; }
            back.click(); stage = 3; setTimeout(check, 180); return;
        }
    }
    if (!native && dialect === 'baby' && focus === 'author' && stage === 0) {
        const select = document.querySelector<HTMLButtonElement>('button[aria-label="抢话权限：不抢（未启用）"]');
        if (select) { select.click(); stage = 1; setTimeout(check, 200); return; }
    }
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
    const nativeAuthorMapping = dialect === 'baby' ? ['抢话权限','复述权限','人称选1个','拖拖文风',
        '完全','不复述','上帝：user你','随机适配'].every(value =>
            focus === 'author' && value === '完全' ? true : document.body.textContent?.includes(value))
        : dialectCase && focus === 'overview'
        ? dialectCase.labels.every(value => document.body.textContent?.includes(value))
        : native || focus !== 'overview' || ['抢话权限', '语言设置', '视角设置'].every(value => document.body.textContent?.includes(value));
    const generationControls = ['温度', '候选范围', '重复惩罚', '话题惩罚', '最大输出']
        .every(x => headingText.includes(x) || document.body.textContent?.includes(x));
    const authorOnly = document.body.textContent?.includes('原作选择')
        && !document.body.textContent?.includes('汽水日常')
        && !document.body.textContent?.includes('冷峻正剧')
        && !document.body.textContent?.includes('低烧 I');
    const selectedSourceChoice = dialect === 'baby' && stage === 1
        && document.querySelector<HTMLButtonElement>('button[aria-label="抢话权限：不抢（已启用）"]')?.getAttribute('aria-pressed') === 'true'
        && !document.querySelector<HTMLButtonElement>('button[aria-label="抢话权限：完全（已启用）"]');
    const inspector = document.querySelector('[role="dialog"][aria-label="查看原作者原文"]');
    const inPlaceInspectOk = stage === 2 && Boolean(inspector)
        && inspector?.querySelector('pre')?.textContent?.includes('ONLY-UNKNOWN-DUSK')
        && !proOn;
    const returnPositionOk = stage === 3 && !inspector
        && !proOn && authorOnly
        && (document.querySelector<HTMLElement>('main.story-page-scroll')?.scrollTop || 0) >= 140;
    const edgeHiddenOk = stage === 2
        && document.querySelector<HTMLButtonElement>('button[aria-label="前段正文：下移"]')?.disabled === true
        && !document.querySelector('button[aria-label="空白插槽：下移"]');
    const edgeStructureOk = stage === 3 && edgeHiddenProtected
        && document.querySelector<HTMLButtonElement>('button[aria-label="前段正文：下移"]')?.disabled === false
        && Boolean(document.querySelector('button[aria-label="空白插槽：下移"]'))
        && Boolean(document.querySelector('button[aria-label="Lite占位：下移"]'));
    const edgeAddedOk = stage === 5 && edgeHiddenProtected
        && Boolean(document.querySelector('button[aria-label="新提示词：下移"]'))
        && !clickByText('返回提示词列表')
        && Boolean(document.body.textContent?.includes('作者自定义结构区'));
    const success = fit && nativeAuthorMapping && (
        focus === 'structure-hidden' ? edgeHiddenOk
        : focus === 'structure' ? edgeStructureOk
        : focus === 'added' ? edgeAddedOk :
        focus === 'inspect' ? inPlaceInspectOk
            : focus === 'returned' ? returnPositionOk
            : native ? !proOn && eightControls && generationControls : groupingSafe && (
        focus === 'overview' ? !proOn && authorOnly && !eightControls && generationControls
            : focus === 'author' ? !proOn && authorOnly && selectedSourceChoice
            : focus === 'slot' ? proOn && markerToggled && quickEditor : proOn && detailSelected));
    document.body.dataset.storyPresetAuditReady = String(success);
    let output = document.getElementById('story-preset-audit-report');
    if (!output) {
        output = document.createElement('output');
        output.hidden = true; output.id = 'story-preset-audit-report'; document.body.append(output);
    }
    output.textContent = JSON.stringify({ native, focus, proOn, fit, groupCount: groups.length,
        groupingSafe, eightControls, authorOnly, nativeAuthorMapping, selectedSourceChoice, generationControls, markerToggled,
        quickEditor, detailSelected, stage, inPlaceInspectOk, returnPositionOk,
        edgeHiddenProtected, edgeHiddenOk, edgeStructureOk, edgeAddedOk, success });
    if (!success && stage < 5) setTimeout(check, 200);
};
setTimeout(check, 950);
