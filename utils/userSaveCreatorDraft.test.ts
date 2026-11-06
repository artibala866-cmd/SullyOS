import {expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import {createSaveStorage, userSaveStoragePrefix} from './userSaveScope';

const html=readFileSync('public/like520/character_creator.html','utf8');
function between(a:string,b:string){return html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));}
const production=between("let LIKE520_MODE =",'/* 合并自定义部件')+between('function getDraftKey()', '/* 把一份导出过的完整 state')+between('function tryLoadDraft()', '/* 把所有会改 state');
function editor(storage:Storage){
 const ctx=createContext({localStorage:storage,IS_EMBEDDED:true,document:{querySelector:()=>null,documentElement:{style:{setProperty(){}}}},
   mergeExtraItems(){},applyFullState(d:any){ctx.state=d;return true;},state:{selected:{eyes:'eyes_01'}},PARTS:[],toast(){},console,
   setTimeout:(f:()=>void)=>{f();return 1;},clearTimeout(){}});
 runInContext(production,ctx);return {ctx,call:(code:string)=>runInContext(code,ctx),init:(prefix:string,key='stable-user')=>{ctx.init={mode:'user',charName:'同名身份',draftKey:key,saveStoragePrefix:prefix};runInContext('applyLike520Init(init)',ctx);}};
}
it('real embedded creator drafts never write before init and isolate same owner/name across identities',()=>{
 localStorage.clear();const a=editor(localStorage),b=editor(localStorage);const id='11111111-1111-4111-8111-111111111111';
 a.call('saveDraft()');expect(localStorage.length).toBe(0);
 a.init('');a.call("state.selected.eyes='eyes_02';saveDraft()");
 b.init(userSaveStoragePrefix(id));expect(b.ctx.state.selected.eyes).toBe('eyes_01');
 b.call("state.selected.eyes='eyes_03';saveDraft()");
 expect(JSON.parse(localStorage.getItem('like520_cc_draft_k_stable-user')!).selected.eyes).toBe('eyes_02');
 const facade=createSaveStorage(localStorage,id);expect(JSON.parse(facade.getItem('like520_cc_draft_k_stable-user')!).selected.eyes).toBe('eyes_03');
 const resumedA=editor(localStorage),resumedB=editor(localStorage);resumedA.init('');resumedB.init(userSaveStoragePrefix(id));
 expect(resumedA.ctx.state.selected.eyes).toBe('eyes_02');expect(resumedB.ctx.state.selected.eyes).toBe('eyes_03');
 resumedB.call('clearDraft()');expect(facade.getItem('like520_cc_draft_k_stable-user')).toBeNull();expect(localStorage.getItem('like520_cc_draft_k_stable-user')).not.toBeNull();
});
it('fallback draft keys and delayed old editors remain pinned; invalid namespaces never initialize',()=>{
 localStorage.clear();const id='22222222-2222-4222-8222-222222222222',b=editor(localStorage);b.init(userSaveStoragePrefix(id),'');
 const key=b.call('getDraftKey()');expect(key).toBe(userSaveStoragePrefix(id)+'like520_cc_draft_user_同名身份');
 b.init('');expect(b.call('getDraftKey()')).toBe(key);
 const invalid=editor(localStorage);invalid.init('bad-prefix');invalid.call('saveDraft()');expect(localStorage.length).toBe(0);
});

it('uninitialized preview frames cannot read or clear the original fallback draft',()=>{
 localStorage.clear();const key='like520_cc_draft_char_default';localStorage.setItem(key,JSON.stringify({selected:{eyes:'eyes_02'}}));
 const preview=editor(localStorage);expect(preview.call('tryLoadDraft()')).toBe(false);preview.call('clearDraft()');
 expect(JSON.parse(localStorage.getItem(key)!).selected.eyes).toBe('eyes_02');expect(preview.ctx.state.selected.eyes).toBe('eyes_01');
});
