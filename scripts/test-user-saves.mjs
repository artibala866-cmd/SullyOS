import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.USER_SAVE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({headless:true, executablePath:process.env.USER_SAVE_CHROMIUM || undefined, args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const out=process.env.USER_SAVE_SHOTS || '/tmp/user-save-shots'; await mkdir(out,{recursive:true});
const origin=process.env.USER_SAVE_BASE || 'http://127.0.0.1:5192';
for (let attempt=0; attempt<100; attempt++) { try { await fetch(origin); break; } catch(error) { if(attempt===99) throw error; await new Promise(resolve=>setTimeout(resolve,300)); } }
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
await context.addInitScript(()=>{localStorage.setItem('sullyos_disclaimer_accepted','1');localStorage.setItem('os_first_use_memory_guide_v1','done');});
const inspect=()=>page.evaluate(async()=>{
    const {openDB}=await import('/utils/db.ts'); const {USER_SAVE_ID}=await import('/utils/userSaveScope.ts');
    const db=await openDB();
    const rows=name=>new Promise((resolve,reject)=>{const req=db.transaction(name).objectStore(name).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    return {id:USER_SAVE_ID,db:db.name,chars:await rows('characters'),books:await rows('worldbooks'),messages:await rows('messages'),profile:await rows('user_profile'),
        hwm:localStorage.getItem('palace_hwm_qa-save-char'),story:localStorage.getItem('vr_sar_simulations_v1')};
});
try {
    await page.goto(origin+'/test/fixtures/user-saves.html',{timeout:60000});
    await page.getByRole('heading',{name:'个人档案'}).waitFor({timeout:60000});
    await page.getByPlaceholder('点击输入名字').fill('旧身份修改后的名字');
    await page.waitForTimeout(400); await page.screenshot({path:out+'/archive-390.png'});
    const placement = await page.evaluate(() => { const name = document.querySelector('input[placeholder="点击输入名字"]'); const section = document.querySelector('section[aria-label="user 身份存档"]'); return { below: section.getBoundingClientRect().top > name.getBoundingClientRect().bottom, sameCard: section.parentElement === name.parentElement.parentElement.parentElement, standalone: section.classList.contains('shadow') }; });
    assert(placement.below); assert(placement.sameCard); assert(!placement.standalone);
    await page.getByRole('button',{name:'重命名身份',exact:true}).click();await page.getByLabel('身份名称',{exact:true}).fill('原来的故事线');await page.getByRole('button',{name:'保存名称',exact:true}).click();
    assert((await page.getByLabel('当前身份',{exact:true}).innerText()).includes('原来的故事线'));
    const initial=await inspect(); assert.equal(initial.id,'original'); assert(initial.messages.some(m=>m.content==='原身份的聊天'));
    await page.getByRole('button',{name:'新建身份',exact:true}).click();
    await page.getByLabel('身份名称',{exact:true}).fill('校园线');
    await page.waitForTimeout(400); await page.screenshot({path:out+'/new-identity-390.png'});
    await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'创建并切换',exact:true}).click()]);
    await page.waitForLoadState('domcontentloaded');
    await page.getByLabel('当前身份',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('#user-save-select') && document.querySelector('#user-save-select').value!=='original');
    const second=await inspect(); assert.notEqual(second.id,'original');
    assert.equal(second.messages.length,0); assert.equal(second.hwm,null); assert.equal(second.story,null);
    assert(second.books.some(b=>b.id==='qa-save-world')); const char=second.chars.find(c=>c.id==='qa-save-char'); assert.deepEqual(char.memories,[]);assert.equal(char.refinedMemories,undefined);
    assert.equal(second.profile[0].name,'校园线');assert.equal(second.profile[0].bio,'');
    await page.waitForTimeout(400); await page.screenshot({path:out+'/fresh-identity-390.png'});
    await page.evaluate(async()=>{const {DB}=await import('/utils/db.ts');await DB.saveMessage({charId:'qa-save-char',role:'user',type:'text',content:'校园线独有的聊天'});localStorage.setItem('palace_hwm_qa-save-char','9');});
    await page.reload();await page.getByLabel('当前身份',{exact:true}).waitFor();
    assert.equal((await inspect()).messages[0].content,'校园线独有的聊天');
    // Edit shared base resources from B, then return to A: history stays A, base changes propagate.
    await page.evaluate(async()=>{const {DB}=await import('/utils/db.ts');const chars=await DB.getAllCharacters();const c=chars.find(c=>c.id==='qa-save-char');await DB.saveCharacter({...c,description:'新共用人设'});});
    await page.getByLabel('当前身份',{exact:true}).selectOption('original');
    await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'切换身份',exact:true}).click()]);
    await page.waitForFunction(()=>document.querySelector('#user-save-select')?.value==='original');
    const restored=await inspect();assert.equal(restored.hwm,'321');assert(restored.messages.some(m=>m.content==='原身份的聊天'));assert(!restored.messages.some(m=>m.content==='校园线独有的聊天'));
    assert.equal(restored.chars.find(c=>c.id==='qa-save-char').memories[0].summary,'原身份的记忆');assert.equal(restored.chars.find(c=>c.id==='qa-save-char').description,'新共用人设');
    assert.equal(restored.profile[0].name,'旧身份修改后的名字');
    for(const viewport of [{width:320,height:690},{width:844,height:390}]){
        await page.setViewportSize(viewport);await page.waitForTimeout(250);await page.screenshot({path:out+`/archive-${viewport.width}.png`});await page.getByRole('button',{name:'新建身份',exact:true}).click();
        await page.getByLabel('身份名称',{exact:true}).fill('另一条故事线');
        await page.waitForTimeout(400); await page.screenshot({path:out+`/new-identity-${viewport.width}.png`});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        const box=await page.getByRole('button',{name:'创建并切换',exact:true}).boundingBox();assert(box.y>=0&&box.y+box.height<=viewport.height);
        await page.getByRole('button',{name:'取消',exact:true}).click();
    }
    // Return to B once more, retaining B's independent history after A was active.
    await page.getByLabel('当前身份',{exact:true}).selectOption(second.id);await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'切换身份',exact:true}).click()]);
    await page.waitForFunction(id=>document.querySelector('#user-save-select')?.value===id,second.id);
    const again=await inspect();assert.equal(again.hwm,'9');assert(again.messages.some(m=>m.content==='校园线独有的聊天'));assert(!again.messages.some(m=>m.content==='原身份的聊天'));
    const other=await context.newPage();other.on('pageerror',error=>errors.push(error.message));
    await other.goto(origin+'/test/fixtures/user-saves.html');await other.getByLabel('当前身份',{exact:true}).waitFor();
    assert.equal(await other.getByLabel('当前身份',{exact:true}).inputValue(),second.id);
    await page.getByLabel('当前身份',{exact:true}).selectOption('original');
    await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'切换身份',exact:true}).click()]);
    await other.waitForFunction(()=>document.querySelector('#user-save-select')?.value==='original');
    assert.equal(await other.evaluate(async()=> (await import('/utils/userSaveScope.ts')).USER_SAVE_ID),'original');
    await other.close();
    // Real Settings importer/exporter, with a complete all-identity ZIP.
    await page.setViewportSize({width:390,height:844});await page.goto(origin+'/test/fixtures/user-saves.html?settings=1');
    await page.getByRole('button',{name:'备份与恢复 (ZIP)',exact:true}).click();
    await page.getByLabel('备份范围',{exact:true}).selectOption('all');
    await page.getByRole('button',{name:/导出全部身份/}).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);await page.screenshot({path:out+'/backup-all-390.png'});
    page.on('dialog',dialog=>dialog.accept());
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:/导出全部身份/}).click();const download=await downloadPromise;const backupPath=await download.path();
    assert(download.suggestedFilename().includes('all_saves'));
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.includes('导出全部身份')&&!button.disabled));
    const payload={name:download.suggestedFilename(),mimeType:'application/zip',buffer:await readFile(backupPath)};
    await Promise.all([page.waitForEvent('framenavigated'),page.locator('input[type=file][accept=".json,.zip"]').setInputFiles(payload)]);
    await page.getByRole('heading',{name:'系统设置',exact:true}).waitFor();
    const recovered=await page.evaluate(async()=>{const {readUserSaves}=await import('/utils/userSaveScope.ts');return readUserSaves();});
    assert.equal(recovered.saves.length,4);assert.equal(recovered.activeId,'original');
    await page.goto(origin+'/test/fixtures/user-saves.html');await page.getByLabel('当前身份',{exact:true}).waitFor();
    await page.waitForTimeout(400);await page.screenshot({path:out+'/archive-restored-390.png'});
    assert.equal((await inspect()).profile[0].name,'旧身份修改后的名字');
    assert.deepEqual(errors,[]);
    console.log('PASS real archive UI: create, reload, A/B/A/B isolation, shared card/worldbook, private profile and waterlines; 390/320/landscape screenshots; rename, all-identity Settings export/import, recovered copies; second tab follows identity switch; no page errors.');
} catch(error) { console.error(await page.locator('body').innerText());await page.screenshot({path:out+'/failure.png'});throw error; }
finally {await browser.close();}
