import React from 'react';
import { createRoot } from 'react-dom/client';
import StoryQuickPresetPanel from '../components/date/story/StoryQuickPresetPanel';
import { BUILTIN_NIGHT_SCREENING_PRESET, getStoryTavernAuthorSections, parseStoryTheaterPreset, selectStoryTavernAuthorOption } from '../utils/storyTheater';

const qs = new URLSearchParams(location.search);
const variant = qs.get('variant') || 'baby';
const selected = qs.get('selected') === '1';
const authorData = variant === 'unseen'
    ? {
        prompts: [
            { identifier:'core', name:'核心要求不要关', role:'system', content:'保留叙事底座。' },
            { identifier:'a', name:'微光日记', role:'system', content:'未见过作者的第一种风格。' },
            { identifier:'b', name:'夜航纪事', role:'system', content:'未见过作者的第二种风格。' },
            { identifier:'c', name:'低调角色', role:'system', content:'人物说话节制。' },
            { identifier:'d', name:'开放角色', role:'system', content:'人物热情主动。' },
        ],
        prompt_order: [{character_id:100001,order:[
            {identifier:'core',enabled:true},{identifier:'a',enabled:true},
            {identifier:'b',enabled:false},{identifier:'c',enabled:true},{identifier:'d',enabled:false},
        ]}],
        extensions: {entryGrouping:[
            {id:'style', name:'暮河调色盒（择一）',memberIdentifiers:['a','b']},
            {id:'agency',name:'行为手势（择一）',memberIdentifiers:['c','d']},
        ]},
    }
    : {
        prompts: [
            { identifier:'core', name:'原作者底座不要关', role:'system', content:'底座不得关闭。' },
            { identifier:'head', name:'┏╔拖拖📚文风╗┓', role:'system', content:'<style>' },
            { identifier:'a', name:'🎵拖：柠檬糖', role:'system', content:'作者柠檬糖文风。' },
            { identifier:'b', name:'📩随机适配📩', role:'system', content:'作者随机适配。' },
            { identifier:'c', name:'🪶薄雾雨夜', role:'system', content:'作者薄雾雨夜文风。' },
            { identifier:'end', name:'┗╚拖拖📚文风╝┛', role:'system', content:'</style>' },
            { identifier:'agencyhead', name:'<==抢话▣▣权限==>', role:'system', content:'' },
            { identifier:'agency1', name:'▢不抢', role:'system', content:'不控制用户台词。' },
            { identifier:'agency2', name:'▢完全', role:'system', content:'作者完全演绎。' },
        ],
        prompt_order:[{character_id:100001,order:[
            {identifier:'core',enabled:true},{identifier:'head',enabled:true},
            {identifier:'a',enabled:true},{identifier:'b',enabled:false},
            {identifier:'c',enabled:false},{identifier:'end',enabled:true},
            {identifier:'agencyhead',enabled:true},{identifier:'agency1',enabled:true},
            {identifier:'agency2',enabled:false},
        ]}],
    };
const preset = parseStoryTheaterPreset(JSON.stringify(authorData), variant + '.json');
const sourceDocument = preset.document;
let documentToShow = variant === 'native' ? BUILTIN_NIGHT_SCREENING_PRESET.document : sourceDocument;
if (variant !== 'native' && selected) {
    const section = getStoryTavernAuthorSections(sourceDocument)
        .find(s => /文风|暮河调色盒/.test(s.label))!;
    const alternative = section.options.find(o => !o.enabled);
    if (alternative) documentToShow = selectStoryTavernAuthorOption(sourceDocument, section.key, alternative.id);
}
const root = createRoot(document.getElementById('visual')!);
root.render(<div className="relative h-full w-full bg-stone-100">
    <header className="px-6 pt-10 pb-5 flex justify-between border-b border-slate-200">
        <span className="text-xs tracking-wider text-slate-700">STORY THEATER　狐狸之窗</span>
        <span className="text-xs text-neutral-500">当前剧情</span>
    </header>
    <main className="px-7 pt-12 text-[18px] leading-[2.8] text-neutral-600">
        <p>传闻有一种手势，叫狐狸之窗。</p>
        <p className="mt-7">十指交叉，透过狭窄的缝隙，向故事里望去。</p>
        <p className="mt-7">上一轮的剧情已保存，下一轮将使用新预设。</p>
    </main>
    <StoryQuickPresetPanel document={documentToShow} hasOverride={selected}
        onApply={async doc => { (document.body as any).dataset.appliedStoryQuickPreset = JSON.stringify({
            source: doc.sourceFormat, enabled: doc.prompts.filter(p => p.enabled).map(p => p.id),
        }); }} onReset={async()=>{}} onClose={() => {}}/>
</div>);
const started = Date.now();
const check = () => {
    const sheet = document.querySelector('[data-story-quick-author-options]');
    const fit = document.documentElement.scrollWidth <= window.innerWidth;
    const authorShown = variant === 'native' || Boolean(sheet && sheet.querySelectorAll('button[aria-pressed]').length >= 2);
    const labels = variant === 'unseen' ? ['暮河调色盒', '微光日记', '夜航纪事']
        : variant === 'native' ? ['文风'] : ['拖拖📚文风', '柠檬糖', '随机适配'];
    const correctText = labels.every(v => document.body.textContent?.includes(v));
    const noEmpty = !document.body.textContent?.includes('这个预设没有可用于默认版的选项');
    const success = fit && authorShown && correctText && noEmpty;
    document.body.dataset.storyQuickAuthorReady = String(success);
    let report = document.getElementById('story-quick-author-report');
    if (!report) {report = document.createElement('output'); report.id='story-quick-author-report'; report.hidden=true; document.body.append(report);}
    report.textContent = JSON.stringify({variant,selected,fit,authorShown,correctText,noEmpty,success});
    if (!success && Date.now()-started < 9000) setTimeout(check,180);
};
setTimeout(check,900);
