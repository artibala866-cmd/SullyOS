// Chrome DevTools Protocol screenshot regression using built-in Node 22 APIs.
// No Playwright package or generated art is required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 9329;
const profile = mkdtempSync(join(tmpdir(), 'baby-dog-visual-'));
const chrome = spawn(process.env.CHROME_PATH || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--no-first-run', '--disable-background-networking', '--hide-scrollbars',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  'about:blank',
], { stdio: 'ignore' });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = async (path, options) => {
  const response = await fetch('http://127.0.0.1:' + port + path, options);
  if (!response.ok) throw Error('CDP HTTP ' + response.status);
  return response.json();
};

const openPage = async () => {
  const page = await json('/json/new?about:blank', { method: 'PUT' });
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(Error(JSON.stringify(data.error))) : resolve(data.result);
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {expression, returnByValue:true});
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const shot = async path => {
    const output = await call('Page.captureScreenshot', {format:'png', fromSurface:true});
    writeFileSync(path, Buffer.from(output.data,'base64'));
  };
  return { socket, call, evaluate, shot };
};

const inspectExpression = `(() => {
  const dog = document.querySelector('.sully-lineart');
  const canvas = document.querySelector('.sully-lineart-canvas');
  const badge = document.querySelector('.sully-lineart-badge');
  const label = document.querySelector('.sully-boot-side-label');
  const caption = document.querySelector('.sully-boot-welcome');
  const root = document.querySelector('.sully-boot');
  if (!dog || !canvas || !badge || !label || !caption || !root) return null;
  const bounds = dog.getBoundingClientRect();
  const rgba = canvas.getContext('2d').getImageData(0, 0, 512, 512).data;
  let ink = 0;
  for (let y = 115; y < 390; y += 4) for (let x = 100; x < 420; x += 4) {
    if (rgba[(y * 512 + x) * 4 + 3] > 120) ink++;
  }
  const badgePixelData = badge.getContext('2d').getImageData(0,0,512,512).data;
  let badgeInk = 0;
  for(let y=125; y<243; y+=3) for(let x=205; x<341; x+=3) {
    if (badgePixelData[(y*512+x)*4+3] > 120) badgeInk++;
  }
  const svg = document.querySelector('.sully-lineart-features');
  return {
    ready: dog.dataset.lineReady === 'true',
    white: getComputedStyle(root).backgroundColor === 'rgb(255, 255, 255)',
    ink,
    badgeInk,
    badgeTransform: getComputedStyle(badge).transform,
    width: bounds.width,
    expression: dog.dataset.expression,
    mirrored: dog.dataset.mirrored === 'true',
    actualMirror: getComputedStyle(document.querySelector('.sully-lineart-flip')).transform,
    replacementVisible: !!svg,
    closedEyes: svg?.querySelectorAll('g path').length ?? 0,
    tongueShapes: document.querySelectorAll('.sully-lineart-tongue path').length,
    originalLipIntact: !!canvas && rgba[(330 * 512 + 263) * 4 + 3] >= 0,
    stickerOutline: document.querySelectorAll('.sully-lineart-sticker ellipse').length,
    stickerTransform: document.querySelector('.sully-lineart-sticker') ?
      getComputedStyle(document.querySelector('.sully-lineart-sticker')).transform : 'none',
    label: label.textContent,
    labelLocation: document.querySelector('.sully-boot-artwork').dataset.label,
    welcome: caption.textContent,
    welcomeShown: caption.dataset.visible === 'true',
    welcomeOpacity: Number(getComputedStyle(caption).opacity),
    zoomRunning: getComputedStyle(dog).animationName.includes('sullyLineGrow'),
    noOverflow: document.documentElement.scrollWidth <= innerWidth,
  };
})()`;
const waitForState = async (page, match, description, timeoutMs = 12000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await page.evaluate(inspectExpression);
    if (current && match(current)) return current;
    await pause(35);
  }
  throw Error('Missing reference-video phase: ' + description);
};

try {
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await json('/json/version'); healthy = true; break; } catch { await pause(150); }
  }
  if (!healthy) throw Error('Chrome debugging port did not open');
  for (const variant of ['warm', 'classic']) {
    const page = await openPage();
    try {
      await page.call('Page.enable');
      await page.call('Runtime.enable');
      await page.call('Emulation.setDeviceMetricsOverride', {
        width:390, height:844, deviceScaleFactor:1, mobile:true,
      });
      await page.call('Page.navigate', {
        url:'http://127.0.0.1:5173/test/fixtures/brand-baby-dog.html' +
          (variant === 'classic' ? '?cover=classic' : ''),
      });
      const first = await waitForState(page, s => s.ready && s.ink > 250,
        'original dog ink available');
      assert(first.white && first.zoomRunning && first.badgeInk > 40,
        'Original drawing and 100% badge must survive line extraction');
      await page.shot('baby-dog-' + variant + '-entry.png');

      const blink1 = await waitForState(page, s => s.expression === 'blink',
        'first squint with open mouth');
      assert(blink1.replacementVisible && blink1.closedEyes === 2 && blink1.tongueShapes === 1 && blink1.stickerOutline === 1,
        'Blink frame must hide only two original dots, retain original lip, and add one tongue + one sticker');
      await page.shot('baby-dog-' + variant + '-blink.png');

      const openAgain = await waitForState(page,
        s => s.expression === 'normal' && !s.replacementVisible && s.width >= 180,
        'return to original two eyes without a ghost pair');
      assert(!openAgain.mirrored && openAgain.ink > 250);
      await page.shot('baby-dog-' + variant + '-open.png');

      const shout = await waitForState(page,
        s => s.expression === 'squint' && !s.mirrored,
        'wide-squint mouth scene before flipping');
      assert(shout.closedEyes === 2 && shout.tongueShapes === 1);
      await page.shot('baby-dog-' + variant + '-squint.png');

      const mirrored = await waitForState(page,
        s => s.expression === 'squint' && s.mirrored,
        'whole puppy mirrors horizontally');
      const flipped = await waitForState(page,
        s => s.mirrored && s.actualMirror.startsWith('matrix(-1'),
        'visible CSS horizontal flip after its transition', 1800);
      await page.shot('baby-dog-' + variant + '-flipped.png');

      const resumed = await waitForState(page,
        s => s.expression === 'normal' && !s.mirrored && !s.replacementVisible,
        'original face restored after horizontal flip');
      assert(resumed.label === 'dog');
      await page.shot('baby-dog-' + variant + '-restored.png');

      const final = await waitForState(page,
        s => s.welcomeShown && s.welcomeOpacity >= .98 && s.expression === 'normal' && !s.mirrored,
        'final Welcome home caption');
      assert.equal(final.label, 'dog');
      assert.equal(final.welcome, 'Welcome home.');
      assert(final.ready && final.white && final.ink > 250);
      assert(final.width <= 190 && final.width >= 160, 'Dog must stay video-sized');
      assert(final.noOverflow, '390px body overflow');
      await page.shot('baby-dog-' + variant + '-mobile.png');

      await page.call('Emulation.setDeviceMetricsOverride', {
        width:320, height:568, deviceScaleFactor:1, mobile:true,
      });
      await pause(220);
      const small = await page.evaluate(inspectExpression);
      assert(small?.noOverflow && small.width <= 180, '320px overflow');
      await page.shot('baby-dog-' + variant + '-small.png');
      console.log('PASS 8s reference timeline', variant, {first, blink1, shout, flipped, final, small});
    } finally {
      page.socket.close();
    }
  }

  // 数据就绪以后必须等待完整参考开屏，再自动进桌面；轻触跳过则不受此等待限制。
  const automatic = await openPage();
  try {
    await automatic.call('Page.enable');
    await automatic.call('Runtime.enable');
    await automatic.call('Page.navigate', {
      url:'http://127.0.0.1:5173/test/fixtures/boot-jellyfish.html?ready',
    });
    let ended = false;
    for (let i = 0; i < 120; i++) {
      const text = await automatic.evaluate("document.body?.innerText ?? ''");
      if (text.includes('已进入桌面')) { ended = true; break; }
      await pause(100);
    }
    assert(ended, 'Data-ready boot must auto-exit after full 8s reference sequence');
    console.log('PASS boot data-ready auto exit');
  } finally { automatic.socket.close(); }

  const skipped = await openPage();
  try {
    await skipped.call('Page.enable');
    await skipped.call('Runtime.enable');
    await skipped.call('Page.navigate', {
      url:'http://127.0.0.1:5173/test/fixtures/boot-jellyfish.html',
    });
    for (let n = 0; n < 100; n++) {
      if (await skipped.evaluate("!!document.querySelector('.sully-boot')")) break;
      await pause(100);
    }
    await skipped.evaluate("document.querySelector('.sully-boot')?.click()");
    let done = false;
    for (let n = 0; n < 18; n++) {
      if ((await skipped.evaluate("document.body?.innerText ?? ''")).includes('已进入桌面')) {
        done = true; break;
      }
      await pause(100);
    }
    assert(done, 'Touch skip must still work without waiting for data or the reference video');
    console.log('PASS touch skip');
  } finally { skipped.socket.close(); }

  const reduced = await openPage();
  try {
    await reduced.call('Page.enable');
    await reduced.call('Runtime.enable');
    await reduced.call('Emulation.setEmulatedMedia', {
      features:[{name:'prefers-reduced-motion',value:'reduce'}],
    });
    await reduced.call('Page.navigate', {
      url:'http://127.0.0.1:5173/test/fixtures/brand-baby-dog.html',
    });
    const scene = await waitForState(reduced, state => state.ready, 'reduced-motion puppy');
    assert(!scene.zoomRunning && !scene.replacementVisible && scene.welcomeShown,
      'Reduced motion must show only static original dog, no zoom or duplicated face');
    await reduced.shot('baby-dog-reduced-motion.png');
    console.log('PASS reduced motion', scene.width);
  } finally { reduced.socket.close(); }

} finally {
  chrome.kill('SIGTERM');
  // CI temporary profile is deleted by the runner after Chrome actually exits.
}
