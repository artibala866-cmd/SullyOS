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
async function downloadBackup(target, mode='all', screenshot){
 await target.goto(origin+'/test/fixtures/user-saves.html?settings=1');
 await target.getByRole('button',{name:'备份与恢复 (ZIP)',exact:true}).click();
 await target.getByLabel('备份范围',{exact:true}).selectOption(mode);
 const button=target.getByRole('button',{name:mode==='all'?/导出全部身份/:/整合导出/});await button.scrollIntoViewIfNeeded();
 if(screenshot)await shot(screenshot);
 target.once('dialog',d=>d.accept());
 const dlPromise=target.waitForEvent('download');await button.click();const dl=await dlPromise;
 const file={name:dl.suggestedFilename(),mimeType:'application/zip',buffer:await readFile(await dl.path())};
 await target.getByRole('button',{name:'关闭',exact:true}).click();await button.waitFor();
 return file;
}
async function importAll(target,file){
 await Promise.all([target.waitForEvent('framenavigated'),target.locator('input[type=file][accept=".json,.zip"]').setInputFiles(file)]);
 await target.getByRole('heading',{name:'系统设置',exact:true}).waitFor();
}

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGPcFRDEQApgIkn1qIZRDUNKAwBbvAF8a7jX/wAAAABJRU5ErkJggg==','base64');
async function checkRoleImage(target, mode) {
 const panel = target.getByRole('heading',{name:'生图外貌设定',exact:true});
 await target.goto(origin+'/test/fixtures/user-saves.html?roleImage=1');
 await panel.waitFor();
 assert.equal(await target.getByRole('button',{name:/使用当前生图 API/}).count(),0);
 const appearance = target.getByLabel('外貌描述 / 正面提示词');
 if(mode==='edit'){
  const requests=[];
  await target.route('https://qa-image.invalid/**',route=>{
   requests.push({url:route.request().url(),body:route.request().postDataBuffer()});
   return route.fulfill({body:imageBytes,contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await appearance.fill('灰色短发');
  await target.getByLabel('五官 / 脸部特征提示词').fill('浅色虹膜');
  const upload=target.getByLabel('锁脸参考图（上传角色图片）');
  await upload.setInputFiles({name:'face.png',mimeType:'image/png',buffer:imageBytes});
  await target.getByRole('status').getByText('锁脸参考图已保存').waitFor();
  await upload.setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('invalid image')});
  await target.getByRole('status').getByText(/参考图上传失败/).waitFor();
  assert.equal(requests.length,0,'editing the role profile must not call any image API');
  await target.reload();await panel.waitFor();
  await target.waitForFunction(()=>[...document.images].some(image=>image.alt==='角色生图参考图'&&image.complete&&image.naturalWidth>0));
  await target.screenshot({path:out+'/role-image-settings-390.png'});
  const result=await target.evaluate(async()=>{
   const {DB}=await import('/utils/db.ts');
   const {getBlobForRef}=await import('/utils/blobRef.ts');
   const {imagePermission,deliverAutomaticImage,parseImageDirective,setImagePermission}=await import('/utils/automaticImage.ts');
   const {readImageSettings,saveImageSettings}=await import('/components/settings/ImageApiSettingsPanel.tsx');
   saveImageSettings({...readImageSettings(),provider:'openai',baseUrl:'https://qa-image.invalid/v1',apiKey:'mock',model:'gpt-image-2'});
   const sender={id:'qa-save-char',name:'谢嬴'};
   const photo=parseImageDirective('[[SEND_PHOTO: 窗边自拍]] [[PHOTO_SUBJECTS: self]]');
   const commit=async (token,description,signal)=>{
    await DB.saveMessage({charId:sender.id,type:'image',role:'assistant',content:token,metadata:{visionDescription:description}},signal);
    return (await getBlobForRef(token))?.size>0;
   };
   const blocked=await deliverAutomaticImage({scope:'private',id:sender.id,permission:null,photo,sender,commit});
   setImagePermission('private',sender.id,true);
   const sent=await deliverAutomaticImage({scope:'private',id:sender.id,permission:imagePermission('private',sender.id),photo,sender,commit});
   setImagePermission('private',sender.id,false);
   return {blocked,sent};
  });
  assert.deepEqual(result,{blocked:false,sent:true});
  assert.equal(requests.length,1);
  assert.match(requests[0].url,/\/images\/edits$/);
  assert(requests[0].body.includes(imageBytes),'must transmit the uploaded reference bytes');
  assert.match(requests[0].body.toString(),/灰色短发, 浅色虹膜/);
 }
 assert.equal(await appearance.inputValue(),'灰色短发');
 await target.waitForFunction(()=>[...document.images].some(image=>image.alt==='角色生图参考图'&&image.complete&&image.naturalWidth>0));
 if(mode==='inherited') await target.screenshot({path:out+'/role-image-in-new-identity-390.png'});
 await target.goto(origin+'/test/fixtures/user-saves.html');
 await target.getByLabel('你的名字',{exact:true}).waitFor();
}
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
 await checkRoleImage(page,'edit');
 await checkDesktop('original');await checkStandaloneWardrobe(false);await checkCabinet(false);await checkLife(false);
 // Hold the profile transaction to verify a real touch produces visible
 // feedback and disables a second action while data is still being saved.
 await page.evaluate(async()=>{const {DB}=await import('/utils/db.ts');const save=DB.saveUserProfile;DB.saveUserProfile=async profile=>{await new Promise(resolve=>{window.qaReleaseProfileSave=resolve;});return save(profile);};});
 await page.getByRole('button',{name:'新建身份',exact:true}).tap();await page.getByText('切换中…',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('切换身份',{exact:true}).isEnabled(),false);assert.equal(await page.getByRole('button',{name:'新建身份',exact:true}).isEnabled(),false);await shot('switching-390');
 await Promise.all([page.waitForEvent('framenavigated'),page.evaluate(()=>window.qaReleaseProfileSave())]);await ready();
 const fresh=await inspect();assert.notEqual(fresh.id,'original');assert.equal(fresh.profile.name,'新身份');assert.equal(fresh.profile.bio,'');assert.equal(fresh.messages.length,0);assert.equal(fresh.hwm,null);assert(fresh.books.some(w=>w.id==='qa-save-world'));assert.deepEqual(fresh.chars.find(c=>c.id==='qa-save-char').memories,[]);
 assert.notEqual(fresh.profile.avatar,originProfile.avatar);assert(!fresh.blobIds.includes('qa-private-face'));
 for(const key of ['life','plans','lifeSettings','transactions','bank'])assert.deepEqual(fresh[key],[],key+' starts empty');
 await checkRoleImage(page,'inherited');
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
 await page.evaluate(async()=>{const {DB}=await import('/utils/db.ts');await DB.saveMessage({charId:'qa-save-char',role:'user',type:'text',content:'校园线独有的聊天'});localStorage.setItem('palace_hwm_qa-save-char','9');await DB.saveCharacter({id:'qa-b-only-role',name:'校园线独有角色',avatar:'',description:'只作为基础卡片共享',systemPrompt:'角色人设',memories:[{id:'qa-b-memory',date:'2026-11-11',summary:'校园线角色专属记忆'}]});await DB.saveMessage({charId:'qa-b-only-role',role:'assistant',type:'text',content:'只有校园线发生过的对话'});});
 await page.reload();await ready();await page.getByTestId('archive-avatar').locator('img').waitFor();await page.waitForFunction(()=>{const img=document.querySelector('[data-testid=archive-avatar] img');return img?.complete&&img.naturalWidth>0;});const edited=await inspect();assert.equal(edited.profile.name,'校园线名字');assert.equal(edited.profile.bio,'校园线自己的身份设定，不能写回原身份。');assert.notEqual(edited.profile.avatar,beforeAvatar);
 assert(edited.registry.saves.some(s=>s.id===fresh.id&&s.name==='校园线名字'));
 await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();await shot('new-identity-edited-390');
 await switchTo('original');const original=await inspect();assert.equal(original.profile.name,'原来的名字');assert.equal(original.profile.bio,'原身份的独立设定');assert.equal(original.profile.avatar,originProfile.avatar);assert.deepEqual(original.profile.perCharAvatars,originProfile.perCharAvatars);assert.equal(original.profile.imageReference,originProfile.imageReference);assert.equal(original.bank[0].goals[0].name,'A档储蓄目标');assert.equal(original.lifeSettings[0].cycleLength,32);assert.equal(original.plans[0].name,'A档测试药盒');assert.equal(original.transactions.length,1);assert.equal(original.transactions[0].note,'A档独立账单');assert.equal(original.profile.chibiStudio.home3D.state.selected.eyes,'eyes_02');assert.equal(original.hwm,'321');assert(!original.messages.some(m=>m.content==='校园线独有的聊天'));const sharedCardWithoutHistory=original.chars.find(c=>c.id==='qa-b-only-role');assert(sharedCardWithoutHistory,'角色基础卡片允许共享');assert.deepEqual(sharedCardWithoutHistory.memories,[],'不得把校园线角色私密记忆带入原身份');assert(!original.messages.some(m=>m.charId==='qa-b-only-role'),'不得把校园线独有聊天带入原身份');
 for(const viewport of [{width:320,height:690},{width:844,height:390}]){await page.setViewportSize(viewport);await page.getByLabel('你的名字',{exact:true}).scrollIntoViewIfNeeded();await shot('name-picker-'+viewport.width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await switchTo(fresh.id);const again=await inspect();assert.equal(again.profile.name,edited.profile.name);assert.equal(again.profile.bio,edited.profile.bio);assert.equal(again.profile.avatar,edited.profile.avatar);assert.equal(again.lifeSettings[0].cycleLength,35);assert.equal(again.transactions.length,1);assert.equal(again.transactions[0].note,'B档独立账单');assert.equal(again.profile.chibiStudio,undefined);assert.equal(again.hwm,'9');assert(again.messages.some(m=>m.content==='校园线独有的聊天'));assert.deepEqual(again.chars.find(c=>c.id==='qa-b-only-role')?.memories.map(m=>m.summary),['校园线角色专属记忆'],'切回校园线时不能丢失其独有角色记忆');assert(again.messages.some(m=>m.charId==='qa-b-only-role'&&m.content==='只有校园线发生过的对话'),'切回校园线时不能丢失独有角色聊天');

 // Weird-but-human play: two separate identities intentionally share the same
 // visible name, then alternate story scenes, edits and browser reloads.
 const oddName='同名的我', oddPrefix='奇怪换档测试/';
 await page.getByLabel('你的名字',{exact:true}).fill(oddName);
 await page.waitForFunction(async id=>(await import('/utils/userSaveScope.ts')).readUserSaves().saves.find(s=>s.id===id)?.name==='同名的我',fresh.id);
 await switchTo('original');
 await page.getByLabel('你的名字',{exact:true}).fill(oddName);
 await page.waitForFunction(async ()=>(await import('/utils/userSaveScope.ts')).readUserSaves().saves.find(s=>s.id==='original')?.name==='同名的我');
 const sameNameOptions=await page.locator('#user-save-select option').allTextContents();
 assert.equal(sameNameOptions.length,2);assert.notEqual(sameNameOptions[0],sameNameOptions[1],'same labels must remain distinguishable');
 for(let hop=0;hop<12;hop++){
  const id=hop%2===0?fresh.id:'original',tag=hop%2===0?'B':'A';
  await switchTo(id);
  const bio='我在'+tag+'身份扮演第'+hop+'段剧情；切档后不能串线。';
  await page.getByLabel('关于我 / 设定',{exact:true}).fill(bio);
  await page.waitForFunction(async expected=>{const {DB}=await import('/utils/db.ts');return (await DB.getUserProfile())?.bio===expected;},bio);
  await page.evaluate(async ({tag,hop,oddPrefix})=>{
   const {DB}=await import('/utils/db.ts');
   await DB.saveMessage({charId:'qa-save-char',role:'user',type:'text',content:oddPrefix+tag+'/'+hop+'：刚从另一条故事线回来'});
   localStorage.setItem('qa-odd-last-world',tag+'/'+hop);
  },{tag,hop,oddPrefix});
  const state=await inspect(),own=state.messages.filter(m=>typeof m.content==='string'&&m.content.startsWith(oddPrefix));
  assert(own.length>0&&own.every(m=>m.content.startsWith(oddPrefix+tag+'/')),'conversation from the other identity leaked into '+tag);
  assert.equal(await page.evaluate(()=>localStorage.getItem('qa-odd-last-world')),tag+'/'+hop);
  assert.equal(state.profile.bio,bio);
 }
 // Return both save labels/profiles to their prior values; stress messages stay
 // in their own histories to exercise the existing backup/export checks too.
 await page.getByLabel('你的名字',{exact:true}).fill(originProfile.name);
 await page.getByLabel('关于我 / 设定',{exact:true}).fill(originProfile.bio);
 await page.waitForFunction(async expected=>{const {DB}=await import('/utils/db.ts');const p=await DB.getUserProfile();return p?.name===expected.name&&p?.bio===expected.bio;},{name:originProfile.name,bio:originProfile.bio});
 await switchTo(fresh.id);
 const oddB=await inspect();
 assert(oddB.messages.filter(m=>m.content?.startsWith(oddPrefix)).every(m=>m.content.startsWith(oddPrefix+'B/')));
 await page.getByLabel('你的名字',{exact:true}).fill(edited.profile.name);
 await page.getByLabel('关于我 / 设定',{exact:true}).fill(edited.profile.bio);
 await page.waitForFunction(async expected=>{const {DB}=await import('/utils/db.ts');const p=await DB.getUserProfile();return p?.name===expected.name&&p?.bio===expected.bio;},{name:edited.profile.name,bio:edited.profile.bio});
 await page.reload();await ready();
 assert.equal((await inspect()).profile.name,edited.profile.name);
 const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(origin+'/test/fixtures/user-saves.html');await other.getByLabel('你的名字',{exact:true}).waitFor();
 await switchTo('original');await other.waitForFunction(()=>document.querySelector('#user-save-select')?.value==='original');await other.close();
 // Verify the index mirror while both live saves are present.
 await switchTo(fresh.id);
 await page.evaluate(async()=>{const s=await import('/utils/userSaveScope.ts');s.nativeLocalStorage.setItem(s.USER_SAVES_KEY,'{damaged');});
 await page.reload();await ready();assert.equal((await inspect()).id,fresh.id);assert.equal((await inspect()).profile.avatar,edited.profile.avatar);
 await page.evaluate(async()=>{const s=await import('/utils/userSaveScope.ts');s.nativeLocalStorage.removeItem(s.USER_SAVES_KEY);});
 await page.reload();await ready();assert.equal((await inspect()).id,fresh.id);assert((await inspect()).messages.some(m=>m.content==='校园线独有的聊天'));

 // Old releases kept deleted test saves. Even if present in the index, these
 // never become selectable or part of a newly exported all-identity backup.
 await page.evaluate(async()=>{const s=await import('/utils/userSaveScope.ts');const registry=s.readUserSaves();s.writeUserSaves({...registry,deletedSaves:[{id:'22222222-2222-4222-8222-222222222222',name:'已删测试',deletedAt:1}]},s.nativeLocalStorage.getItem(s.USER_SAVES_KEY));});
 await page.reload();await ready();
 assert.equal(await page.locator('#user-save-select option').count(),2);
 assert.equal(await page.locator('#user-save-select optgroup').count(),0);
 await page.setViewportSize({width:390,height:844});
 const file=await downloadBackup(page,'all','backup-all-390');
 const singleFile=await downloadBackup(page,'current');
 await page.goto(origin+'/test/fixtures/user-saves.html');await ready();
 page.once('dialog',async d=>{assert.match(d.message(),/永久删除/);await d.dismiss();});
 await page.getByRole('button',{name:'删除当前身份',exact:true}).click();assert.equal((await inspect()).id,fresh.id);
 page.once('dialog',d=>d.accept());
 await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'删除当前身份',exact:true}).click()]);await ready();
 await page.waitForFunction(async id=>!(await indexedDB.databases()).some(db=>db.name==='AetherOS_Data__user_'+id),fresh.id);
 const deleted=await inspect();assert.equal(deleted.id,'original');assert.equal(deleted.registry.saves.length,1);assert.equal(deleted.profile.name,'原来的名字');assert.equal(deleted.profile.bio,'原身份的独立设定');assert(deleted.books.some(w=>w.id==='qa-save-world'));
 assert.equal(await page.getByRole('button',{name:'删除当前身份',exact:true}).isEnabled(),false);
 assert.deepEqual(await page.locator('#user-save-select option').allTextContents(),['原来的名字 · 当前']);
 await shot('after-delete-390');
 const currentOnly=await downloadBackup(page);
 await importAll(page,currentOnly);
 await page.goto(origin+'/test/fixtures/user-saves.html');await ready();const imported=await inspect();assert.equal(imported.registry.saves.length,2);assert.equal(imported.profile.name,'原来的名字');assert.equal(imported.profile.bio,'原身份的独立设定');
 const copy=imported.registry.saves.find(save=>save.id!=='original');await switchTo(copy.id);const restoredCopy=await inspect();assert.equal(restoredCopy.profile.bio,'原身份的独立设定');assert.deepEqual(restoredCopy.messages,imported.messages);assert.match(await page.locator('#user-save-select option:checked').textContent(),/副本 · 当前/);await switchTo('original');

 // A separate browser context has none of the original site data. The file
 // alone must bring back both identities with their original private histories.
 const clean=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await clean.addInitScript(()=>{localStorage.setItem('qa-user-saves-seeded','1');localStorage.setItem('sullyos_disclaimer_accepted','1');localStorage.setItem('os_first_use_memory_guide_v1','done');});
 const cleanPage=await clean.newPage();cleanPage.on('pageerror',e=>errors.push(e.message));
 await cleanPage.goto(origin+'/test/fixtures/user-saves.html?settings=1');await cleanPage.getByRole('button',{name:'备份与恢复 (ZIP)',exact:true}).click();
 await importAll(cleanPage,file);
 await cleanPage.goto(origin+'/test/fixtures/user-saves.html');
 const cleanPicker=cleanPage.getByLabel('切换身份',{exact:true});await cleanPicker.waitFor();
 const restoredLabels=await cleanPicker.locator('option').allTextContents();assert.equal(restoredLabels.length,3);assert.deepEqual(restoredLabels.slice(1),['原来的名字 · 副本','校园线名字 · 副本']);
 for(const [name,bio,message] of [['原来的名字','原身份的独立设定','原身份的聊天'],['校园线名字','校园线自己的身份设定，不能写回原身份。','校园线独有的聊天']]){
  const option=cleanPicker.locator('option').filter({hasText:name+' · 副本'});
  await Promise.all([cleanPage.waitForEvent('framenavigated'),cleanPicker.selectOption(await option.getAttribute('value'))]);
  await cleanPage.getByLabel('关于我 / 设定',{exact:true}).waitFor();
  assert.equal(await cleanPage.getByLabel('关于我 / 设定',{exact:true}).inputValue(),bio);
  const contents=await cleanPage.evaluate(async()=>{const {openDB}=await import('/utils/db.ts');const db=await openDB();return new Promise(resolve=>{const req=db.transaction('messages').objectStore('messages').getAll();req.onsuccess=()=>resolve(req.result.map(row=>row.content));});});
  assert(contents.includes(message));
 }
 await cleanPage.screenshot({path:out+'/backup-restored-fresh-browser-390.png'});
 await checkRoleImage(cleanPage,'restored');
 await clean.close();
 const single=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await single.addInitScript(()=>{localStorage.setItem('qa-user-saves-seeded','1');localStorage.setItem('sullyos_disclaimer_accepted','1');localStorage.setItem('os_first_use_memory_guide_v1','done');});
 const singlePage=await single.newPage();singlePage.on('pageerror',e=>errors.push(e.message));
 await singlePage.goto(origin+'/test/fixtures/user-saves.html?settings=1');
 await singlePage.getByRole('button',{name:'备份与恢复 (ZIP)',exact:true}).click();
 singlePage.once('dialog',dialog=>{assert.match(dialog.message(),/可能替换当前档案/);return dialog.accept();});
 await importAll(singlePage,singleFile);
 await checkRoleImage(singlePage,'restored');
 assert.equal(await singlePage.getByLabel('你的名字',{exact:true}).inputValue(),'校园线名字');
 assert.equal(await singlePage.locator('#user-save-select option').count(),1);
 await single.close();
 // Dismissing the current-identity replacement warning must leave the rich
 // original untouched. The independent ZIP above never uses this warning.
 await page.goto(origin+'/test/fixtures/user-saves.html?settings=1');await page.getByRole('button',{name:'备份与恢复 (ZIP)',exact:true}).click();
 const confirmation=page.waitForEvent('dialog').then(async d=>{const message=d.message();await d.dismiss();return message;});
 await page.locator('input[type=file][accept=".json,.zip"]').setInputFiles({name:'old-backup.json',mimeType:'application/json',buffer:Buffer.from('{}')});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('导出')&&!b.disabled));assert.match(await confirmation,/可能替换当前档案及互动记录/);
 await page.goto(origin+'/test/fixtures/user-saves.html');await ready();assert.deepEqual((await inspect()).messages,imported.messages);assert.deepEqual(errors,[]);
 console.log('PASS: desktop film/photo/decoration images survive new identities and damaged-save reload repair without private image copying; standalone wardrobe uses the active identity; cabinet, period/settings, medicine, expenses and exercise isolated with real UI A/B/A/B; fresh identity starts with neutral avatar and no inherited per-character face/image identity/body; name-field native picker auto-switches; + creates; name/bio/avatar edit and reload independently in A/B/A/B; trash purges current identity and retains base library; deleted entries stay hidden; index corruption heals; exported ZIP restores both identities in a clean browser; role lock-face settings and bytes reach the image provider and survive identity switching and both backup scopes; final identity protected; multi-tab, all-save backup/import and cancelled legacy replacement; 390/320/landscape screenshots; no page errors.');
}catch(error){console.error(await page.locator('body').innerText());await page.screenshot({path:out+'/failure.png'});throw error;}finally{await browser.close();}
