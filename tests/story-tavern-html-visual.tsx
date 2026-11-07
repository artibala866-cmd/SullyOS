import React from 'react';
import { createRoot } from 'react-dom/client';
import { parseStoryDisplayBlocks } from '../utils/storyTheater';
import { SafeStoryHtml } from '../components/date/story/StoryTheaterSession';

const raw = [
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
    const structure = blocks.map(b => b.kind).join(',') === 'story,tavern-extra,story';
    const secure = frame?.getAttribute('sandbox') === ''
        && doc.includes('Content-Security-Policy')
        && doc.includes('story-theater-html-content')
        && doc.includes('雨夜来信')
        && !doc.includes('attack()')
        && !doc.includes('storyHtmlHacked')
        && !doc.includes('<script');
    const compactHeight = Boolean(frame && frame.getBoundingClientRect().height <= 270);
    const success = Boolean(frame && structure && secure && widthOk && compactHeight);
    document.body.dataset.storyTheaterHtmlReady = String(success);
    let output=document.getElementById('story-tavern-html-report');
    if (!output) {
        output=document.createElement('output');output.id='story-tavern-html-report';output.hidden=true;
        document.body.append(output);
    }
    output.textContent=JSON.stringify({success,widthOk,structure,secure,compactHeight,iframeHeight:frame?.getBoundingClientRect().height,iframe:!!frame,
        screen:[innerWidth,innerHeight],blocks:blocks.map(b=>b.kind)});
};
setTimeout(report,1600);
