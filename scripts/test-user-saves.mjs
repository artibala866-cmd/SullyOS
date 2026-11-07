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
 return {id:USER_SAVE_ID,registry:readUserSaves(),profile:(await rows('user_profile'))[0],messages:await rows('messages'),chars:await rows('characters'),blobIds:(await rows('blob_assets')).map(row=>row.id),books:await rows('worldbooks'),bank:await rows('bank_data'),life:await rows('life_records'),plans:await rows('med_plans'),lifeSettings:await rows('life_record_settings'),transactions:await rows('bank_transactions'),hwm:localStorage.getItem('palace_hwm_qa-save-char')};
});
const ready=()=>page.getByLabel('你的名字',{exact:true}).waitFor();
async function switchTo(id){await Promise.all([page.waitForEvent('framenavigated'),page.getByLabel('切换身份',{exact:true}).selectOption(id)]);await ready();assert.equal((await inspect()).id,id);}
async function shot(name){if(!name.endsWith('844') && !name.startsWith('backup')) await page.getByTestId('archive-scroll').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(400);await page.screenshot({path:out+'/'+name+'.png'});}
async function checkDesktop(name,damage=false){
 await page.goto(origin+'/test/fixtures/user-saves.html?desktop=1');
 if(damage){
  await page.getByRole('img',{name:'照片 1',exact:true}).waitFor();
  await page.evaluate(async()=>{const {DB}=await import('/utils/db.ts');for(const id of ['b_qa_theme_photo','b_qa_asset_photo','b_qa_deco'])await DB.deleteBlobAsset(id);});
  await page.reload();
 }
 for(const alt of ['照片 1','照片 2','照片 3','照片 4','角色资料背景照片','拍立得照片']){
  const img=page.getByRole('img',{name:alt,exact:true});await img.scrollIntoViewIfNeeded();
  await page.waitForFunction(alt=>{const el=[...document.querySelectorAll('img')].find(img=>img.alt===alt);return el?.complete&&el.naturalWidth>0;},alt);
  if(alt==='照片 1'||alt==='拍立得照片')await page.screenshot({path:out+'/desktop-'+name+'-'+(alt==='照片 1'?'film':'photo')+'.png'});
 }
 const deco=page.locator('.launcher-page img[alt=""]').first();await deco.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const el=document.querySelector('.launcher-page img[alt=""]');return el?.complete&&el.naturalWidth>0;});
 await page.screenshot({path:out+'/desktop-'+name+'-decoration.png'});
 const state=await inspect();for(const id of ['b_qa_theme_photo','b_qa_asset_photo','b_qa_deco'])assert(state.blobIds.includes(id));assert(!state.blobIds.includes('b_qa_private_pic')||state.id==='original');
 await page.goto(origin+'/test/fixtures/user-saves.html');await ready();
}

async function checkStandaloneWardrobe(blank){
 await page.goto(origin+'/chibi-wardrobe.html');await page.getByText('CHIBI 工坊',{exact:true}).waitFor();
 await page.waitForFunction(()=>localStorage.getItem('chibi-wardrobe-studio-draft-v1')!==null);
 const marker=await page.evaluate(()=>JSON.parse(localStorage.getItem('chibi-wardrobe-studio-draft-v1')).qaSaveMarker);
 assert.equal(marker,blank?undefined:'A-only','standalone wardrobe must use the active save, not raw original drafts');
 await page.goto(origin+'/test/fixtures/user-saves.html');await ready();
}

async function checkCabinet(blank){
 await page.getByRole('button',{name:/我的手办柜/}).click();
 await page.getByRole('button',{name:blank?'开始捏 3D 形象':'编辑 3D 形象',exact:true}).waitFor();
 await page.screenshot({path:out+(blank?'/fresh-cabinet-390.png':'/original-cabinet-390.png')});
 await page.getByRole('button',{name:'Q 版捏脸',exact:true}).click();
 const frame=await (async()=>{for(let i=0;i<50;i++){const f=page.frames().find(f=>f.url().includes('/like520/character_creator.html'));if(f)return f;await page.waitForTimeout(100);}throw Error('Creator frame missing');})();
 await frame.waitForFunction(()=>typeof LIKE520_INITIALIZED!=='undefined'&&LIKE520_INITIALIZED);
 const id=(await inspect()).id, prefix=id==='original'?'':`sully:save-data:${id}:`;
 const draftKey=await frame.evaluate(()=>getDraftKey());assert(draftKey.startsWith(prefix+'like520_cc_draft_'));
 assert.equal(await frame.evaluate(()=>state.selected.eyes),blank?'eyes_01':'eyes_02');
 await frame.locator('.opt:not(.none)').first().click();
 await frame.waitForFunction(()=>localStorage.getItem(getDraftKey())!==null);
 const logicalKey=draftKey.slice(prefix.length);
 assert(await page.evaluate(key=>localStorage.getItem(key),logicalKey),'iframe draft must be visible to this save backup');
 await page.waitForTimeout(800);await page.screenshot({path:out+(blank?'/fresh-creator-390.png':'/original-creator-390.png')});
 await page.getByRole('button',{name:'返回',exact:true}).click();
 await page.getByRole('button',{name:blank?'开始捏 3D 形象':'编辑 3D 形象',exact:true}).waitFor();
 await page.getByRole('button',{name:'返回',exact:true}).click();await ready();
}
async function checkLife(blank,edit=false){
 await page.getByRole('button',{name:'生活记录',exact:true}).click();
 const cycle=page.getByLabel('平均周期天数',{exact:true});await cycle.waitFor();
 assert.equal(await cycle.inputValue(),blank?'28':'32');
 if(edit){await cycle.fill('35');await cycle.press('Tab');}
 await shot(blank?'fresh-period-390':'original-period-390');
 await page.getByRole('button',{name:'药盒',exact:true}).click();
 assert.equal((await page.locator('body').innerText()).includes('A档测试药盒'),!blank);
 await shot(blank?'fresh-med-390':'original-med-390');
 await page.getByRole('button',{name:'记账',exact:true}).click();
 assert.equal((await page.locator('body').innerText()).includes('A档独立账单'),!blank);
 if(edit){await page.getByPlaceholder('金额',{exact:true}).fill('27.5');await page.getByPlaceholder('用途（奶茶 / 午饭…）',{exact:true}).fill('B档独立账单');await page.getByRole('button',{name:'入账',exact:true}).click();await page.getByText('B档独立账单',{exact:true}).waitFor();}
 await shot(blank?'fresh-expense-390':'original-expense-390');
 await page.getByRole('button',{name:'锻炼',exact:true}).click();
 assert.equal(await page.locator('textarea').inputValue(),blank?'':'A档每周慢跑');
 assert.equal(await page.getByLabel('每周锻炼目标',{exact:true}).inputValue(),blank?'0':'6');
 await shot(blank?'fresh-exercise-390':'original-exercise-390');
 await page.getByRole('button',{name:'我的档案',exact:true}).click();await ready();
}

try{
 await page.goto(origin+'/test/fixtures/user-saves.html',{timeout:60000});await ready();
 assert.equal(await page.getByRole('button',{name:'删除当前身份',exact:true}).isEnabled(),false);
 await page.getByLabel('你的名字',{exact:true}).fill('原来的名字');
 await page.getByLabel('关于我 / 设定',{exact:true}).fill('原身份的独立设定');
 await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();
 const shape=await page.evaluate(()=>{const input=document.querySelector('#archive-user-name'),picker=document.querySelector('#user-save-select');return {sameField:input.parentElement===picker.parentElement,extraText:document.body.innerText.includes('重命名')||document.body.innerText.includes('切换后继续对应故事')};});
 assert(shape.sameField);const touch=await page.getByLabel('切换身份',{exact:true}).boundingBox();assert(touch.width>=48&&touch.height>=44);assert(!shape.extraText);assert.equal(await page.getByRole('button',{name:'切换身份',exact:true}).count(),0);
 await shot('name-picker-390');
 const originProfile=(await inspect()).profile;
 await checkDesktop('original');await checkStandaloneWardrobe(false);await checkCabinet(false);await checkLife(false);
 // Hold the profile transaction to verify a real touch produces visible
 // feedback and disables a second action while data is still being saved.
 await page.evaluate(async()=>{const {DB}=await import('/utils/db.ts');const save=DB.saveUserProfile;DB.saveUserProfile=async profile=>{await new Promise(resolve=>{window.qaReleaseProfileSave=resolve;});return save(profile);};});
 await page.getByRole('button',{name:'新建身份',exact:true}).tap();await page.getByText('切换中…',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('切换身份',{exact:true}).isEnabled(),false);assert.equal(await page.getByRole('button',{name:'新建身份',exact:true}).isEnabled(),false);await shot('switching-390');
 await Promise.all([page.waitForEvent('framenavigated'),page.evaluate(()=>window.qaReleaseProfileSave())]);await ready();
 const fresh=await inspect();assert.notEqual(fresh.id,'original');assert.equal(fresh.profile.name,'新身份');assert.equal(fresh.profile.bio,'');assert.equal(fresh.messages.length,0);assert.equal(fresh.hwm,null);assert(fresh.books.some(w=>w.id==='qa-save-world'));assert.deepEqual(fresh.chars.find(c=>c.id==='qa-save-char').memories,[]);
 assert.notEqual(fresh.profile.avatar,originProfile.avatar);
 for(const key of ['life','plans','lifeSettings','transactions','bank'])assert.deepEqual(fresh[key],[],key+' starts empty');
 await checkDesktop('new');await checkDesktop('repaired',true);await checkStandaloneWardrobe(true);await checkCabinet(true);await checkLife(true,true);
 for(const key of ['perCharAvatars','imageAppearance','imageReference','imageLockEnabled','wardrobeOutfits','chibiStudio','vrState']) assert.equal(fresh.profile[key],undefined,key+' must not inherit');
 await page.getByTestId('archive-avatar').locator('img').waitFor();await page.waitForFunction(()=>{const img=document.querySelector('[data-testid=archive-avatar] img');return img?.complete&&img.naturalWidth>0;});
 assert.notEqual(await page.getByTestId('archive-avatar').locator('img').getAttribute('src'),originProfile.avatar);
 await shot('fresh-identity-default-avatar-390');
 await page.reload();await ready();assert.equal((await inspect()).profile.avatar,fresh.profile.avatar);
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
 await switchTo('original');const original=await inspect();assert.equal(original.profile.name,'原来的名字');assert.equal(original.profile.bio,'原身份的独立设定');assert.equal(original.profile.avatar,originProfile.avatar);assert.deepEqual(original.profile.perCharAvatars,originProfile.perCharAvatars);assert.equal(original.profile.imageReference,originProfile.imageReference);assert.equal(original.bank[0].goals[0].name,'A档储蓄目标');assert.equal(original.lifeSettings[0].cycleLength,32);assert.equal(original.plans[0].name,'A档测试药盒');assert.equal(original.transactions.length,1);assert.equal(original.transactions[0].note,'A档独立账单');assert.equal(original.profile.chibiStudio.home3D.state.selected.eyes,'eyes_02');assert.equal(original.hwm,'321');assert(!original.messages.some(m=>m.content==='校园线独有的聊天'));
 for(const viewport of [{width:320,height:690},{width:844,height:390}]){await page.setViewportSize(viewport);await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();await shot('name-picker-'+viewport.width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await switchTo(fresh.id);const again=await inspect();assert.equal(again.profile.name,edited.profile.name);assert.equal(again.profile.bio,edited.profile.bio);assert.equal(again.profile.avatar,edited.profile.avatar);assert.equal(again.lifeSettings[0].cycleLength,35);assert.equal(again.transactions.length,1);assert.equal(again.transactions[0].note,'B档独立账单');assert.equal(again.profile.chibiStudio,undefined);assert.equal(again.hwm,'9');assert(again.messages.some(m=>m.content==='校园线独有的聊天'));
 const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(origin+'/test/fixtures/user-saves.html');await other.getByLabel('你的名字',{exact:true}).waitFor();
 await switchTo('original');await other.waitForFunction(()=>document.querySelector('#user-save-select')?.value==='original');await other.close();
 await switchTo(fresh.id);page.once('dialog',d=>d.accept());
 await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'删除当前身份',exact:true}).click()]);await ready();
 const deleted=await inspect();assert.equal(deleted.id,'original');assert.equal(deleted.registry.saves.length,1);assert(deleted.registry.deletedSaves.some(s=>s.id===fresh.id));assert.equal(deleted.profile.name,'原来的名字');assert.equal(deleted.profile.bio,'原身份的独立设定');assert(deleted.books.some(w=>w.id==='qa-save-world'));
 assert.equal(await page.getByRole('button',{name:'删除当前身份',exact:true}).isEnabled(),false);
 await page.setViewportSize({width:390,height:844});await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();await shot('after-delete-390');
 // Restore through the same native name picker, then corrupt/remove the primary
 // index while preserving the mirror and all actual interaction data.
 await switchTo(fresh.id);
 const recovered=await inspect();assert.equal(recovered.id,fresh.id);assert.equal(recovered.profile.avatar,edited.profile.avatar);assert(recovered.messages.some(m=>m.content==='校园线独有的聊天'));assert.equal(recovered.transactions[0].note,'B档独立账单');
 await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();await shot('restored-identity-390');
 await page.evaluate(async()=>{const s=await import('/utils/userSaveScope.ts');s.nativeLocalStorage.setItem(s.USER_SAVES_KEY,'{damaged');});
 await page.reload();await ready();assert.equal((await inspect()).id,fresh.id);assert.equal((await inspect()).profile.avatar,edited.profile.avatar);
 await page.evaluate(async()=>{const s=await import('/utils/userSaveScope.ts');s.nativeLocalStorage.removeItem(s.USER_SAVES_KEY);});
 await page.reload();await ready();assert.equal((await inspect()).id,fresh.id);assert((await inspect()).messages.some(m=>m.content==='校园线独有的聊天'));
 page.once('dialog',d=>d.accept());
 await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'删除当前身份',exact:true}).click()]);await ready();
 // Keep all-identity backup/import regression through the real Settings controls.
 await page.goto(origin+'/test/fixtures/user-saves.html?settings=1');await page.getByRole('button',{name:'备份与恢复 (ZIP)',exact:true}).click();await page.getByLabel('备份范围',{exact:true}).selectOption('all');
 await page.getByRole('button',{name:/导出全部身份/}).scrollIntoViewIfNeeded();await shot('backup-all-390');
 page.once('dialog',d=>d.accept());
 const dlPromise=page.waitForEvent('download');await page.getByRole('button',{name:/导出全部身份/}).click();const dl=await dlPromise;const file={name:dl.suggestedFilename(),mimeType:'application/zip',buffer:await readFile(await dl.path())};
 await page.getByRole('button',{name:'关闭',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('导出全部身份')&&!b.disabled));
 await Promise.all([page.waitForEvent('framenavigated'),page.locator('input[type=file][accept=".json,.zip"]').setInputFiles(file)]);await page.getByRole('heading',{name:'系统设置',exact:true}).waitFor();
 await page.goto(origin+'/test/fixtures/user-saves.html');await ready();const imported=await inspect();assert.equal(imported.registry.saves.length,2);assert.equal(imported.profile.name,'原来的名字');assert.equal(imported.profile.bio,'原身份的独立设定');
 const copy=imported.registry.saves.find(save=>save.id!=='original');await switchTo(copy.id);const restoredCopy=await inspect();assert.equal(restoredCopy.profile.bio,'原身份的独立设定');assert.deepEqual(restoredCopy.messages,imported.messages);assert.match(await page.locator('#user-save-select option:checked').textContent(),/副本 · 当前/);await switchTo('original');
 // Dismissing the current-identity replacement warning must leave the rich
 // original untouched. The independent ZIP above never uses this warning.
 await page.goto(origin+'/test/fixtures/user-saves.html?settings=1');await page.getByRole('button',{name:'备份与恢复 (ZIP)',exact:true}).click();
 const confirmation=page.waitForEvent('dialog').then(async d=>{const message=d.message();await d.dismiss();return message;});
 await page.locator('input[type=file][accept=".json,.zip"]').setInputFiles({name:'old-backup.json',mimeType:'application/json',buffer:Buffer.from('{}')});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('导出')&&!b.disabled));assert.match(await confirmation,/可能替换当前档案及互动记录/);
 await page.goto(origin+'/test/fixtures/user-saves.html');await ready();assert.deepEqual((await inspect()).messages,imported.messages);assert.deepEqual(errors,[]);
 console.log('PASS: desktop film/photo/decoration images survive new identities and damaged-save reload repair without private image copying; standalone wardrobe uses the active identity; cabinet, period/settings, medicine, expenses and exercise isolated with real UI A/B/A/B; fresh identity starts with neutral avatar and no inherited per-character face/image identity/body; name-field native picker auto-switches; + creates; name/bio/avatar edit and reload independently in A/B/A/B; trash removes current identity and retains base library; recovery preserves both identities and index corruption heals; final identity protected; multi-tab, all-save backup/import and cancelled legacy replacement; 390/320/landscape screenshots; no page errors.');
}catch(error){console.error(await page.locator('body').innerText());await page.screenshot({path:out+'/failure.png'});throw error;}finally{await browser.close();}
