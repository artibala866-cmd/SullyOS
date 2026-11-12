import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const origin = process.env.BOOT_VISUAL_ORIGIN || 'http://127.0.0.1:5199';
const browser = process.env.CHROME_BIN || 'google-chrome';
const out = process.env.BOOT_VISUAL_OUT || '/tmp/boot-animation-shots';
mkdirSync(out, { recursive: true });

async function run({ label, width, height, enabled }) {
  const dir = mkdtempSync(join(tmpdir(), 'sully-boot-visual-'));
  const child = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-extensions', '--no-first-run', '--remote-allow-origins=*',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--remote-debugging-port=0', '--user-data-dir=' + dir,
    '--window-size=' + width + ',' + height, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', value => { stderr += String(value).slice(0, 1000); });
  let ws;
  try {
    let port = 0;
    for (let i = 0; i < 250; i++) {
      if (child.exitCode !== null) throw Error('Chrome exited: ' + stderr.slice(-2000));
      try { port = Number(readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
      if (port) break;
      await sleep(100);
    }
    assert(port, 'Chrome remote debugging port unavailable: ' + stderr.slice(-1000));
    const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
    const target = targets.find(t => t.type === 'page');
    assert(target, 'No Chrome page');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    let next = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const payload = JSON.parse(event.data);
      if (!payload.id || !pending.has(payload.id)) return;
      const { resolve, reject, method } = pending.get(payload.id);
      pending.delete(payload.id);
      payload.error ? reject(Error(method + ': ' + JSON.stringify(payload.error))) : resolve(payload.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const screenshot = async name => {
      await send('Target.activateTarget', { targetId: target.id });
      const capture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      writeFileSync(join(out, label + '-' + name + '.png'), Buffer.from(capture.data, 'base64'));
    };
    const state = async () => {
      const result = await send('Runtime.evaluate', {
        expression: '({ observedBootCount: window.__sullyBootObserved?.length ?? -1, currentlyMounted: !!document.querySelector(".sully-boot"), ready: !!document.body?.textContent?.includes("Tap to Unlock"), text: (document.body?.innerText || "").slice(0, 180) })',
        returnByValue: true,
      });
      return result.result?.value || {};
    };
    console.log('BOOT VISUAL CDP attached:', label, target.id);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    // Seed localStorage before React starts, and catch even a one-frame mount.
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: '(' + function monitorStartup() {
        try {
          const parsed = JSON.parse(localStorage.getItem('os_theme') || '{}');
          const saved = parsed && typeof parsed === 'object' ? parsed : {};
          const enabled = new URLSearchParams(location.search).get('boot-enabled') === '1';
          localStorage.setItem('os_theme', JSON.stringify({ ...saved, bootAnimationEnabled: enabled }));
        } catch (e) { window.__sullyVisualSeedError = String(e); }
        window.__sullyBootObserved = [];
        const monitor = () => {
          if (document.querySelector('.sully-boot') && !window.__sullyBootObserved.length) {
            window.__sullyBootObserved.push(performance.now());
          }
        };
        new MutationObserver(monitor).observe(document, { subtree: true, childList: true });
        document.addEventListener('DOMContentLoaded', monitor);
      }.toString() + ')()',
    });
    console.log('BOOT VISUAL navigate:', label);
    await send('Page.navigate', { url: origin + '/?boot-enabled=' + (enabled ? '1' : '0') + '&scene=' + label });
    await sleep(300);
    if (!enabled) await screenshot('first-paint');
    let sawBoot = false;
    let ready = false;
    let last = {};
    const began = Date.now();
    while (Date.now() - began < 25000) {
      last = await state();
      sawBoot ||= last.observedBootCount > 0 || last.currentlyMounted;
      ready ||= last.ready;
      if (!enabled && sawBoot) {
        await screenshot('unexpected-boot');
        throw Error('DISABLED boot animation was mounted: ' + JSON.stringify(last));
      }
      if (enabled && sawBoot) {
        await screenshot('enabled-boot');
        break;
      }
      if (!enabled && ready && Date.now() - began > 1500) break;
      await sleep(120);
    }
    if (enabled) {
      assert(sawBoot, 'Enabled boot sequence did not render: ' + JSON.stringify(last));
    } else {
      await screenshot('locked-screen');
      assert(ready, 'Disabled startup did not reach lock screen: ' + JSON.stringify(last));
      assert(!sawBoot, 'Disabled startup unexpectedly rendered a boot scene');
    }
    console.log('PASS real app boot visual ' + label + ': ' + JSON.stringify({ enabled, width, height, bootObserved: sawBoot, reachedLock: ready, final: last.text }));
  } finally {
    try { ws?.close(); } catch {}
    child.kill('SIGTERM');
    await sleep(180);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

for (const scene of [
  { label: 'disabled-390', width: 390, height: 844, enabled: false },
  { label: 'disabled-320', width: 320, height: 700, enabled: false },
  { label: 'enabled-390', width: 390, height: 844, enabled: true },
]) {
  await run(scene);
}
