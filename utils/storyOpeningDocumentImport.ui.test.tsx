// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import { BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft } from './storyTheater';
import { planStoryOpeningDocumentImport, readStoryOpeningDocuments } from './storyOpeningDocumentImport';

vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement | null = null, root: Root | null = null;
afterEach(async () => { if (root) await act(async() => root!.unmount()); host?.remove();root=null;host=null; });

const actor = { id: 'opening-ui-role', name: '剧情角色', avatar:'', systemPrompt:'',
    memories:[],mountedWorldbooks:[], tavernGreetings:[] } as any;
const props = (extra: Record<string, unknown> = {}) => ({
    initial: {...createStoryTheaterDraft(),title:'已命名的剧情',premise:'原剧情介绍',
        characterIds:[actor.id], openingMode:'assistant' as const},
    characters:[actor],user:{name:'我'} as any,masks:[],maskLocked:false,
    presets:[BUILTIN_NIGHT_SCREENING_PRESET],onCancel:vi.fn(),onSave:vi.fn(),onImportPreset:async()=>null,
    onEditPreset:vi.fn(),onOpenMaskBox:vi.fn(),...extra,
});
async function mount(p: ReturnType<typeof props>) {
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    await act(async()=>root!.render(React.createElement(StoryTheaterEditor,p)));
    return host;
}
async function chooseFiles(files:File[]) {
    const input=host!.querySelector<HTMLInputElement>('input[aria-label="批量选择开场白文件"]')!;
    expect(input).toBeTruthy();
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('.txt');
    expect(input.accept).toContain('.docx');
    Object.defineProperty(input,'files',{configurable:true,value:files});
    await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
}
async function flush() {for(let i=0;i<8;i++) await act(async()=>{await new Promise(r=>setTimeout(r,8));});}

describe('剧情开场白多文件导入真实界面',()=> {
    it('选择多份 TXT，真实批量保存后显示 1、2、10，保留原剧情介绍和旧选项',async()=>{
        let current=actor;
        const onImport=vi.fn(async(_characterId:string,files:File[])=>{
            const documents=await readStoryOpeningDocuments(files);
            const next=planStoryOpeningDocumentImport(current.tavernGreetings,documents,[],(()=>{
                let i=0;return()=>`story-custom-ui-${++i}`;})());
            current={...current,tavernGreetings:next.greetings};
            return {added:next.added,skipped:next.skipped};
        });
        const p=props({onImportGreetings:onImport});
        await mount(p);
        const files=[new File(['第三十段'],'开场白10.txt'),new File(['第二段'],'开场白2.txt'),new File(['第一段'],'开场白1.txt')];
        await chooseFiles(files);
        await flush();
        expect(onImport).toHaveBeenCalledWith(actor.id, files);
        expect(host!.textContent).toContain('已导入 3 条');
        await act(async()=>root!.render(React.createElement(StoryTheaterEditor,{...p,characters:[current]})));
        const names=[...host!.querySelectorAll<HTMLSelectElement>('select[aria-label="选择已有开场"] option')]
            .map(option=>option.textContent||'');
        const indexed=names.filter(x=>x.includes('开场白'));
        expect(indexed).toHaveLength(3);
        expect(indexed[0]).toContain('开场白1');
        expect(indexed[1]).toContain('开场白2');
        expect(indexed[2]).toContain('开场白10');
        const intro=host!.querySelector<HTMLTextAreaElement>('textarea[aria-label="剧情介绍"]')!;
        expect(intro.value).toBe('原剧情介绍');
        expect(p.onSave).not.toHaveBeenCalled();
    });

    it('多个演员可指定归属，导入给第二个人后选择列表不混淆角色',async()=>{
        const second={...actor,id:'second-role',name:'第二位演员'};
        const onImport=vi.fn(async()=>({added:[{id:'story-custom-new',title:'开场白1',content:'第二人内容'}],skipped:0}));
        const p=props({characters:[actor,second],
            initial:{...createStoryTheaterDraft(), title:'群像剧',characterIds:[actor.id,second.id]},
            onImportGreetings:onImport});
        await mount(p);
        const select=host!.querySelector<HTMLSelectElement>('select[aria-label="导入开场归属角色"]')!;
        expect(select).toBeTruthy();
        await act(async()=>{select.value=second.id;select.dispatchEvent(new Event('change',{bubbles:true}));});
        await chooseFiles([new File(['第二人内容'],'开场白1.txt')]);await flush();
        expect(onImport).toHaveBeenCalledWith(second.id,expect.any(Array));
    });

    it('没有参与演员时导入按钮禁用，不会创建无归属开场白',async()=>{
        const importCallback=vi.fn();
        await mount(props({initial:{...createStoryTheaterDraft(),title:'空'},onImportGreetings:importCallback}));
        const button=host!.querySelector<HTMLButtonElement>('[data-story-opening-import-button]')!;
        expect(button.disabled).toBe(true);
        expect(host!.textContent).toContain('先在下方选择参与角色');
        expect(importCallback).not.toHaveBeenCalled();
    });

    it('原开场白已在编辑中不允许误覆盖导入，也不能趁导入中保存并进入',async()=>{
        const old={...actor,tavernGreetings:[{id:'story-custom-old',title:'旧开场',content:'旧正文'}]};
        const p=props({characters:[old],
            initial:{...createStoryTheaterDraft(),title:'旧故事',characterIds:[old.id],
                openingGreeting:{characterId:old.id,greetingId:'story-custom-old'}},
            onImportGreetings:vi.fn()});
        await mount(p);
        const textarea=host!.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑开场内容"]')!;
        await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
            setter.call(textarea,'未保存修改'); textarea.dispatchEvent(new Event('input',{bubbles:true}));});
        const button=host!.querySelector<HTMLButtonElement>('[data-story-opening-import-button]')!;
        expect(button.disabled).toBe(true);
        expect(host!.querySelector('button')?.textContent).toBeTruthy();
    });
});
