import React from 'react';
import { createRoot } from 'react-dom/client';
import { OSProvider } from '../../context/OSContext';
import { MusicProvider } from '../../context/MusicContext';
import WorldbookApp from '../../apps/WorldbookApp';
import { DB } from '../../utils/db';
import { parseStandardWorldbook } from '../../utils/worldbook';

const mode = new URLSearchParams(location.search).get('mode') || 'normal';
const diaryMode = mode.startsWith('diary');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const seed = async () => {
    const groups = mode === 'diary-overflow'
        ? [
            { category: '日记设定', names: [...Array(16).fill('日记'), '日记本', '日记本'] },
        ] : diaryMode
        ? [
            { category: '余天酮的世界书', names: ['日记'] },
            { category: '陆鸣野的世界书', names: ['日记'] },
            { category: '苗理生的世界书', names: ['日记'] },
            { category: '祁寒川的世界书', names: ['日记本'] },
            { category: '许今朝的世界书', names: ['日记本'] },
        ] : [
            { category: '海边设定', names: ['海岸', '海岸', '海岸', '海岸线'] },
            { category: '旅途设定', names: ['海岸', '海岸', '海岸', '山间'] },
        ];
    for (const group of groups) {
        const entries = Object.fromEntries(group.names.map((name, i) => [
            String(i), { uid: i, comment: name, content: name + '的详细设定内容。', key: [], constant: true },
        ]));
        const books = parseStandardWorldbook(JSON.stringify({ entries }), group.category);
        for (const [index, book] of books.entries()) {
            // Simulate imported books with mixed enabled states for the card switch.
            if (mode.startsWith('toggle') && group.category === '海边设定' && index === 0) book.disable = true;
            await DB.saveWorldbook(book);
        }
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
    await waitFor(() => [...document.querySelectorAll('h3')].find(el => el.textContent === (diaryMode ? mode === 'diary-overflow' ? '日记设定' : '余天酮的世界书' : '海边设定')) as HTMLElement | undefined || null);
    if (mode !== 'normal') {
        const input = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="搜索世界书条目"]'));
        fillReactInput(input, diaryMode ? '日记' : '海岸');
        await waitFor(() => document.querySelector('h4'));
        await sleep(200);
        if (mode.startsWith('toggle')) {
            const switches = await waitFor(() => {
                const items = [...document.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
                return items.length === 7 ? items[0] : null;
            });
            const before = await DB.getAllWorldbooks();
            const disabledOriginal = before.find(book => book.category === '海边设定' && book.disable);
            if (!disabledOriginal || switches.getAttribute('aria-checked') !== 'false')
                throw new Error('Fixture must start with one disabled book and a visible off switch');
            const firstCard = switches.closest('.cursor-pointer');
            if (!firstCard || (firstCard.querySelector('h4')?.textContent || '') !== '海岸')
                throw new Error('Switch not placed on the correct worldbook card');
            // Native pointer gestures on the switch must never initiate a long press or expand the card.
            if (mode !== 'toggle-initial') {
                switches.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch', clientX: 310, clientY: 200 }));
                switches.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'touch', clientX: 310, clientY: 200 }));
                switches.click();
                await waitFor(() => switches.getAttribute('aria-checked') === 'true' ? switches : null);
                const saved = await DB.getAllWorldbooks();
                if (saved.find(book => book.id === disabledOriginal.id)?.disable !== false) throw new Error('Enabling a book did not persist to IndexedDB');
                if (saved.some(book => book.disable)) throw new Error('Enabling one book modified unrelated records');
                const next = [...document.querySelectorAll<HTMLButtonElement>('button[role="switch"]')].find(el => el !== switches);
                if (!next || next.getAttribute('aria-checked') !== 'true') throw new Error('Other switches must remain enabled');
                next.click();
                await waitFor(() => next.getAttribute('aria-checked') === 'false' ? next : null);
                const after = await DB.getAllWorldbooks();
                if (after.filter(book => book.disable).length !== 1) throw new Error('Disabling one other book must persist exactly once');
                if (after.find(book => book.id === disabledOriginal.id)?.disable) throw new Error('First enabled book reverted unexpectedly');
                if (document.querySelector('button[title="退出批量管理"]') || document.querySelector('h4')?.closest('.cursor-pointer')?.textContent?.includes('详细设定内容'))
                    throw new Error('Switch must not trigger card preview or multiselect');
            }
        }
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
        if (mode === 'diary-delete' || mode === 'diary-overflow') {
            const manage = await waitFor(() => document.querySelector<HTMLButtonElement>('button[title="批量管理世界书"]'));
            manage.click();
            const all = await waitFor(() => [...document.querySelectorAll('button')].find(el => el.textContent?.includes('全选结果')) as HTMLButtonElement | undefined || null);
            const before = [...document.querySelectorAll('h4')].map(el => el.textContent?.trim());
            const expected = mode === 'diary-overflow' ? 18 : 5;
            if (before.length !== expected) throw new Error(`搜索结果应展示 ${expected} 条，实际只有 ${before.length} 条`);
            if (mode === 'diary-overflow') {
                all.click();
                await sleep(200);
                if (!(document.getElementById('root')?.textContent || '').includes('已选 18')) throw new Error('跨页的 18 条搜索结果没有全部选中');
            } else {
                all.click();
                await sleep(200);
                const del = await waitFor(() => document.querySelector<HTMLButtonElement>('button[aria-label="删除选中条目"]'));
                del.click();
                const confirm = await waitFor(() => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === '删除 5 条') as HTMLButtonElement | undefined || null);
                confirm.click();
                await waitFor(() => (document.getElementById('root')?.textContent || '').includes('没有找到同名条目') ? document.getElementById('root') : null);
                const remaining = await DB.getAllWorldbooks();
                if (remaining.length) throw new Error(`一次删除后仍有 ${remaining.length} 条匹配世界书`);
            }
        }
    }
    const titles = [...document.querySelectorAll('h4')].map(el => el.textContent?.trim());
    const heading = document.querySelector('main')?.textContent || document.getElementById('root')?.textContent || '';
    const output = document.createElement('output');
    output.setAttribute('data-worldbook-visual-ready', 'true');
    output.setAttribute('data-match-count', String(titles.filter(t => t === (diaryMode ? '日记' : '海岸')).length));
    output.setAttribute('data-other-count', String(titles.filter(t => t !== (diaryMode ? '日记' : '海岸')).length));
    output.setAttribute('data-selected-count', mode === 'selected' && heading.includes('已选 7') ? '7' : '0');
    output.setAttribute('data-diary-initial-count', diaryMode ? String(mode === 'diary-overflow' ? 18 : 5) : '0');
    output.setAttribute('data-diary-selected-count', mode === 'diary-overflow' && heading.includes('已选 18') ? '18' : '0');
    output.setAttribute('data-diary-deleted', String(mode === 'diary-delete' && titles.length === 0 && heading.includes('没有找到同名条目')));
    output.setAttribute('data-duplicate-empty-state', String(mode === 'diary-delete' && heading.includes('世界还是空白的')));
    output.setAttribute('data-long-press-selected', String((window as any).worldbookLongPressSelected === true));
    output.setAttribute('data-intro-present', String(heading.includes('世界书是做什么的')));
    output.setAttribute('data-horizontal-overflow', String(Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > window.innerWidth + 1));
    output.setAttribute('data-switch-on-count', String([...document.querySelectorAll('button[role="switch"][aria-checked="true"]')].length));
    output.setAttribute('data-switch-off-count', String([...document.querySelectorAll('button[role="switch"][aria-checked="false"]')].length));
    output.setAttribute('data-switch-aria-labels', String([...document.querySelectorAll('button[role="switch"]')].every(button => !!button.getAttribute('aria-label'))));
    output.setAttribute('data-switch-has-visible-text', String([...document.querySelectorAll('button[role="switch"]')].some(button => !!button.textContent?.trim())));
    const switchForSize = document.querySelector<HTMLButtonElement>('button[role="switch"]');
    const switchRect = switchForSize?.getBoundingClientRect();
    output.setAttribute('data-switch-width', String(Math.round(switchRect?.width || 0)));
    output.setAttribute('data-switch-height', String(Math.round(switchRect?.height || 0)));
    output.setAttribute('data-switch-background', switchForSize ? getComputedStyle(switchForSize).backgroundColor : '');
    output.setAttribute('data-switch-thumb-width', String(Math.round(switchForSize?.firstElementChild?.getBoundingClientRect().width || 0)));
    output.style.display = 'none';
    document.body.appendChild(output);
};
run().catch(error => {
    const output = document.createElement('output');
    output.setAttribute('data-worldbook-visual-error', String(error));
    document.body.appendChild(output);
});
