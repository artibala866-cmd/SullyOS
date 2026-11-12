import React from 'react';
import { createRoot } from 'react-dom/client';
import { OSProvider } from '../../context/OSContext';
import { MusicProvider } from '../../context/MusicContext';
import WorldbookApp from '../../apps/WorldbookApp';
import { DB } from '../../utils/db';
import { parseStandardWorldbook } from '../../utils/worldbook';

const mode = new URLSearchParams(location.search).get('mode') || 'normal';
const diaryMode = mode.startsWith('diary');
const manyMode = mode.startsWith('many');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let visualStage = 'seed';

const seed = async () => {
    const groups = manyMode ? [
        { category: '压力测试世界书', names: Array.from({length: 68}, (_, i) => `压力条目${String(i + 1).padStart(2, '0')}`) },
        { category: '备用分组世界书', names: Array.from({length: 24}, (_, i) => `备用条目${String(i + 1).padStart(2, '0')}`) },
    ] : mode === 'diary-overflow'
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
    const groups = [...document.querySelectorAll('h3')].map(el => el.textContent?.trim()).join(',');
    const cards = [...document.querySelectorAll('h4')].map(el => el.textContent?.trim()).slice(0, 3).join(',');
    const pagination = [...document.querySelectorAll('span')].map(el => el.textContent?.trim()).filter(t => (t || '').includes(' / ')).slice(0, 3).join(',');
    throw new Error(`Worldbook fixture timeout (${mode}/${visualStage}, groups=[${groups}], cards=[${cards}], pages=[${pagination}])`);
};

const fillReactInput = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const run = async () => {
    await seed();
    visualStage = 'load-app';
    createRoot(document.getElementById('root')!).render(
        <OSProvider><MusicProvider><WorldbookApp /></MusicProvider></OSProvider>
    );
    await waitFor(() => [...document.querySelectorAll('h3')].find(el => el.textContent === (manyMode ? '压力测试世界书' : diaryMode ? mode === 'diary-overflow' ? '日记设定' : '余天酮的世界书' : '海边设定')) as HTMLElement | undefined || null);
    if (manyMode) {
        const headings = [...document.querySelectorAll('h3')] as HTMLElement[];
        if (headings.length !== 2 || document.querySelectorAll('h4').length !== 0)
            throw new Error('Collapsed categories must not render any hidden card DOM nodes');
        visualStage = 'expand-first-group';
        const firstHeader = headings.find(el => el.textContent === '压力测试世界书')!.parentElement!;
        const secondHeader = headings.find(el => el.textContent === '备用分组世界书')!.parentElement!;
        firstHeader.click();
        await waitFor(() => document.querySelectorAll('h4').length === 12 ? document.querySelector('h4') : null);
        const nextPage = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '下一页');
        for (let page = 2; page <= 4; page++) {
            visualStage = 'navigate-page-' + page;
            const next = nextPage();
            if (!next || next.disabled) throw new Error('Page ' + page + ' not reachable');
            next.click();
            await waitFor(() => {
                const text = document.getElementById('root')?.textContent || '';
                return text.includes(`${page} / 6`) && document.querySelectorAll('h4').length === 12 ? document.querySelector('h4') : null;
            });
        }
        if (document.querySelectorAll('h4').length !== 12) throw new Error('Page 4 should show twelve entries');
        if (![...document.querySelectorAll('h4')].every(node => (node.textContent || '').startsWith('压力条目')))
            throw new Error('Collapsed backup category leaked cards into the active page');
        visualStage = 'switch-to-backup-group';
        secondHeader.click();
        await waitFor(() => [...document.querySelectorAll('h4')].some(h => h.textContent?.startsWith('备用条目')) ? document.querySelector('h4') : null);
        if (document.querySelectorAll('h4').length !== 12) throw new Error('Switching groups must unmount previous cards');
        visualStage = 'restore-page-four';
        firstHeader.click();
        await waitFor(() => {
            const text = document.getElementById('root')?.textContent || '';
            return text.includes('4 / 6') && [...document.querySelectorAll('h4')].some(h => h.textContent?.startsWith('压力条目')) ? document.querySelector('h4') : null;
        });
        visualStage = 'repaint-scroll';
        // Repeatedly scroll the large fourth page, where the user saw an empty white tile.
        const scroller = document.querySelector<HTMLElement>('.overflow-y-auto');
        if (!scroller) throw new Error('Worldbook scroll container missing');
        for (let i = 0; i < 3; i++) {
            scroller.scrollTop = 0;
            await sleep(90);
            scroller.scrollTop = scroller.scrollHeight;
            await sleep(120);
        }
        await sleep(350);
        const cards = [...document.querySelectorAll<HTMLElement>('div.group.relative.overflow-hidden')];
        if (cards.length !== 12) throw new Error('Expected twelve real cards on page 4, got ' + cards.length);
        if (cards.some(card => getComputedStyle(card).backdropFilter !== 'none'))
            throw new Error('Repeated GPU-heavy backdrop blur is still applied to Worldbook cards');
        if (!cards.every(card => card.querySelector('h4') && card.querySelector('button[role="switch"]')))
            throw new Error('Worldbook cards on page 4 lost text or switches');
        if (mode === 'many-return') {
            const anchor = cards[8];
            const entryId = anchor.dataset.worldbookEntryId;
            if (!entryId) throw new Error('Worldbook entry has no stable anchor');
            scroller.scrollTop += anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 150;
            await sleep(120);
            const expectedTop = scroller.scrollTop;
            const expectedOffset = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
            const getAnchor = () => [...document.querySelectorAll<HTMLElement>('[data-worldbook-entry-id]')].find(el => el.dataset.worldbookEntryId === entryId);
            const openEdit = () => {
                const edit = getAnchor()?.querySelector<HTMLButtonElement>('button[data-worldbook-action="edit"]');
                if (!edit) throw new Error('Edit target disappeared');
                edit.click();
            };
            const checkReturn = async (kind: string) => {
                const back = await waitFor(() => document.querySelector<HTMLElement>('[data-worldbook-list-scroll]'));
                await waitFor(() => getAnchor() || null);
                await sleep(100);
                const current = getAnchor()!;
                const offset = current.getBoundingClientRect().top - back.getBoundingClientRect().top;
                if (Math.abs(back.scrollTop - expectedTop) > 3 || Math.abs(offset - expectedOffset) > 3)
                    throw new Error(kind + ' returned to top/wrong entry: expected ' + expectedTop + '/' + expectedOffset + ', got ' + back.scrollTop + '/' + offset);
                (window as any)['worldbookReturn' + kind] = true;
            };
            openEdit();
            const cancelEdit = await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '取消') || null);
            cancelEdit.click();
            await checkReturn('Cancel');
            openEdit();
            const saveEdit = await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '保存') || null);
            saveEdit.click();
            await checkReturn('Save');
        }
        if (mode === 'many-move') {
            visualStage = 'move-from-backup-page2-to-pressure-page6';
            secondHeader.click();
            await waitFor(() => [...document.querySelectorAll('h4')].some(node => node.textContent?.startsWith('备用条目')) ? document.querySelector('h4') : null);
            const next = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '下一页');
            if (!next) throw new Error('Backup category next-page button missing');
            next.click();
            await waitFor(() => (document.getElementById('root')?.textContent || '').includes('2 / 2')
                && document.querySelectorAll('h4').length === 12 ? document.querySelector('h4') : null);
            const movingCard = [...document.querySelectorAll<HTMLElement>('[data-worldbook-entry-id]')]
                .find(el => el.querySelector('h4')?.textContent?.trim() === '备用条目24');
            if (!movingCard?.dataset.worldbookEntryId) throw new Error('Backup page-two entry missing');
            const movingId = movingCard.dataset.worldbookEntryId;
            movingCard.scrollIntoView({ block: 'center' });
            await sleep(100);
            movingCard.querySelector<HTMLButtonElement>('button[data-worldbook-action="edit"]')?.click();
            const categoryInput = await waitFor(() => document.querySelector<HTMLInputElement>('input[placeholder="例如: 世界观、人物、地理..."]'));
            fillReactInput(categoryInput, '压力测试世界书');
            await sleep(120);
            const save = [...document.querySelectorAll<HTMLButtonElement>('button')]
                .find(button => button.textContent?.trim() === '保存');
            if (!save) throw new Error('Moved-entry save button missing');
            save.click();
            const destination = await waitFor(() => {
                const entry = [...document.querySelectorAll<HTMLElement>('[data-worldbook-entry-id]')]
                    .find(el => el.dataset.worldbookEntryId === movingId);
                const page = document.getElementById('root')?.textContent || '';
                return entry && page.includes('6 / 6') ? entry : null;
            });
            const recorded = (await DB.getAllWorldbooks()).find(book => book.id === movingId);
            if (recorded?.category !== '压力测试世界书') throw new Error('Moved entry not persisted in destination group');
            const destinationGroup = [...document.querySelectorAll('h3')].find(node => node.textContent === '压力测试世界书')?.parentElement?.parentElement;
            if (!destinationGroup?.contains(destination)) throw new Error('Destination group not expanded around moved entry');
            // 编辑页会卸载列表容器；必须读取重新挂载的滚动元素，而不是旧 DOM 引用。
            const activeScroller = document.querySelector<HTMLElement>('[data-worldbook-list-scroll]');
            if (!activeScroller) throw new Error('Destination scroll container missing');
            const destinationRect = destination.getBoundingClientRect();
            const scrollRect = activeScroller.getBoundingClientRect();
            if (destinationRect.bottom < scrollRect.top + 10 || destinationRect.top > scrollRect.bottom - 10)
                throw new Error('Moved entry was rendered but remained off-screen');
            (window as any).worldbookCategoryMove = true;
            // Preserve original source group page 4 and its visual assertions after testing destination page 6.
            for (const pageNumber of [5, 4]) {
                const previous = [...document.querySelectorAll<HTMLButtonElement>('button')]
                    .find(button => button.textContent?.trim() === '上一页');
                if (!previous) throw new Error('Destination previous-page button missing');
                previous.click();
                await waitFor(() => (document.getElementById('root')?.textContent || '').includes(pageNumber + ' / 6')
                    && document.querySelectorAll('h4').length === 12 ? document.querySelector('h4') : null);
            }
        }
    }
    if (mode !== 'normal' && !manyMode) {
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
        if (mode.startsWith('touch')) {
            const card = document.querySelector<HTMLElement>('[data-worldbook-entry-id]');
            const toggle = card?.querySelector<HTMLButtonElement>('button[data-worldbook-action="toggle"]');
            const edit = card?.querySelector<HTMLButtonElement>('button[data-worldbook-action="edit"]');
            const del = card?.querySelector<HTMLButtonElement>('button[data-worldbook-action="delete"]');
            if (!card || !toggle || !edit || !del) throw new Error('Missing separate action targets');
            const sw = toggle.getBoundingClientRect();
            const er = edit.getBoundingClientRect();
            const dr = del.getBoundingClientRect();
            const hit = (x: number, y: number) =>
                document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('button[data-worldbook-action]')?.dataset.worldbookAction;
            if (sw.width !== 32 || Math.round(sw.height) !== 18) throw new Error('Visual switch size changed');
            if (er.width < 36 || er.height < 36 || dr.width < 36 || dr.height < 36)
                throw new Error('Edit/delete touch regions are too small');
            if (sw.bottom + 6 >= er.top || Math.abs(er.right - dr.left) < 6)
                throw new Error('Toggle and edit/delete hit regions overlap');
            if (hit(sw.left + sw.width / 2, sw.bottom + 6) !== 'toggle'
                || hit(er.left + er.width / 2, er.top + er.height / 2) !== 'edit'
                || hit(dr.left + dr.width / 2, dr.top + dr.height / 2) !== 'delete')
                throw new Error('Touch hit test selects the wrong worldbook action');
            (window as any).worldbookActionHitZones = true;
            const prior = await DB.getAllWorldbooks();
            toggle.click();
            await waitFor(() => toggle.getAttribute('aria-checked') === 'false' ? toggle : null);
            const next = await DB.getAllWorldbooks();
            if (next.filter(book => book.disable).length !== prior.filter(book => book.disable).length + 1)
                throw new Error('Switch touch modified wrong entry or did not persist');
            if (!document.querySelector('[data-worldbook-list-scroll]') || document.querySelector('button[title="删除 1 条"]'))
                throw new Error('Switch touch opened unrelated interface');
            edit.click();
            await waitFor(() => [...document.querySelectorAll('div')].find(el => el.textContent?.trim() === '编辑条目') as HTMLElement | undefined || null);
            const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '取消');
            if (!cancel) throw new Error('Edit cancel missing');
            cancel.click();
            await waitFor(() => document.querySelector('[data-worldbook-list-scroll]'));
            const freshDelete = document.querySelector<HTMLButtonElement>('[data-worldbook-entry-id] button[data-worldbook-action="delete"]');
            freshDelete?.click();
            await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '确认删除') || null);
            const afterDeletePrompt = await DB.getAllWorldbooks();
            if (afterDeletePrompt.length !== next.length)
                throw new Error('Delete touch bypassed confirmation');
            (window as any).worldbookActionIsolation = true;
            const modalCancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '取消');
            modalCancel?.click();
            await sleep(100);
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
    // Wait until 200ms CSS switch color/knob transitions finish before screenshot and color assertions.
    if (mode.startsWith('toggle')) await sleep(350);
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
    output.setAttribute('data-return-after-cancel', String((window as any).worldbookReturnCancel === true));
    output.setAttribute('data-return-after-save', String((window as any).worldbookReturnSave === true));
    output.setAttribute('data-category-move-return', String((window as any).worldbookCategoryMove === true));
    output.setAttribute('data-action-hit-zones', String((window as any).worldbookActionHitZones === true));
    output.setAttribute('data-action-isolation', String((window as any).worldbookActionIsolation === true));
    output.setAttribute('data-intro-present', String(heading.includes('世界书是做什么的')));
    output.setAttribute('data-many-page4', String(manyMode && heading.includes('4 / 6')));
    output.setAttribute('data-many-card-count', String(manyMode ? document.querySelectorAll('h4').length : 0));
    output.setAttribute('data-many-filter-count', String(manyMode ? [...document.querySelectorAll('div.group.relative.overflow-hidden')].filter(card => getComputedStyle(card).backdropFilter !== 'none').length : 0));
    output.setAttribute('data-many-content-present', String(manyMode && [...document.querySelectorAll('h4')].every(node => !!node.textContent?.trim() && node.textContent?.startsWith('压力条目'))));
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
    const liveOn = document.querySelector<HTMLButtonElement>('button[role="switch"][aria-checked="true"]');
    const liveOff = document.querySelector<HTMLButtonElement>('button[role="switch"][aria-checked="false"]');
    output.setAttribute('data-active-switch-color', liveOn ? getComputedStyle(liveOn).backgroundColor : '');
    output.setAttribute('data-inactive-switch-color', liveOff ? getComputedStyle(liveOff).backgroundColor : '');
    output.style.display = 'none';
    document.body.appendChild(output);
};
run().catch(error => {
    const output = document.createElement('output');
    output.setAttribute('data-worldbook-visual-error', String(error));
    document.body.appendChild(output);
});
