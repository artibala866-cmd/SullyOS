import React from 'react';
import { createRoot } from 'react-dom/client';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import { STORY_THEME_CSS } from '../components/date/story/StoryTheaterTheme';
import { BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft } from '../utils/storyTheater';
import type { ApiPreset, StoryTheaterEntry } from '../types';

const css = document.createElement('style');
css.textContent = STORY_THEME_CSS; document.head.append(css);
const role = { id: 'role', name: '林屿', avatar: '', systemPrompt: '安静', worldview: '', memories: [] } as any;
const initial = { ...createStoryTheaterDraft(1), title: '雨夜 · 剧情记忆', premise: '你与林屿在雨夜相遇', characterIds: [role.id] };
const library: ApiPreset[] = [
    { id: 'cheap', name: '低成本总结', group: '记忆', config: { baseUrl: 'https://cheap.invalid/v1', apiKey: 'visual-fake-key', model: 'gemini-economy' } },
    { id: 'backup', name: '备用', group: '日常', config: { baseUrl: 'https://backup.invalid/v1', apiKey: 'visual-backup', model: 'gpt-mini' } },
];
let saved: StoryTheaterEntry | null = null;
const fixtureScenario = new URLSearchParams(location.search).get('scenario') || 'preset';
const restoredLibrary = fixtureScenario === 'broken-import'
    ? [null, { id: 'damaged', name: '损坏的旧预设', config: null }, ...library] as unknown as ApiPreset[]
    : library;
function App() {
    return <div className='story-theme story-theme-light story-decor-plain h-full w-full'>
        <StoryTheaterEditor initial={initial} characters={[role]} worldbooks={[]} user={{ name: '用户' } as any}
            masks={[]} maskLocked={false} presets={[BUILTIN_NIGHT_SCREENING_PRESET]}
            apiPresets={restoredLibrary}
            mainApi={fixtureScenario === 'overlap' ? {
                baseUrl: 'https://cheap.invalid/v1', apiKey: 'fake-expensive-key', model: 'expensive-prose-model',
            } : { baseUrl: 'https://expensive.invalid/v1', apiKey: 'fake-expensive-key', model: 'expensive-prose-model' }}
            onCancel={() => {}} onSave={entry => { saved = entry; }}
            onImportPreset={async () => null} onEditPreset={() => {}} onOpenMaskBox={() => {}} />
    </div>;
}
createRoot(document.getElementById('visual')!).render(<App/>);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) {
    for (let i = 0; i < 110; i++) { if (check()) return; await sleep(25); }
    throw new Error('story memory API UI did not reach expected state');
}
function type(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function run() {
    const scenario = new URLSearchParams(location.search).get('scenario') || 'preset';
    await until(() => !!document.querySelector('[data-story-memory-api-settings]'));
    const area = document.querySelector<HTMLElement>('[data-story-memory-api-settings]')!;
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="使用剧情记忆副 API"]')!;
    if (scenario !== 'off') {
        toggle.click();
        await until(() => !!document.querySelector<HTMLInputElement>('input[aria-label="剧情记忆副 API 模型"]'));
        if (scenario !== 'empty') {
            const selector = document.querySelector<HTMLSelectElement>('select[aria-label="选择剧情记忆 API 预设"]')!;
            selector.value = 'cheap';
            selector.dispatchEvent(new Event('change', { bubbles: true }));
            await until(() => document.querySelector<HTMLInputElement>('input[aria-label="剧情记忆副 API 模型"]')?.value === 'gemini-economy');
        }
    }
    const model = document.querySelector<HTMLInputElement>('input[aria-label="剧情记忆副 API 模型"]');
    const url = document.querySelector<HTMLInputElement>('input[aria-label="剧情记忆副 API URL"]');
    const key = document.querySelector<HTMLInputElement>('input[aria-label="剧情记忆副 API Key"]');
    let passed = true;
    if (['preset', 'narrow', 'manual', 'save', 'overlap', 'broken-import'].includes(scenario)) {
        passed = model?.value === 'gemini-economy'
            && url?.value === 'https://cheap.invalid/v1' && key?.value === 'visual-fake-key';
    }
    if (scenario === 'manual' && model && url) {
        type(url, 'https://manual.invalid/v1');
        type(model, 'manual-economy');
        await until(() => document.querySelector<HTMLInputElement>('input[aria-label="剧情记忆副 API 模型"]')?.value === 'manual-economy');
        passed = passed && url.value === 'https://manual.invalid/v1';
    }
    if (scenario === 'invalid' && url) {
        type(url, 'file:///not-a-provider');
        await until(() => url.value === 'file:///not-a-provider');
        document.querySelector<HTMLButtonElement>('.story-setup-save')?.click();
        await until(() => document.body.textContent?.includes('剧情记忆副 API 仅支持') ?? false);
        passed = !saved;
    }
    if (scenario === 'save') {
        document.querySelector<HTMLButtonElement>('.story-setup-save')?.click();
        await until(() => saved !== null);
        passed = passed && saved!.memorySummaryApi?.baseUrl === 'https://cheap.invalid/v1'
            && saved!.memorySummaryApi?.model === 'gemini-economy'
            && JSON.stringify(saved!.memorySummaryApi) === JSON.stringify({
                baseUrl: 'https://cheap.invalid/v1', apiKey: 'visual-fake-key', model: 'gemini-economy',
            });
    }
    if (scenario === 'off') passed = !model;
    if (scenario === 'overlap') {
        await until(() => !!document.querySelector('[data-story-memory-gateway-warning]'));
        passed = passed && !!document.querySelector('[data-story-memory-gateway-warning]')?.textContent?.includes('限流');
    }
    if (scenario === 'broken-import') {
        passed = passed && document.querySelectorAll('select[aria-label="选择剧情记忆 API 预设"] option').length === 3;
    }
    if (scenario === 'preset') {
        passed = passed && !document.querySelector('[data-story-memory-gateway-warning]');
    }
    const rect = area.getBoundingClientRect();
    const noOverflow = document.documentElement.scrollWidth <= window.innerWidth + 1;
    area.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(190);
    const report = { scenario, passed, noOverflow, visible: !!rect, saved: !!saved };
    const node = document.createElement('output'); node.id = 'story-memory-api-report';
    node.hidden = true; node.textContent = JSON.stringify(report); document.body.append(node);
    document.body.dataset.storyMemoryApiReady = String(passed && noOverflow && !!rect);
}
void run().catch(error => {
    document.body.dataset.storyMemoryApiReady = 'false';
    document.body.dataset.storyMemoryApiError = String(error?.stack || error).slice(0, 1500);
});
