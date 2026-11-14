import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Mobile CDP test of the actual React story input, memory view and list navigation.
const [url, widthString, screenshotFile] = process.argv.slice(2);
const width = Number(widthString), height = 844;
if (!url || ![320, 390].includes(width) || !screenshotFile) {
    throw new Error('Usage: node story-input-draft-mobile.mjs URL 320|390 screenshot.png');
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'story-draft-mobile-'));
const chrome = spawn(process.env.CHROME_BIN || 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
    '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--window-size=800,960', 'about:blank',
], { stdio: 'ignore' });
let socket;
try {
    let port = 0;
    for (let i = 0; i < 100 && !port; i++) {
        if (chrome.exitCode !== null) throw new Error('Chrome exited');
        try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]); }
        catch {}
        if (!port) await sleep(100);
    }
    if (!port) throw new Error('Chrome CDP unavailable');
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const page = pages.find(x => x.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Browser page unavailable');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let seq = 0;
    const pending = new Map();
    socket.addEventListener('message', e => {
        const obj = JSON.parse(String(e.data));
        const p = pending.get(obj.id);
        if (!p) return;
        pending.delete(obj.id);
        if (obj.error) p.reject(new Error(obj.error.message));
        else p.resolve(obj.result);
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (response.exceptionDetails) throw new Error('Browser expression failed: ' + expression);
        return response.result?.value;
    };
    const until = async (expression, label) => {
        for (let n = 0; n < 100; n++) {
            if (await evaluate(expression)) return;
            await sleep(120);
        }
        throw new Error('Timed out: ' + label);
    };
    const tap = async selector => {
        const did = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`);
        if (!did) throw new Error('Cannot find button: ' + selector);
    };
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const navigation = await call('Page.navigate', { url });
    if (navigation.errorText) throw new Error(navigation.errorText);

    const text = '我想了一会儿，仍没决定要不要走过去。\n\n“等我想好下一句。”';
    const other = '另一段剧情自己的草稿。';
    await until("Boolean(document.querySelector('textarea:not([disabled])'))", 'initial story composer');
    await evaluate("document.querySelector('textarea').focus()");
    await call('Input.insertText', { text });
    await until(`document.querySelector('textarea')?.value === ${JSON.stringify(text)}`, 'typing story draft');
    await until(`localStorage.getItem('sully_story_input_draft_draft-visual-a') === ${JSON.stringify(text)}`, 'synchronous storage');
    await tap('button[aria-label="本剧情向量记忆"]');
    await until("Boolean(document.querySelector('section[aria-label=\"向量节点\"]'))", 'real vector memory page');
    await tap('button[aria-label="返回剧情"]');
    await until(`document.querySelector('textarea')?.value === ${JSON.stringify(text)}`, 'return from real memory page');
    await tap('button:has(svg.phosphor-arrow-left)');
    await until("Boolean(document.querySelector('button[aria-label=\"进入剧情 另一段剧情\"]'))", 'story list');
    await tap('button[aria-label="进入剧情 另一段剧情"]');
    await until("document.querySelector('textarea')?.value === ''", 'different story blank');
    await evaluate("document.querySelector('textarea').focus()");
    await call('Input.insertText', { text: other });
    await until(`document.querySelector('textarea')?.value === ${JSON.stringify(other)}`, 'other story draft');
    await tap('button:has(svg.phosphor-arrow-left)');
    await until("Boolean(document.querySelector('button[aria-label=\"进入剧情 雨夜剧情\"]'))", 'story list return');
    await tap('button[aria-label="进入剧情 雨夜剧情"]');
    await until(`document.querySelector('textarea')?.value === ${JSON.stringify(text)}`, 'original story restored');

    const layout = await evaluate(`({
        width: innerWidth, height: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        composer: (() => { const x = document.querySelector('textarea').getBoundingClientRect(); return {left:x.left,right:x.right,bottom:x.bottom}; })(),
        first: localStorage.getItem('sully_story_input_draft_draft-visual-a'),
        second: localStorage.getItem('sully_story_input_draft_draft-visual-b')
    })`);
    if (layout.width !== width || layout.documentWidth > width || layout.composer.right > width ||
        layout.composer.left < 0 || layout.composer.bottom > height ||
        layout.first !== text || layout.second !== other) {
        throw new Error('Real mobile draft/layout regression: ' + JSON.stringify(layout));
    }
    await mkdir(dirname(screenshotFile), { recursive: true });
    const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    await writeFile(screenshotFile, Buffer.from(shot.data, 'base64'));
    await writeFile(screenshotFile.replace(/\.png$/, '.json'), JSON.stringify(layout, null, 2));
    process.stdout.write('PASS ' + width + 'px: typed -> vector memory -> story -> list -> other story -> back; drafts isolated and restored; no overflow\n');
} finally {
    try { socket?.close(); } catch {}
    chrome.kill('SIGKILL');
    await new Promise(resolve => {
        if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
        chrome.once('exit', resolve);
        setTimeout(resolve, 2500);
    });
    await rm(profile, { recursive: true, force: true }).catch(() => {});
}
