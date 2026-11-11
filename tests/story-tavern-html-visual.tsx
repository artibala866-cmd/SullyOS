import React from 'react';
import { createRoot } from 'react-dom/client';
import { parseStoryDisplayBlocks } from '../utils/storyTheater';
import { SafeStoryHtml } from '../components/date/story/StoryTheaterSession';

const defaultRaw = [
    '<content>雨夜，林星推开剧场的门。',
    '<sidestory>',
    '<style>.theater-sheet{background-color:#faf1fa;border:1px solid #dbc4ee;border-radius:14px;padding:14px}',
    '.theater-sheet .headline{color:#69428a;font-weight:bold;font-size:18px}',
    '.theater-sheet table{background-color:#fff}</style>',
    '<div class="theater-sheet" onclick="attack()">',
    '<div class="headline">幕间频道 · 雨夜来信</div>',
    '<p>这一段来自酒馆 HTML 小剧场，不是正文。</p>',
    '<details open><summary>展开的剧场附录</summary>',
    '<table><tr><th>演员</th><th>台词</th></tr>',
    '<tr><td>林星</td><td>这封信，我留下了。</td></tr>',
    '<tr><td>旁白</td><td>雨水仍在窗沿滴落。</td></tr></table>',
    '</details>',
    '<script>window.storyHtmlHacked=true</script>',
    '</div></sidestory>',
    '正文继续：她把信收进口袋。</content>',
].join('');
const dialect = new URLSearchParams(location.search).get('dialect') || 'default';
const dialectSamples: Record<string, string> = {
    pluto: '<content>两人从剧场走出来。</content>'
        + '<RandomTheater><details><summary>雨夜随机剧场</summary><div style="color:purple">随机频道来信</div></details></RandomTheater>'
        + '<Episode><details><summary>主题附录</summary><div style="border-radius:8px">星光与风声</div></details></Episode>'
        + '<content>正剧继续。</content>',
    ako: '<content>她将书信放在桌上。</content>'
        + '<writing_interlude>[Header|灯下留白|MIDNIGHT][Tags|书信|车站|夜色]'
        + '[Meta|午夜|雨夜|二人][Content|旧信在桌面上慢慢展开。]'
        + '[Dialogue|她问候|他回应|窗外雨声|没有人离开]'
        + '[Quote|仍有余温|Still here.]</writing_interlude>'
        + '<content>正文没有因此中断。</content>',
    mur: '<content>雨已经停了。</content>'
        + '<abstract_format><details><summary>摘要</summary><p>剧情概要保留。</p>'
        + '<details><summary>伏笔</summary><div>门后的脚步声</div></details></details></abstract_format>',
    janus: '<content>这里没有开启小剧场，只有正常剧情。</content>',
};
const raw = dialectSamples[dialect] || defaultRaw;
const expectedPhrase: Record<string, string> = {
    default:'雨夜来信',pluto:'随机频道来信',ako:'灯下留白',mur:'剧情概要保留。',
};
const expectedKinds: Record<string, string> = {
    default:'story,tavern-extra,story',pluto:'story,tavern-extra,tavern-extra,story',
    ako:'story,tavern-extra,story',mur:'story,tavern-extra',janus:'story',
};
const blocks = parseStoryDisplayBlocks(raw, true);
const root = createRoot(document.getElementById('visual')!);
root.render(
    React.createElement('main', {
        className: 'mx-auto max-w-2xl p-5 space-y-5',
        style: { width: '100%', boxSizing: 'border-box' },
    },
        React.createElement('header', {className:'text-sm font-semibold text-slate-700'},
            '剧情模式 · 小剧场真实浏览器检查'),
        ...blocks.map((block, i) => block.kind === 'tavern-extra'
            ? React.createElement('details', {key:i,open:true,className:'rounded-lg border border-violet-200 bg-white px-3 py-3'},
                React.createElement('summary',{className:'text-sm font-semibold text-violet-700 cursor-pointer mb-3'},block.title),
                block.htmlSource
                    ? React.createElement(SafeStoryHtml,{
                        source:block.htmlSource,fallback:block.text,title:block.title||'酒馆小剧场'
                    })
                    : React.createElement('p',null,block.text))
            : React.createElement('p',{key:i,className:'text-sm leading-7 text-slate-700 whitespace-pre-wrap'},
                block.text)),
        React.createElement('p',{className:'text-xs text-slate-500'},
            '安全 HTML 被限制在本附录中，不会在剧情主页面执行 JavaScript。'),
    ),
);
const report = () => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe');
    const doc = frame?.srcdoc || '';
    const widthOk = document.documentElement.scrollWidth <= innerWidth;
    const structure = blocks.map(b => b.kind).join(',') === expectedKinds[dialect];
    const expectedFrames = dialect === 'pluto' ? 2 : dialect === 'janus' ? 0 : 1;
    const frameCount = document.querySelectorAll('iframe').length;
    const secure = dialect === 'janus'
        ? frameCount === 0
        : frame?.getAttribute('sandbox') === 'allow-scripts'
            && doc.includes('Content-Security-Policy')
            && doc.includes("script-src &#39;nonce-sully-story-template-runtime&#39;")
            && doc.includes('story-theater-html-content')
            && doc.includes(expectedPhrase[dialect])
            && !doc.includes('attack()')
            && !doc.includes('storyHtmlHacked')
            && doc.includes('<script nonce="sully-story-template-runtime">')
            && doc.split('<script').length === 2
            && !doc.includes('tracker.invalid');
    const frameHeights = Array.from(document.querySelectorAll('iframe')).map(frame => frame.getBoundingClientRect().height);
    // A real content-height frame may be taller than its old heuristic.
    // Check for excess blank space without reintroducing a scrolling iframe.
    const compactHeight = dialect === 'janus' || frameHeights.every(height =>
        height >= 76 && height <= 650);
    const success = Boolean(frameCount === expectedFrames && structure && secure && widthOk && compactHeight);
    document.body.dataset.storyTheaterHtmlReady = String(success);
    let output=document.getElementById('story-tavern-html-report');
    if (!output) {
        output=document.createElement('output');output.id='story-tavern-html-report';output.hidden=true;
        document.body.append(output);
    }
    output.textContent=JSON.stringify({dialect,success,widthOk,structure,secure,compactHeight,frameCount,iframeHeight:frame?.getBoundingClientRect().height,iframe:!!frame,
        screen:[innerWidth,innerHeight],blocks:blocks.map(b=>b.kind)});
};
setTimeout(report,1600);
