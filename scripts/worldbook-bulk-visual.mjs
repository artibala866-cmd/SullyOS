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
        '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
        '--remote-allow-origins=*', '--remote-debugging-port=0', '--user-data-dir=' + dir,
        '--window-size=390,844', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let chromeErrors = '';
    child.stderr?.on('data', chunk => { chromeErrors += String(chunk).slice(0, 4000); });
    try {
        let port;
        for (let attempt = 0; attempt < 400; attempt++) {
            if (child.exitCode !== null) throw new Error('Chrome exited early: ' + child.exitCode + '\\n' + chromeErrors.slice(-4000));
            try {
                port = Number(readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
                if (port) break;
            } catch {}
            await sleep(100);
        }
        assert(port, 'Chrome DevTools did not start (' + browser + '): ' + chromeErrors.slice(-4000));
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
            width: mode === 'toggle-small' ? 320 : 390, height: 844, deviceScaleFactor: 1, mobile: true,
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
        if (['search', 'selected'].includes(mode)) {
            assert(html.includes('data-match-count="6"'), 'Expected all six exact-title matches: ' + html);
            assert(html.includes('data-other-count="1"'), 'Substring search must also show 海岸线: ' + html);
        }
        if (mode === 'diary') {
            assert(html.includes('data-match-count="3"'), 'Missing three exact 日记 entries: ' + html);
            assert(html.includes('data-other-count="2"'), '日记本 entries must be visible before deleting 日记: ' + html);
        }
        if (mode === 'diary-overflow') {
            assert(html.includes('data-match-count="16"'), 'Search must not cut off results after 12: ' + html);
            assert(html.includes('data-other-count="2"'), 'Partial title entries must remain visible: ' + html);
            assert(html.includes('data-diary-selected-count="18"'), 'Select-all should include all 18 matches: ' + html);
        }
        if (mode === 'diary-delete') {
            assert(html.includes('data-diary-deleted="true"'), 'One bulk deletion must remove all exact/partial matches: ' + html);
            assert(html.includes('data-duplicate-empty-state="false"'), 'Only one empty-state hint should remain: ' + html);
            assert(html.includes('data-match-count="0"'), 'Old diary items remain visible after deletion: ' + html);
            assert(html.includes('data-other-count="0"'), 'Diary book items resurfaced after deletion: ' + html);
        }
        if (mode === 'selected') {
            assert(html.includes('data-long-press-selected="true"'), 'Long press failed to select first entry: ' + html);
            assert(html.includes('data-selected-count="7"'), 'Select-all must include partial-title match: ' + html);
        }
        if (mode.startsWith('toggle')) {
            assert(html.includes('data-switch-on-count="6"'), 'Expected six enabled entry switches: ' + html);
            assert(html.includes('data-switch-off-count="1"'), 'Expected one disabled entry switch: ' + html);
            assert(html.includes('data-switch-aria-labels="true"'), 'Each switch needs an accessible name: ' + html);
            assert(html.includes('data-switch-has-visible-text="false"'), 'Card switch must be icon-only: ' + html);
            assert(html.includes('data-switch-width="32"'), 'Card switch should be compact (32px): ' + html);
            assert(html.includes('data-switch-height="18"'), 'Card switch should be compact (18px): ' + html);
            assert(html.includes('data-switch-thumb-width="12"'), 'Switch thumb should be 12px: ' + html);
            assert(!html.includes('rgb(38, 38, 38)'), 'Card switch must not be stark black: ' + html);
            // Browser animation/snapshot timing may vary the gray values slightly;
            // assert the same visible dark-on / light-off distinction, not one exact RGB.
            const active = /data-active-switch-color="rgb\\((\\d+), (\\d+), (\\d+)\\)"/.exec(html);
            const inactive = /data-inactive-switch-color="rgb\\((\\d+), (\\d+), (\\d+)\\)"/.exec(html);
            assert(active && active.slice(1).every(value => Number(value) >= 55 && Number(value) <= 115),
                'Active switch must be visibly dark gray: ' + html);
            assert(inactive && inactive.slice(1).every((value, index) => Number(value) >= 130
                && Number(value) - Number(active[index + 1]) >= 40),
                'Disabled switch must remain visibly lighter than active: ' + html);
        }
        console.log('PASS Worldbook ' + mode + ': ' + html);
        ws.close();
    } finally {
        child.kill('SIGTERM');
        await sleep(250);
        rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
    }
}
for (const mode of ['normal', 'search', 'selected', 'diary', 'diary-overflow', 'diary-delete', 'toggle-initial', 'toggle', 'toggle-small']) await openChrome(mode);
console.log('PASS: nine mobile states include direct on/off Worldbook toggles and 320px screenshots.');
