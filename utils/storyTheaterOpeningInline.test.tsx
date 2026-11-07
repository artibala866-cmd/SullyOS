// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import { BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft } from './storyTheater';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../components/os/TokenImg', () => ({ default: () => null }));

const opening = { id: 'opening-1', title: '雨夜', content: '旧的开场正文' };
const actor = {
    id: 'actor-1', name: '测试角色', avatar: '', systemPrompt: '',
    memories: [], mountedWorldbooks: [], tavernGreetings: [opening],
} as any;
let host: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    host?.remove();
    host = null;
    root = null;
});

const field = () => host!.querySelector<HTMLTextAreaElement>('main section textarea')!;
const button = (name: string) => {
    const found = [...host!.querySelectorAll('button')].find(b => b.textContent?.trim() === name);
    expect(found, `Missing button: ${name}`).toBeTruthy();
    return found!;
};
const typeInto = async (el: HTMLTextAreaElement, value: string) => {
    await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const click = async (name: string) => {
    await act(async () => { button(name).click(); });
};

describe('剧情开场白复用上方剧情介绍输入框', () => {
    it('开场白直接在原大框展示，介绍/开场分开存，修改取消保存及删除不串内容', async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const onChangeGreeting = vi.fn(async (_characterId: string, _greetingId: string, _body: string | null) => {});
        const onSave = vi.fn();
        const initial = {
            ...createStoryTheaterDraft(), title: '雨夜故事', premise: '保留的剧情介绍',
            characterIds: [actor.id], openingMode: 'assistant' as const,
            openingGreeting: { characterId: actor.id, greetingId: opening.id },
        };
        const props = {
            initial, characters: [actor], user: { name: '用户' } as any,
            masks: [], maskLocked: false, presets: [BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel: vi.fn(), onSave, onImportPreset: async () => null,
            onEditPreset: vi.fn(), onOpenMaskBox: vi.fn(), onChangeGreeting,
        };
        await act(async () => { root!.render(React.createElement(StoryTheaterEditor, props)); });

        expect(field().getAttribute('data-story-opening-editor')).toBe('true');
        expect(field().value).toBe(opening.content);
        expect(host!.querySelector('[data-story-opening-settings] textarea')).toBeNull();
        expect(host!.querySelector('[data-story-opening-settings]')!.textContent).not.toContain(opening.content);

        await click('剧情介绍');
        expect(field().value).toBe('保留的剧情介绍');
        await typeInto(field(), '重新写的介绍');
        await click('开场白');
        expect(field().value).toBe(opening.content);
        expect(onChangeGreeting).not.toHaveBeenCalled();

        await typeInto(field(), '草稿不应保存');
        expect(button('保存修改')).toBeTruthy();
        await click('取消');
        expect(field().value).toBe(opening.content);
        expect(onChangeGreeting).not.toHaveBeenCalled();

        await typeInto(field(), '真正保存的开场');
        expect((host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement).disabled).toBe(true);
        await click('保存修改');
        expect(onChangeGreeting).toHaveBeenCalledWith(actor.id, opening.id, '真正保存的开场');
        // The UI must not jump back to stale text while the parent character refresh is pending.
        expect(field().value).toBe('真正保存的开场');
        expect(onSave).not.toHaveBeenCalled();

        const changedActor = { ...actor, tavernGreetings: [{ ...opening, content: '真正保存的开场' }] };
        await act(async () => { root!.render(React.createElement(StoryTheaterEditor, { ...props, characters: [changedActor] })); });
        expect(field().value).toBe('真正保存的开场');
        await click('剧情介绍');
        expect(field().value).toBe('重新写的介绍');
        await click('开场白');
        await click('删除');
        expect(host!.textContent).toContain('从角色的开场库删除？');
        await click('确认删除');
        expect(onChangeGreeting).toHaveBeenLastCalledWith(actor.id, opening.id, null);
        expect(field().getAttribute('data-story-opening-editor')).toBeNull();
        expect(field().value).toBe('重新写的介绍');
    });

    it('已经导入过的酒馆注释开场自动适配标题简介，编辑框和保存正文不带 HTML 元数据', async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const oldBody = '<!-- title: 开场白6 -->\\n<!-- desc: 车站雨夜，时隔一年重逢。 -->\\n\\n{{char}}推开门。';
        const storedActor = {
            ...actor, tavernGreetings: [{ id: 'legacy-six', title: '备选开场白 6', content: oldBody }],
        };
        const saveGreeting = vi.fn(async (_actor: string, _id: string, _content: string | null) => {});
        const initial = {
            ...createStoryTheaterDraft(), title: '雨夜重逢', premise: '另一段剧情介绍',
            characterIds: [storedActor.id], openingMode: 'assistant' as const,
            openingGreeting: { characterId: storedActor.id, greetingId: 'legacy-six' },
        };
        const props = {
            initial, characters: [storedActor], user: { name: '用户' } as any,
            masks: [], maskLocked: false, presets: [BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel: vi.fn(), onSave: vi.fn(), onImportPreset: async () => null,
            onEditPreset: vi.fn(), onOpenMaskBox: vi.fn(), onChangeGreeting: saveGreeting,
        };
        await act(async () => { root!.render(React.createElement(StoryTheaterEditor, props)); });
        expect(field().value).toBe('{{char}}推开门。');
        const selector = host!.querySelector('select[aria-label="选择已有开场"]')!;
        expect(selector.textContent).toContain('开场白6');
        expect(selector.textContent).toContain('车站雨夜，时隔一年重逢');
        expect(field().value).not.toContain('<!--');
        await typeInto(field(), '{{char}}把伞递给你。');
        await click('保存修改');
        expect(saveGreeting).toHaveBeenCalledWith(storedActor.id, 'legacy-six', '{{char}}把伞递给你。');
    });

    it('手写内容点书签保存后自动出现在已有开场，同一段不重复进入剧情介绍', async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const create = vi.fn(async (_actorId: string, _title: string, content: string) => ({
            id: 'custom-1', title: '自拟开场', content,
        }));
        const onSave = vi.fn(async (_entry: any) => {});
        const props = {
            initial: { ...createStoryTheaterDraft(), title: '自拟剧情', characterIds: [actor.id] },
            characters: [{ ...actor, tavernGreetings: [] }], user: { name: '用户' } as any,
            masks: [], maskLocked: false, presets: [BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel: vi.fn(), onSave, onImportPreset: async () => null,
            onEditPreset: vi.fn(), onOpenMaskBox: vi.fn(), onCreateGreeting: create,
        };
        await act(async () => root!.render(React.createElement(StoryTheaterEditor, props)));
        expect(host!.querySelector('select[aria-label="选择已有开场"]')!.textContent).toContain('暂无可选开场');
        await typeInto(field(), '<!-- title:起点 -->\n清晨，门外有人敲门。');
        expect((host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).disabled).toBe(false);
        await act(async () => (host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).click());
        expect(create).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith(actor.id, '起点', '<!-- title:起点 -->\n清晨，门外有人敲门。');
        expect((host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement).value).toBe(`${actor.id}::custom-1`);
        expect(field().value).toContain('清晨，门外有人敲门。');
        expect(host!.querySelector('[data-story-opening-settings] textarea')).toBeNull();
        await click('剧情介绍');
        expect(field().value).toBe('');
        await click('开场白');
        await click('保存并进入');
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0]?.[0].premise).toBe('');
        expect(onSave.mock.calls[0]?.[0].openingGreeting).toEqual({ characterId: actor.id, greetingId: 'custom-1' });
    });

    it('多个角色用紧凑归属选择，取消不写入，选择后只保存给目标角色', async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const otherActor = { ...actor, id: 'actor-2', name: '另一角色', tavernGreetings: [] };
        const create = vi.fn(async (_actorId: string, _title: string, content: string) => ({ id: 'custom-2', title: '开场二', content }));
        const props = {
            initial: { ...createStoryTheaterDraft(), characterIds: [actor.id, otherActor.id] },
            characters: [{ ...actor, tavernGreetings: [] }, otherActor],
            user: { name: '用户' } as any, masks: [], maskLocked: false,
            presets: [BUILTIN_NIGHT_SCREENING_PRESET], onCancel: vi.fn(), onSave: vi.fn(),
            onImportPreset: async () => null, onEditPreset: vi.fn(), onOpenMaskBox: vi.fn(), onCreateGreeting: create,
        };
        await act(async () => root!.render(React.createElement(StoryTheaterEditor, props)));
        await typeInto(field(), '为角色二保存的开场');
        await act(async () => (host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).click());
        expect(host!.querySelector('[data-story-opening-target]')).toBeTruthy();
        expect(create).not.toHaveBeenCalled();
        await act(async () => (host!.querySelector<HTMLButtonElement>('button[aria-label="取消收藏开场"]')!).click());
        expect(host!.querySelector('[data-story-opening-target]')).toBeNull();
        expect(field().value).toBe('为角色二保存的开场');
        await act(async () => (host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).click());
        const target = host!.querySelector<HTMLSelectElement>('select[aria-label="开场归属角色"]')!;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
            setter.call(target, otherActor.id);
            target.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => (host!.querySelector<HTMLButtonElement>('button[aria-label="确认收藏开场"]')!).click());
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[0]).toBe(otherActor.id);
        expect((host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement).value).toBe('actor-2::custom-2');
    });

    it('写入失败时不清空草稿也不假装已保存', async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const create = vi.fn(async () => { throw new Error('空间不足'); });
        const props = {
            initial: { ...createStoryTheaterDraft(), characterIds: [actor.id] },
            characters: [{ ...actor, tavernGreetings: [] }], user: { name: '用户' } as any,
            masks: [], maskLocked: false, presets: [BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel: vi.fn(), onSave: vi.fn(), onImportPreset: async () => null,
            onEditPreset: vi.fn(), onOpenMaskBox: vi.fn(), onCreateGreeting: create,
        };
        await act(async () => root!.render(React.createElement(StoryTheaterEditor, props)));
        await typeInto(field(), '失败时必须保留的文字');
        await act(async () => (host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).click());
        expect(host!.querySelector('[role="alert"]')?.textContent).toContain('空间不足');
        expect(field().value).toBe('失败时必须保留的文字');
        expect((host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement).value).toBe('');
    });
    it('收藏后改回我先写，正文恢复到介绍栏，收藏仍留在已有开场', async () => {
        host=document.createElement('div');document.body.append(host);root=createRoot(host);
        const create=vi.fn(async (_id:string,_title:string,content:string)=>({id:'recover-one',title:'恢复用开场',content}));
        await act(async()=>root!.render(React.createElement(StoryTheaterEditor,{
            initial:{...createStoryTheaterDraft(),title:'恢复检查',characterIds:[actor.id]},
            characters:[{...actor,tavernGreetings:[]}],user:{name:'用户'} as any,
            masks:[],maskLocked:false,presets:[BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel:vi.fn(),onSave:vi.fn(),onImportPreset:async()=>null,onEditPreset:vi.fn(),onOpenMaskBox:vi.fn(),onCreateGreeting:create,
        })));
        await typeInto(field(),'刚写下来的重要正文');
        await act(async()=>host!.querySelector<HTMLButtonElement>('[data-story-opening-save]')!.click());
        await click('我先写');
        expect(field().value).toBe('刚写下来的重要正文');
        expect(field().getAttribute('data-story-opening-editor')).toBeNull();
        expect(host!.querySelector('select[aria-label="选择已有开场"]')?.textContent).toContain('恢复用开场');
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('删除刚收藏的开场仍保留原稿；多人更换参与者关闭过期的归属选择', async () => {
        host=document.createElement('div');document.body.append(host);root=createRoot(host);
        const other={...actor,id:'second-actor',name:'第二角色',tavernGreetings:[]};
        const create=vi.fn(async (_id:string,_title:string,content:string)=>({id:'recover-delete',title:'用户开场',content}));
        const change=vi.fn(async (_id:string,_g:string,_c:string|null)=>{});
        const props={initial:{...createStoryTheaterDraft(),characterIds:[actor.id,other.id]},
            characters:[{...actor,tavernGreetings:[]},other],user:{name:'用户'} as any,
            masks:[],maskLocked:false,presets:[BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel:vi.fn(),onSave:vi.fn(),onImportPreset:async()=>null,onEditPreset:vi.fn(),onOpenMaskBox:vi.fn(),
            onCreateGreeting:create,onChangeGreeting:change};
        await act(async()=>root!.render(React.createElement(StoryTheaterEditor,props)));
        await typeInto(field(),'多人写的正文');
        await act(async()=>host!.querySelector<HTMLButtonElement>('[data-story-opening-save]')!.click());
        expect(host!.querySelector('[data-story-opening-target]')).not.toBeNull();
        await act(async()=>host!.querySelector<HTMLButtonElement>('button[aria-label="第二角色"]')!.click());
        expect(host!.querySelector('[data-story-opening-target]')).toBeNull();
        await act(async()=>host!.querySelector<HTMLButtonElement>('[data-story-opening-save]')!.click());
        expect(create).toHaveBeenCalledTimes(1);
        await click('删除');
        await click('确认删除');
        expect(change).toHaveBeenCalledWith(actor.id,'recover-delete',null);
        expect(field().value).toBe('多人写的正文');
        expect(field().getAttribute('data-story-opening-editor')).toBeNull();
    });

    it('多行 desc 元数据不会混入自定义开场的标题', async () => {
        host=document.createElement('div');document.body.append(host);root=createRoot(host);
        const create=vi.fn(async(_id:string,_title:string,content:string)=>({id:'metadata-test',title:'正常标题',content}));
        await act(async()=>root!.render(React.createElement(StoryTheaterEditor,{
            initial:{...createStoryTheaterDraft(),characterIds:[actor.id]},
            characters:[{...actor,tavernGreetings:[]}],user:{name:'用户'} as any,
            masks:[],maskLocked:false,presets:[BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel:vi.fn(),onSave:vi.fn(),onImportPreset:async()=>null,onEditPreset:vi.fn(),onOpenMaskBox:vi.fn(),onCreateGreeting:create,
        })));
        await typeInto(field(),'<!-- desc:\n一段很长的故事背景。\n-->\n雨后初见的那天。');
        await act(async()=>host!.querySelector<HTMLButtonElement>('[data-story-opening-save]')!.click());
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][1]).toBe('雨后初见的那天。');
        expect(create.mock.calls[0][2]).toContain('<!-- desc:');
    });

    it('新剧情选择酒馆注释标题后自动填入剧情名称，切换和清空同步，保存仍读取选中正文', async () => {
        host = document.createElement('div'); document.body.append(host); root = createRoot(host);
        const intro = '<!-- title: 开场白21 -->\n<!-- desc: 另一条世界线 -->\n\n这是第一幕正文。';
        const role = { ...actor, tavernGreetings: [
            {id:'meta-21',title:'默认开场',content:intro},
            {id:'meta-22',title:'第二幕',content:'另一条正文'},
        ] };
        const onSave = vi.fn(async (_entry:any) => {});
        await act(async () => root!.render(React.createElement(StoryTheaterEditor,{
            initial:{...createStoryTheaterDraft(),characterIds:[role.id]},
            characters:[role],user:{name:'用户'} as any,masks:[],maskLocked:false,
            presets:[BUILTIN_NIGHT_SCREENING_PRESET],onCancel:vi.fn(),onSave,
            onImportPreset:async()=>null,onEditPreset:vi.fn(),onOpenMaskBox:vi.fn(),
        })));
        const title = host!.querySelector<HTMLInputElement>('input[placeholder="剧情名称"]')!;
        const selector = host!.querySelector<HTMLSelectElement>('select[aria-label="选择已有开场"]')!;
        expect(title.value).toBe('');
        const selectOpening = async (value: string) => act(async () => {
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(selector,value);
            selector.dispatchEvent(new Event('change',{bubbles:true}));
        });
        await selectOpening(`${actor.id}::meta-21`);
        expect(title.value).toBe('开场白21');
        expect(field().value).toBe('这是第一幕正文。');
        await selectOpening(`${actor.id}::meta-22`);
        expect(title.value).toBe('第二幕');
        await selectOpening('');
        expect(title.value).toBe('');
        await selectOpening(`${actor.id}::meta-21`);
        await click('保存并进入');
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0][0].title).toBe('开场白21');
        expect(onSave.mock.calls[0][0].openingGreeting).toEqual({characterId: actor.id,greetingId:'meta-21'});
    });

    it('手工命名的剧情与编辑已有剧情都不会被开场选择覆盖', async () => {
        host=document.createElement('div');document.body.append(host);root=createRoot(host);
        const role={...actor,tavernGreetings:[opening,{id:'other',title:'另一个开场',content:'第二段'}]};
        const onSave=vi.fn();
        const props={initial:{...createStoryTheaterDraft(),title:'用户自己写的剧情',characterIds:[role.id]},
            characters:[role],user:{name:'用户'} as any,masks:[],maskLocked:false,
            presets:[BUILTIN_NIGHT_SCREENING_PRESET],onCancel:vi.fn(),onSave,
            onImportPreset:async()=>null,onEditPreset:vi.fn(),onOpenMaskBox:vi.fn()};
        await act(async()=>root!.render(React.createElement(StoryTheaterEditor,props)));
        const title=host!.querySelector<HTMLInputElement>('input[placeholder="剧情名称"]')!;
        const selector=host!.querySelector<HTMLSelectElement>('select[aria-label="选择已有开场"]')!;
        const select = async(value:string)=>act(async()=>{
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(selector,value);
            selector.dispatchEvent(new Event('change',{bubbles:true}));
        });
        await select(`${actor.id}::opening-1`);
        expect(title.value).toBe('用户自己写的剧情');
        await select(`${actor.id}::other`);
        expect(title.value).toBe('用户自己写的剧情');
        await select('');
        expect(title.value).toBe('用户自己写的剧情');
        await click('保存并进入');
        expect(onSave.mock.calls[0][0].title).toBe('用户自己写的剧情');
    });

    it('自动命名之后只要用户自己修改过标题，之后的开场切换不再覆盖', async () => {
        host=document.createElement('div');document.body.append(host);root=createRoot(host);
        const role={...actor,tavernGreetings:[opening,{id:'other',title:'新开场标题',content:'第二段'}]};
        await act(async()=>root!.render(React.createElement(StoryTheaterEditor,{
            initial:{...createStoryTheaterDraft(),characterIds:[actor.id]},
            characters:[role],user:{name:'用户'} as any,masks:[],maskLocked:false,
            presets:[BUILTIN_NIGHT_SCREENING_PRESET],onCancel:vi.fn(),onSave:vi.fn(),
            onImportPreset:async()=>null,onEditPreset:vi.fn(),onOpenMaskBox:vi.fn(),
        })));
        const title=host!.querySelector<HTMLInputElement>('input[placeholder="剧情名称"]')!;
        const select=host!.querySelector<HTMLSelectElement>('select[aria-label="选择已有开场"]')!;
        const change=async(value:string)=>act(async()=>{
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,value);
            select.dispatchEvent(new Event('change',{bubbles:true}));
        });
        await change(`${actor.id}::opening-1`);
        expect(title.value).toBe('雨夜');
        await act(async()=>{
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(title,'雨夜 · 我的版本');
            title.dispatchEvent(new Event('input',{bubbles:true}));
        });
        await change(`${actor.id}::other`);
        expect(title.value).toBe('雨夜 · 我的版本');
        await click('我先写');
        expect(title.value).toBe('雨夜 · 我的版本');
    });

    it('无标题时 Link 选项使用原生标题，保留 Link 正文注释', async () => {
        host=document.createElement('div');document.body.append(host);root=createRoot(host);
        const linkBody='<!-- title: Link 剧情正文，不是元数据 -->\n角色在站台等候。';
        const role={...actor,tavernGreetings:[],linkGreetings:[
            {id:'link-first',title:'Link 第一幕',content:linkBody},
        ]};
        await act(async()=>root!.render(React.createElement(StoryTheaterEditor,{
            initial:{...createStoryTheaterDraft(),characterIds:[actor.id]},characters:[role],
            user:{name:'用户'} as any,masks:[],maskLocked:false,presets:[BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel:vi.fn(),onSave:vi.fn(),onImportPreset:async()=>null,onEditPreset:vi.fn(),onOpenMaskBox:vi.fn(),
        })));
        const selector=host!.querySelector<HTMLSelectElement>('select[aria-label="选择已有开场"]')!;
        await act(async()=>{
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(selector,`${actor.id}::link-first`);
            selector.dispatchEvent(new Event('change',{bubbles:true}));
        });
        expect(host!.querySelector<HTMLInputElement>('input[placeholder="剧情名称"]')?.value).toBe('Link 第一幕');
        expect(field().value).toBe(linkBody);
    });

    it('收藏自写开场时空白标题自动使用收藏标题，手动模式和删除则撤销自动标题', async () => {
        host=document.createElement('div');document.body.append(host);root=createRoot(host);
        const create=vi.fn(async (_id:string,_title:string,content:string)=>({id:'custom-title',title:'自定义收藏标题',content}));
        const remove=vi.fn(async (_id:string,_g:string,_content:string|null)=>{});
        const props={initial:{...createStoryTheaterDraft(),characterIds:[actor.id]},
            characters:[{...actor,tavernGreetings:[]}],user:{name:'用户'} as any,
            masks:[],maskLocked:false,presets:[BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel:vi.fn(),onSave:vi.fn(),onImportPreset:async()=>null,onEditPreset:vi.fn(),onOpenMaskBox:vi.fn(),
            onCreateGreeting:create,onChangeGreeting:remove};
        await act(async()=>root!.render(React.createElement(StoryTheaterEditor,props)));
        const title=host!.querySelector<HTMLInputElement>('input[placeholder="剧情名称"]')!;
        await typeInto(field(),'原创剧情正文');
        await act(async()=>host!.querySelector<HTMLButtonElement>('[data-story-opening-save]')!.click());
        expect(title.value).toBe('自定义收藏标题');
        await click('我先写');
        expect(title.value).toBe('');
        await act(async()=>{
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(
                host!.querySelector<HTMLSelectElement>('select[aria-label="选择已有开场"]')!,`${actor.id}::custom-title`);
            host!.querySelector<HTMLSelectElement>('select[aria-label="选择已有开场"]')!.dispatchEvent(new Event('change',{bubbles:true}));
        });
        expect(title.value).toBe('自定义收藏标题');
        await click('删除');
        await click('确认删除');
        expect(title.value).toBe('');
    });

    it('酒馆修改标题注释后能更新临时显示及自动生成的剧情标题，不影响手写标题', async () => {
        host=document.createElement('div');document.body.append(host);root=createRoot(host);
        const change=vi.fn(async (_id:string,_g:string,_body:string|null)=>{});
        const role={...actor,tavernGreetings:[opening]};
        await act(async()=>root!.render(React.createElement(StoryTheaterEditor,{
            initial:{...createStoryTheaterDraft(),characterIds:[actor.id]},characters:[role],
            user:{name:'用户'} as any,masks:[],maskLocked:false,presets:[BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel:vi.fn(),onSave:vi.fn(),onImportPreset:async()=>null,onEditPreset:vi.fn(),onOpenMaskBox:vi.fn(),onChangeGreeting:change,
        })));
        const select=host!.querySelector<HTMLSelectElement>('select[aria-label="选择已有开场"]')!;
        await act(async()=>{
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,`${actor.id}::opening-1`);
            select.dispatchEvent(new Event('change',{bubbles:true}));
        });
        const title=host!.querySelector<HTMLInputElement>('input[placeholder="剧情名称"]')!;
        expect(title.value).toBe('雨夜');
        await typeInto(field(),'<!-- title: 新的开场标题 -->\n新的正文。');
        await click('保存修改');
        expect(change).toHaveBeenCalledWith(actor.id,'opening-1','<!-- title: 新的开场标题 -->\n新的正文。');
        expect(field().value).toBe('新的正文。');
        expect(title.value).toBe('新的开场标题');
        await click('我先写');
        expect(title.value).toBe('');
    });

});
