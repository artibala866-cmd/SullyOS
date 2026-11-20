import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real CSS-mobile screenshot of the *actual* React story editor.
// Headless Chrome clamps --window-size values under 500 CSS pixels; CDP
// device emulation is needed to test 320px and 390px layouts truthfully.
const [url, widthText, heightText, screenshotPath, reportPath] = process.argv.slice(2);
const width = Number(widthText);
const height = Number(heightText);
if (!url || !Number.isInteger(width) || width < 240 || width > 1200 ||
    !Number.isInteger(height) || height < 320 || !screenshotPath || !reportPath) {
    throw new Error('Usage: node story-lore-device-viewport.mjs URL width height screenshot.png report.json');
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'story-memory-mobile-'));
const chrome = process.env.CHROME_BIN || 'chromium';
const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
    '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--window-size=800,960', 'about:blank',
], { stdio: 'ignore' });
let socket;
try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error('Chromium terminated before CDP was ready');
        try {
            port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]);
            if (port) break;
        } catch {}
        await sleep(100);
    }
    if (!port) throw new Error('Chromium debugger was unavailable');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const page = targets.find(target => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Chromium page target was unavailable');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let sequence = 0;
    const waiting = new Map();
    socket.addEventListener('message', event => {
        const response = JSON.parse(String(event.data));
        const pending = waiting.get(response.id);
        if (!pending) return;
        waiting.delete(response.id);
        if (response.error) pending.reject(new Error(pending.method + ': ' + response.error.message));
        else pending.resolve(response.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        waiting.set(id, { resolve, reject, method });
        socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: true,
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const navigation = await send('Page.navigate', { url });
    if (navigation.errorText) throw new Error('Cannot load story-memory workspace: ' + navigation.errorText);

    let result;
    for (let attempt = 0; attempt < 150; attempt++) {
        await sleep(120);
        const resultEnvelope = await send('Runtime.evaluate', {
            expression: "({state:document.body?.dataset.storyMemoryVisualReady,width:innerWidth,height:innerHeight,fit:document.documentElement.scrollWidth<=innerWidth,report:document.getElementById('story-memory-visual-report')?.textContent})",
            returnByValue: true,
        });
        result = resultEnvelope.result?.value;
        if (result?.state === 'true' || result?.state === 'false') break;
    }
    if (result?.state !== 'true' || result.width !== width ||
        result.height !== height || !result.fit) {
        const debug = await send('Runtime.evaluate', {
            expression: "({meta:document.querySelector('meta[name=viewport]')?.content,devicePixelRatio,visualViewport:{width:window.visualViewport?.width,scale:window.visualViewport?.scale},html:{client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth},body:{client:document.body.clientWidth,scroll:document.body.scrollWidth},largest:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:String(e.className||'').slice(0,70),width:Math.round(e.getBoundingClientRect().width),scroll:e.scrollWidth})).sort((a,b)=>b.width-a.width).slice(0,12)})",
            returnByValue: true,
        });
        const shot = await send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
        await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
        throw new Error('Actual device viewport or story-memory workspace failed: ' + JSON.stringify(result)
            + '; DEBUG=' + JSON.stringify(debug.result?.value));
    }
    const ui = result.report ? JSON.parse(result.report) : null;
    if (!ui?.success || ui.viewport?.width !== width)
        throw new Error('Story memory failed real-viewport assertions: ' + JSON.stringify(ui));
    const shot = await send('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
    if (url.includes('view=vectors')) {
        await send('Runtime.evaluate', { expression: "document.querySelector('.story-memory-scroll').scrollTop = 100000" });
        await sleep(350);
        const bottom = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
        await writeFile(screenshotPath.slice(0, -4) + '-bottom.png', Buffer.from(bottom.data, 'base64'));
        await send('Runtime.evaluate', {
            expression: "document.querySelector('.story-memory-scroll').scrollTop = 0; document.querySelector('.story-memory-node button')?.click();",
        });
        await sleep(500);
        const detail = await send('Runtime.evaluate', {
            expression: "!!document.querySelector('.story-memory-dialog[open]')", returnByValue: true,
        });
        if (!detail.result?.value) throw new Error('Memory detail sheet failed to open from real node');
        const tags = await send('Runtime.evaluate', {
            expression: "document.querySelector('.story-memory-dialog[open]')?.textContent?.toLowerCase()", returnByValue: true,
        });
        const text = tags.result?.value ?? '';
        if (text.includes('strict_forbidden_words_and_terms') || !text.includes('幸福') || !text.includes('john') || !text.includes('a_b')) {
            throw new Error('Legacy identifier tags leaked, or real names/codes disappeared');
        }
        const detailShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
        await writeFile(screenshotPath.slice(0, -4) + '-detail.png', Buffer.from(detailShot.data, 'base64'));
        await send('Runtime.evaluate', { expression: `document.querySelector('button[aria-label="关闭记忆详情"]')?.click()` });
        await sleep(250);
        await send('Runtime.evaluate', { expression: "document.querySelector('.story-memory-tabs button[aria-pressed=false]')?.click()" });
        await sleep(400);
        const archived = await send('Runtime.evaluate', {
            expression: "({active:document.querySelector('.story-memory-tabs button[aria-pressed=true]')?.textContent,rows:document.querySelectorAll('.story-memory-archive-item').length})",
            returnByValue: true,
        });
        if (archived.result?.value?.rows !== 2 || !archived.result.value.active.includes('归档'))
            throw new Error('Vector archive tab layout did not render: ' + JSON.stringify(archived.result?.value));
        const tabShot = await send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
        await writeFile(screenshotPath.slice(0, -4) + '-archives.png', Buffer.from(tabShot.data, 'base64'));
    } else if (width === 390) {
        await send('Runtime.evaluate', {
            expression: "document.querySelector('.story-memory-archive-item > details > summary')?.click()",
        });
        await sleep(300);
        const expanded = await send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
        await writeFile(screenshotPath.slice(0, -4) + '-expanded.png', Buffer.from(expanded.data, 'base64'));
        await send('Runtime.evaluate', {
            expression: `document.querySelector('.story-memory-archive-item > details > summary')?.click(); document.querySelector('.story-memory-archive-actions button[aria-label^="重选楼层"]')?.click()`,
        });
        await sleep(500);
        const rangeVisible = await send('Runtime.evaluate', {
            expression: "!!document.querySelector('.story-memory-range')", returnByValue: true,
        });
        if (!rangeVisible.result?.value) throw new Error('Real archive range UI did not open');
        const rangeShot = await send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
        await writeFile(screenshotPath.slice(0, -4) + '-range.png', Buffer.from(rangeShot.data, 'base64'));
    }
    await writeFile(reportPath, JSON.stringify({
        viewport: { width, height }, fit: result.fit,
        mode: ui.mode, theme: ui.theme, cards: ui.cards, success: ui.success,
        searchStationary: ui.searchStationary, bottomIcons: ui.bottomIcons,
    }, null, 2));
    process.stdout.write('Verified actual mobile CSS viewport: ' + width + 'x' + height + '\n');
} finally {
    try { socket?.close(); } catch {}
    child.kill('SIGKILL');
    await new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('exit', resolve);
        setTimeout(resolve, 3000);
    });
    await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 }).catch(() => {});
}
