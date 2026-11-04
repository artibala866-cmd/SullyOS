// Chrome DevTools Protocol screenshot regression using built-in Node 22 APIs.
// No Playwright package or generated art is required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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
  const label = document.querySelector('.sully-boot-side-label');
  const caption = document.querySelector('.sully-boot-welcome');
  const root = document.querySelector('.sully-boot');
  if (!dog || !canvas || !label || !caption || !root) return null;
  const bounds = dog.getBoundingClientRect();
  const pixels = canvas.getContext('2d').getImageData(0, 0, 512, 512).data;
  let strokes = 0;
  for (let y = 115; y < 390; y += 4) for (let x = 100; x < 420; x += 4) {
    if (pixels[(y * 512 + x) * 4 + 3] > 120) strokes++;
  }
  return {
    ready: dog.dataset.lineReady === 'true',
    white: getComputedStyle(root).backgroundColor === 'rgb(255, 255, 255)',
    strokes,
    width: bounds.width,
    label: label.textContent,
    labelOpacity: parseFloat(getComputedStyle(label).opacity),
    welcome: caption.textContent,
    welcomeOpacity: parseFloat(getComputedStyle(caption).opacity),
    blinking: getComputedStyle(document.querySelector('.sully-lineart-eyes-closed')).animationName.includes('sullyLineEyesClosed'),
    talking: getComputedStyle(document.querySelector('.sully-lineart-mouth-talking')).animationName.includes('sullyLineMouthTalk'),
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
  };
})()`;

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
      let prepared = false;
      for (let n = 0; n < 100; n++) {
        try {
          if (await page.evaluate('document.querySelector(\'.sully-lineart\')?.dataset.lineReady === \'true\'')) {
            prepared = true; break;
          }
        } catch { /* page still loading */ }
        await pause(120);
      }
      assert(prepared, 'Original dog ink never loaded');
      await pause(450);
      await page.shot('baby-dog-' + variant + '-entry.png');
      await pause(2600);
      const final = await page.evaluate(inspectExpression);
      assert(final, 'Missing real boot');
      assert(final.ready && final.white);
      assert(final.strokes > 250, 'Extracted handwritten ink missing');
      assert(final.width <= 250, 'Dog unexpectedly oversized');
      assert.equal(final.label, 'dog');
      assert.equal(final.welcome, 'Welcome home.');
      assert(final.labelOpacity >= .95 && final.welcomeOpacity >= .95,
        'Fade-in captions not visible at the end');
      assert(final.blinking && final.talking, 'Face animation unavailable');
      assert(final.noHorizontalOverflow, '390px overflow');
      await page.shot('baby-dog-' + variant + '-mobile.png');
      await page.call('Emulation.setDeviceMetricsOverride', {
        width:320, height:568, deviceScaleFactor:1, mobile:true,
      });
      await pause(220);
      const small = await page.evaluate(inspectExpression);
      assert(small?.noHorizontalOverflow && small?.width < 230, '320px overflow');
      await page.shot('baby-dog-' + variant + '-small.png');
      console.log('PASS ' + variant + ' real ink and timing', final);
    } finally {
      page.socket.close();
    }
  }
} finally {
  chrome.kill('SIGTERM');
  rmSync(profile, {recursive:true, force:true});
}
