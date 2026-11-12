import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = process.env.WORLDBOOK_VISUAL_ORIGIN || 'http://127.0.0.1:5182';
const browser = process.env.CHROME_BIN || 'google-chrome';
const out = process.env.WORLDBOOK_VISUAL_OUT || '/tmp/worldbook-bulk-shots';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
mkdirSync(out, { recursive: true });

async function openChrome(mode) {
    const dir = mkdtempSync(join(tmpdir(), 'worldbook-chrome-'));
    const child = spawn(browser, [
        '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--no-first-run', '--no-default-browser-check',
        '--remote-allow-origins=*', '--remote-debugging-port=0', '--user-data-dir=' + dir,
        '--window-size=390,844', 'about:blank',
    ], { stdio: 'ignore' });
    try {
        let port;
        for (let attempt = 0; attempt < 100; attempt++) {
            if (child.exitCode !== null) throw new Error('Chrome exited early: ' + child.exitCode);
            try {
                port = Number(readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
                if (port) break;
            } catch {}
            await sleep(100);
        }
        assert(port, 'Chrome DevTools did not start');
        const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
        const target = targets.find(t => t.type === 'page');
        assert(target, 'No Chrome page');
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve, { once: true });
            ws.addEventListener('error', reject, { once: true });
        });
        let nextId = 0;
        const pending = new Map();
        ws.addEventListener('message', event => {
            const result = JSON.parse(event.data);
            if (!result.id || !pending.has(result.id)) return;
            const { resolve, reject } = pending.get(result.id);
            pending.delete(result.id);
            if (result.error) reject(new Error(JSON.stringify(result.error)));
            else resolve(result.result);
        });
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++nextId;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', {
            width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
        });
        await send('Page.navigate', { url: origin + '/test/fixtures/worldbook-bulk-visual.html?mode=' + mode });
        let html = '';
        let ready = false;
        let failure = '';
        const start = Date.now();
        while (Date.now() - start < 65_000) {
            const evaluation = await send('Runtime.evaluate', {
                expression: 'document.querySelector("output[data-worldbook-visual-ready]")?.outerHTML || document.querySelector("output[data-worldbook-visual-error]")?.outerHTML || ""',
                returnByValue: true,
            });
            html = evaluation.result?.value || '';
            if (html.includes('data-worldbook-visual-ready="true"')) { ready = true; break; }
            if (html.includes('data-worldbook-visual-error')) { failure = html; break; }
            await sleep(250);
        }
        const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
        writeFileSync(join(out, 'worldbook-' + mode + '.png'), Buffer.from(screenshot.data, 'base64'));
        assert(ready, 'Worldbook fixture failed: ' + (failure || 'timed out') + ' [mode=' + mode + ']');
        assert(html.includes('data-intro-present="false"'), 'Intro still present');
        assert(html.includes('data-horizontal-overflow="false"'), 'Horizontal overflow in mobile viewport');
        if (mode !== 'normal') {
            assert(html.includes('data-match-count="6"'), 'Expected all six exact-title matches: ' + html);
            assert(html.includes('data-other-count="0"'), 'Search shows nonmatching titles: ' + html);
        }
        if (mode === 'selected') {
            assert(html.includes('data-long-press-selected="true"'), 'Long press failed to select first entry: ' + html);
            assert(html.includes('data-selected-count="6"'), 'Select-all failed: ' + html);
        }
        console.log('PASS Worldbook ' + mode + ': ' + html);
        ws.close();
    } finally {
        child.kill('SIGTERM');
        await sleep(250);
        rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
    }
}
for (const mode of ['normal', 'search', 'selected']) await openChrome(mode);
console.log('PASS: three mobile screenshots captured without an accelerated IndexedDB clock.');
