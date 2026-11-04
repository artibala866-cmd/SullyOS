import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const base = 'http://127.0.0.1:5173/test/fixtures/brand-baby-dog.html';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const errors = [];
const screenshots = process.cwd();
const inspect = async page => page.evaluate(() => {
  const dog = document.querySelector('.sully-lineart');
  const canvas = document.querySelector('.sully-lineart-canvas');
  const label = document.querySelector('.sully-boot-side-label');
  const caption = document.querySelector('.sully-boot-welcome');
  const root = document.querySelector('.sully-boot');
  const bounds = dog.getBoundingClientRect();
  const image = canvas.getContext('2d').getImageData(0,0,512,512);
  let lines = 0;
  for (let y=115; y<390; y+=4) for (let x=100; x<420; x+=4) {
    if (image.data[(y*512+x)*4+3] > 120) lines++;
  }
  return {
    loaded: dog.dataset.lineReady === 'true',
    white: getComputedStyle(root).backgroundColor === 'rgb(255, 255, 255)',
    lines,
    width: bounds.width,
    dogLabel: label.textContent,
    dogLabelOpacity: parseFloat(getComputedStyle(label).opacity),
    welcome: caption.textContent,
    welcomeOpacity: parseFloat(getComputedStyle(caption).opacity),
    blinkAnimation: getComputedStyle(document.querySelector('.sully-lineart-eyes-closed')).animationName,
    mouthAnimation: getComputedStyle(document.querySelector('.sully-lineart-mouth-talking')).animationName,
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
  };
});
try {
  for (const variant of ['warm', 'classic']) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'no-preference',
      deviceScaleFactor: 1,
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + (variant === 'classic' ? '?cover=classic' : ''), {waitUntil:'domcontentloaded'});
    await page.locator('.sully-lineart[data-line-ready="true"]').waitFor({timeout:20000});
    await page.waitForTimeout(550);
    await page.screenshot({path: screenshots + '/baby-dog-' + variant + '-entry.png'});
    await page.waitForTimeout(2500);
    const final = await inspect(page);
    assert.equal(final.loaded, true);
    assert.equal(final.white, true);
    assert(final.lines > 250, 'Original hand-drawn ink must be present');
    assert(final.width <= 250, 'Dog must stay video-sized rather than filling the screen');
    assert.equal(final.dogLabel, 'dog');
    assert.equal(final.welcome, 'Welcome home.');
    assert(final.dogLabelOpacity >= .95 && final.welcomeOpacity >= .95,
      'Captions must be visible in the final screenshot');
    assert(final.blinkAnimation.includes('sullyLineEyesClosed'));
    assert(final.mouthAnimation.includes('sullyLineMouthTalk'));
    assert(final.noHorizontalOverflow);
    await page.screenshot({path: screenshots + '/baby-dog-' + variant + '-mobile.png'});

    await page.setViewportSize({width:320,height:568});
    await page.waitForTimeout(150);
    assert.equal((await inspect(page)).noHorizontalOverflow,true);
    await page.screenshot({path: screenshots + '/baby-dog-' + variant + '-small.png'});
    console.log('PASS ' + variant + ' original ink, entry zoom, eyes/mouth, English, 390/320 screens', final);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
