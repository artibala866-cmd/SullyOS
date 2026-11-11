import React from 'react';
import { createRoot } from 'react-dom/client';
import { parseStoryRegexImport } from '../utils/storyRegexImport';
import { applyStoryRegex } from '../utils/storyRegex';
import AlchemyMessageBody from '../components/alchemy/AlchemyMessageBody';
import { alchemyInstructions } from '../utils/alchemyRegex';

const rules = parseStoryRegexImport(JSON.stringify([
    {
        name:'微信红包', scope:'global', scenes:['chat'], enabled:1, isHtmlTemplate:true,
        renderMode:'iframe', parseMode:'json', role:'both', order:1, triggerEnabled:0,
        pattern:'<wxredpack>([\\s\\S]*?)</wxredpack>', flags:'g', applyOnDisplay:1,
        aiPrompt:'发送红包时输出 <wxredpack> JSON 卡片',
        htmlTemplate:'<div style="height:275px;background:#f28c48;border-radius:10px;padding:12px;">'
          + '<style>.al-hb-open{display:none}#hb:checked~.al-hb-open{display:block}</style>'
          + '<input type="checkbox" id="hb" style="display:none">'
          + '<label for="hb" style="display:block;padding:12px;color:white;">打开红包</label>'
          + '<div class="al-hb-open" style="background:white;padding:10px;">{{1.msg}}</div></div>'
    },
    {
        name:'刮彩票', scope:'global', scenes:['chat'], enabled:1, isHtmlTemplate:true,
        renderMode:'iframe', parseMode:'json', role:'both', order:2, triggerEnabled:0,
        pattern:'<scratchcard>([\\s\\S]*?)</scratchcard>', flags:'g', applyOnDisplay:1,
        aiPrompt:'送惊喜时输出 <scratchcard> JSON 卡片',
        htmlTemplate:'<div style="height:310px;background:#e63a3a;border-radius:10px;padding:15px;color:white;">'
          + '<div>刮刮乐</div><div style="position:relative">'
          + '<p>{{1.prize}}</p><canvas width="240" height="100"></canvas>'
          + '<img src="x" onerror="initCanvas(getContext())" /></div></div>'
    },
]));
const result = applyStoryRegex(
    '<wxredpack>{"msg":"生日快乐"}</wxredpack>\n'
    + '<scratchcard>{"prize":"小礼物"}</scratchcard>', rules.rules, 'display');

function App(){
    return <main className="mx-auto min-h-screen max-w-md bg-[#f7f7f7] px-4 py-8">
        <div className="mb-4 text-xs text-neutral-400">私聊 / 群聊 · 自动美化</div>
        <AlchemyMessageBody result={result}/>
    </main>;
}
createRoot(document.getElementById('visual')!).render(<App/>);

const expectedPrompts=alchemyInstructions(rules.rules,'online',{},'刚刚回家');
const assert=()=>{
    const frames=[...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')];
    const hasSource=frames.length===2
        && frames[0].srcdoc.includes('#hb:checked~.al-hb-open')
        && frames[0].srcdoc.includes('生日快乐')
        && frames[1].srcdoc.includes('data-alchemy-scratch="1"')
        && frames[1].srcdoc.includes('刮刮乐');
    const sizes=frames.map(frame=>Number.parseFloat(frame.style.height));
    const resized=sizes.length===2&&sizes[0]>240&&sizes[1]>260;
    const prompts=expectedPrompts.length===2;
    document.body.dataset.alchemyLiveCardReady=String(hasSource&&resized&&prompts);
    document.body.dataset.alchemyLiveCardReport=JSON.stringify({hasSource,resized,prompts,sizes});
};
window.setTimeout(assert, 2600);
