import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.USER_SAVE_PLAYWRIGHT || 'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.USER_SAVE_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const out=process.env.USER_SAVE_SHOTS||'/tmp/user-save-shots';await mkdir(out,{recursive:true});
const origin=process.env.USER_SAVE_BASE||'http://127.0.0.1:5192';
for(let i=0;i<100;i++){try{await fetch(origin);break;}catch(e){if(i===99)throw e;await new Promise(r=>setTimeout(r,300));}}
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{localStorage.setItem('sullyos_disclaimer_accepted','1');localStorage.setItem('os_first_use_memory_guide_v1','done');});
const inspect=()=>page.evaluate(async()=>{
 const {openDB}=await import('/utils/db.ts'),{USER_SAVE_ID,readUserSaves}=await import('/utils/userSaveScope.ts');const db=await openDB();
 const rows=name=>new Promise((resolve,reject)=>{const req=db.transaction(name).objectStore(name).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 return {id:USER_SAVE_ID,registry:readUserSaves(),profile:(await rows('user_profile'))[0],messages:await rows('messages'),chars:await rows('characters'),books:await rows('worldbooks'),hwm:localStorage.getItem('palace_hwm_qa-save-char')};
});
const ready=()=>page.getByLabel('你的名字',{exact:true}).waitFor();
async function switchTo(id){await Promise.all([page.waitForEvent('framenavigated'),page.getByLabel('切换身份',{exact:true}).selectOption(id)]);await ready();assert.equal((await inspect()).id,id);}
async function shot(name){if(!name.endsWith('844') && !name.startsWith('backup')) await page.getByTestId('archive-scroll').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(400);await page.screenshot({path:out+'/'+name+'.png'});}
try{
 await page.goto(origin+'/test/fixtures/user-saves.html',{timeout:60000});await ready();
 assert.equal(await page.getByRole('button',{name:'删除当前身份',exact:true}).isEnabled(),false);
 await page.getByLabel('你的名字',{exact:true}).fill('原来的名字');
 await page.getByLabel('关于我 / 设定',{exact:true}).fill('原身份的独立设定');
 await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();
 const shape=await page.evaluate(()=>{const input=document.querySelector('#archive-user-name'),picker=document.querySelector('#user-save-select');return {sameField:input.parentElement===picker.parentElement,extraText:document.body.innerText.includes('重命名')||document.body.innerText.includes('切换后继续对应故事')};});
 assert(shape.sameField);assert(!shape.extraText);assert.equal(await page.getByRole('button',{name:'切换身份',exact:true}).count(),0);
 await shot('name-picker-390');
 await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'新建身份',exact:true}).click()]);await ready();
 const fresh=await inspect();assert.notEqual(fresh.id,'original');assert.equal(fresh.profile.name,'新身份');assert.equal(fresh.profile.bio,'');assert.equal(fresh.messages.length,0);assert.equal(fresh.hwm,null);assert(fresh.books.some(w=>w.id==='qa-save-world'));assert.deepEqual(fresh.chars.find(c=>c.id==='qa-save-char').memories,[]);
 // Actually edit all three existing profile controls in the new identity.
 await page.getByLabel('你的名字',{exact:true}).fill('校园线名字');
 await page.getByLabel('关于我 / 设定',{exact:true}).fill('校园线自己的身份设定，不能写回原身份。');
 const beforeAvatar=fresh.profile.avatar;
 await page.getByLabel('更换档案头像',{exact:true}).setInputFiles({name:'identity-avatar.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGPcFRDEQApgIkn1qIZRDUNKAwBbvAF8a7jX/wAAAABJRU5ErkJggg==','base64')});
 await page.waitForFunction(async old=>{const {DB}=await import('/utils/db.ts');const p=await DB.getUserProfile();return p?.avatar!==old&&p?.avatar?.startsWith('blobref:');},beforeAvatar);
 await page.evaluate(async()=>{const {DB}=await import('/utils/db.ts');await DB.saveMessage({charId:'qa-save-char',role:'user',type:'text',content:'校园线独有的聊天'});localStorage.setItem('palace_hwm_qa-save-char','9');});
 await page.reload();await ready();await page.getByTestId('archive-avatar').locator('img').waitFor();await page.waitForFunction(()=>{const img=document.querySelector('[data-testid=archive-avatar] img');return img?.complete&&img.naturalWidth>0;});const edited=await inspect();assert.equal(edited.profile.name,'校园线名字');assert.equal(edited.profile.bio,'校园线自己的身份设定，不能写回原身份。');assert.notEqual(edited.profile.avatar,beforeAvatar);
 assert(edited.registry.saves.some(s=>s.id===fresh.id&&s.name==='校园线名字'));
 await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();await shot('new-identity-edited-390');
 await switchTo('original');const original=await inspect();assert.equal(original.profile.name,'原来的名字');assert.equal(original.profile.bio,'原身份的独立设定');assert.equal(original.profile.avatar,beforeAvatar);assert.equal(original.hwm,'321');assert(!original.messages.some(m=>m.content==='校园线独有的聊天'));
 for(const viewport of [{width:320,height:690},{width:844,height:390}]){await page.setViewportSize(viewport);await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();await shot('name-picker-'+viewport.width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await switchTo(fresh.id);const again=await inspect();assert.equal(again.profile.name,edited.profile.name);assert.equal(again.profile.bio,edited.profile.bio);assert.equal(again.profile.avatar,edited.profile.avatar);assert.equal(again.hwm,'9');assert(again.messages.some(m=>m.content==='校园线独有的聊天'));
 const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(origin+'/test/fixtures/user-saves.html');await other.getByLabel('你的名字',{exact:true}).waitFor();
 await switchTo('original');await other.waitForFunction(()=>document.querySelector('#user-save-select')?.value==='original');await other.close();
 await switchTo(fresh.id);page.on('dialog',d=>d.accept());
 await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'删除当前身份',exact:true}).click()]);await ready();
 const deleted=await inspect();assert.equal(deleted.id,'original');assert.equal(deleted.registry.saves.length,1);assert(deleted.registry.deletedSaves.some(s=>s.id===fresh.id));assert.equal(deleted.profile.name,'原来的名字');assert.equal(deleted.profile.bio,'原身份的独立设定');assert(deleted.books.some(w=>w.id==='qa-save-world'));
 assert.equal(await page.getByRole('button',{name:'删除当前身份',exact:true}).isEnabled(),false);
 await page.setViewportSize({width:390,height:844});await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();await shot('after-delete-390');
 // Keep all-identity backup/import regression through the real Settings controls.
 await page.goto(origin+'/test/fixtures/user-saves.html?settings=1');await page.getByRole('button',{name:'备份与恢复 (ZIP)',exact:true}).click();await page.getByLabel('备份范围',{exact:true}).selectOption('all');
 await page.getByRole('button',{name:/导出全部身份/}).scrollIntoViewIfNeeded();await shot('backup-all-390');
 const dlPromise=page.waitForEvent('download');await page.getByRole('button',{name:/导出全部身份/}).click();const dl=await dlPromise;const file={name:dl.suggestedFilename(),mimeType:'application/zip',buffer:await readFile(await dl.path())};
 await page.getByRole('button',{name:'关闭',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('导出全部身份')&&!b.disabled));
 await Promise.all([page.waitForEvent('framenavigated'),page.locator('input[type=file][accept=".json,.zip"]').setInputFiles(file)]);await page.getByRole('heading',{name:'系统设置',exact:true}).waitFor();
 await page.goto(origin+'/test/fixtures/user-saves.html');await ready();const imported=await inspect();assert.equal(imported.registry.saves.length,2);assert.equal(imported.profile.name,'原来的名字');assert.equal(imported.profile.bio,'原身份的独立设定');assert.deepEqual(errors,[]);
 console.log('PASS: name-field native picker auto-switches; + creates; name/bio/avatar edit and reload independently in A/B/A/B; trash removes current identity and retains base library; final identity protected; multi-tab and all-save backup/import; 390/320/landscape screenshots; no page errors.');
}catch(error){console.error(await page.locator('body').innerText());await page.screenshot({path:out+'/failure.png'});throw error;}finally{await browser.close();}
