import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const origin = process.env.USER_SAVE_VISUAL_ORIGIN || 'http://127.0.0.1:5199';
const out = process.env.USER_SAVE_VISUAL_OUT || '/tmp/user-save-wardrobe-shots';
const dir = mkdtempSync(join(tmpdir(), 'sully-user-save-visual-'));
mkdirSync(out, { recursive: true });
const browser = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--no-first-run', '--remote-allow-origins=*',
  '--remote-debugging-port=0', '--user-data-dir=' + dir, '--window-size=390,844',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
browser.stderr?.on('data', v => { stderr += String(v).slice(0, 1000); });
let socket;
try {
  let port = 0;
  for (let i = 0; i < 200; i++) {
    if (browser.exitCode !== null) throw Error('Chrome exited: ' + stderr);
    try { port = Number(readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
    if (port) break;
    await sleep(100);
  }
  assert(port, 'Chrome debugging port unavailable');
  const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
  const target = targets.find(t => t.type === 'page');
  assert(target, 'Chrome page missing');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let serial = 0;
  const pending = new Map();
  socket.addEventListener('message', e => {
    const message = JSON.parse(e.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result?.value;
  };
  const screenshot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(join(out, name + '.png'), Buffer.from(result.data, 'base64'));
  };
  const ready = async identity => {
    const began = Date.now();
    let last;
    while (Date.now() - began < 35000) {
      last = await evaluate(`({
        identity: document.body?.dataset.identity,
        count: document.querySelectorAll('.wardrobe-item').length,
        error: document.body?.dataset.visualError || document.querySelector('[role="alert"]')?.textContent,
        rendered: Array.from(document.querySelectorAll('.wardrobe-item'))
          .filter(el => !!el.querySelector('.beauty-preset-preview')?.shadowRoot ||
            !!el.querySelector('.beauty-preset-preview')?.querySelector('*')?.shadowRoot).length,
      })`);
      if (last?.error) throw Error('Wardrobe browser error: ' + last.error);
      if (last?.identity === identity && last.count === 10) return last;
      await sleep(150);
    }
    throw Error('Identity wardrobe did not load: ' + JSON.stringify(last));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: origin + '/test/fixtures/user-save-wardrobe.html' });
  const b = await ready('B');
  await sleep(1800); // Let the asynchronous Shadow DOM thumbnail previews render.
  await screenshot('identity-b-390');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  await screenshot('identity-b-320');
  await evaluate("document.getElementById('switch-to-original').click()");
  const a = await ready('A');
  await sleep(1200);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('identity-a-return-390');
  const settings = await evaluate("localStorage.getItem('sully_image_api_v1')");
  assert(settings?.includes('visual-test-only'), 'Settings are missing after returning to A');
  assert.equal(a.count, 10);
  assert.equal(b.count, 10);
  console.log('PASS 10 chat backgrounds and shared settings: original → second identity → original; 390px and 320px screenshots:', out);
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  await sleep(150);
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}
