import React from 'react';
import { createRoot } from 'react-dom/client';
import { OSProvider } from '../../context/OSContext';
import { MusicProvider } from '../../context/MusicContext';
import WorldbookApp from '../../apps/WorldbookApp';
import { DB } from '../../utils/db';
import { parseStandardWorldbook } from '../../utils/worldbook';

const mode = new URLSearchParams(location.search).get('mode') || 'normal';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const seed = async () => {
    const groups = [
        { category: '海边设定', names: ['海岸', '海岸', '海岸', '海岸线'] },
        { category: '旅途设定', names: ['海岸', '海岸', '海岸', '山间'] },
    ];
    for (const group of groups) {
        const entries = Object.fromEntries(group.names.map((name, i) => [
            String(i), { uid: i, comment: name, content: name + '的详细设定内容。', key: [], constant: true },
        ]));
        const books = parseStandardWorldbook(JSON.stringify({ entries }), group.category);
        for (const book of books) await DB.saveWorldbook(book);
    }
};

const waitFor = async (find: () => HTMLElement | null) => {
    for (let i = 0; i < 180; i++) {
        const element = find();
        if (element) return element;
        await sleep(100);
    }
    throw new Error('Worldbook visual fixture not ready');
};

const fillReactInput = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const run = async () => {
    await seed();
    createRoot(document.getElementById('root')!).render(
        <OSProvider><MusicProvider><WorldbookApp /></MusicProvider></OSProvider>
    );
    await waitFor(() => [...document.querySelectorAll('h3')].find(el => el.textContent === '海边设定') as HTMLElement | undefined || null);
    if (mode !== 'normal') {
        const input = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="搜索世界书条目"]'));
        fillReactInput(input, '海岸');
        await waitFor(() => document.querySelector('h4'));
        await sleep(200);
        if (mode === 'selected') {
            // Use the actual 520ms press gesture, including the trailing mobile click.
            const card = await waitFor(() => document.querySelector('h4')?.closest<HTMLElement>('.cursor-pointer') || null);
            card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', button: 0, clientX: 180, clientY: 320 }));
            await sleep(600);
            card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', button: 0, clientX: 180, clientY: 320 }));
            card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await waitFor(() => [...document.querySelectorAll('button')].find(el => el.textContent?.includes('全选结果')) as HTMLButtonElement | undefined || null);
            await sleep(100);
            (window as any).worldbookLongPressSelected = (document.getElementById('root')?.textContent || '').includes('已选 1');
            const all = [...document.querySelectorAll('button')].find(el => el.textContent?.includes('全选结果')) as HTMLButtonElement;
            all.click();
            await sleep(200);
        }
    }
    const titles = [...document.querySelectorAll('h4')].map(el => el.textContent?.trim());
    const heading = document.querySelector('main')?.textContent || document.getElementById('root')?.textContent || '';
    const output = document.createElement('output');
    output.setAttribute('data-worldbook-visual-ready', 'true');
    output.setAttribute('data-match-count', String(titles.filter(t => t === '海岸').length));
    output.setAttribute('data-other-count', String(titles.filter(t => t !== '海岸').length));
    output.setAttribute('data-selected-count', mode === 'selected' && heading.includes('已选 6') ? '6' : '0');
    output.setAttribute('data-long-press-selected', String((window as any).worldbookLongPressSelected === true));
    output.setAttribute('data-intro-present', String(heading.includes('世界书是做什么的')));
    output.setAttribute('data-horizontal-overflow', String(Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > window.innerWidth + 1));
    output.style.display = 'none';
    document.body.appendChild(output);
};
run().catch(error => {
    const output = document.createElement('output');
    output.setAttribute('data-worldbook-visual-error', String(error));
    document.body.appendChild(output);
});
