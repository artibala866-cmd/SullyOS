import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const out='output/boot-jellyfish';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const url='http://127.0.0.1:5183/test/fixtures/boot-jellyfish.html';
try {
 await page.goto(url);await page.locator('.sully-boot-dog').waitFor();
 await page.waitForTimeout(1500);await page.screenshot({path:out+'/mobile.png'});
 assert.equal(await page.locator('.sully-boot').getAttribute('data-cinematic'),'true');
 assert.equal(await page.locator('.sully-boot-dog').count(),1);
 assert.equal(await page.locator('.sully-dog-body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 assert.equal(await page.locator('.sully-boot').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 await page.waitForTimeout(1500);assert.equal(await page.locator('.sully-boot').getAttribute('data-phase'),'enter');
 await page.evaluate(()=>window.dispatchEvent(new Event('boot-ready')));await page.getByText('已进入桌面').waitFor();
 await page.reload();assert.equal(await page.locator('.sully-boot').getAttribute('data-cinematic'),'false');
 await page.getByRole('button',{name:'宝宝狗，轻触进入'}).focus();await page.keyboard.press('Enter');await page.getByText('已进入桌面').waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>sessionStorage.clear());await page.goto(url);
 assert.equal(await page.locator('.sully-boot').getAttribute('data-cinematic'),'false');
 assert.equal(await page.locator('.sully-boot-dog').evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.setViewportSize({width:320,height:568});await page.screenshot({path:out+'/small-reduced.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>sessionStorage.clear());await page.setViewportSize({width:1440,height:900});await page.goto(url);await page.waitForTimeout(1500);await page.screenshot({path:out+'/desktop.png'});

 await page.goto(url+'?ready');await page.getByText('已进入桌面').waitFor();
 await page.goto('http://127.0.0.1:5183/test/fixtures/brand-baby-dog.html?cover=classic');
 await page.locator('.sully-boot-dog').waitFor();
 assert.equal(await page.locator('.sully-boot').getAttribute('data-variant'),'night');
 assert.equal(await page.locator('.sully-boot').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 await page.screenshot({path:out+'/selected-night.png'});
 await page.goto('http://127.0.0.1:5183/test/fixtures/brand-baby-dog.html');
 await page.locator('.sully-boot-dog').waitFor();
 assert.equal(await page.locator('.sully-boot').getAttribute('data-variant'),'warm');
 await page.screenshot({path:out+'/selected-babydog.png'});
 assert.deepEqual(errors,[]);console.log('PASS pure white CSS puppy, dance, data gate, automatic exit, keyboard skip, reduced motion, responsive layouts');
}finally{await browser.close();}
