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
const profile = await mkdtemp(join(tmpdir(), 'story-lore-mobile-'));
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
    if (navigation.errorText) throw new Error('Cannot load React editor: ' + navigation.errorText);

    let result;
    for (let attempt = 0; attempt < 150; attempt++) {
        await sleep(120);
        const resultEnvelope = await send('Runtime.evaluate', {
            expression: "({state:document.body?.dataset.storyGrayReady,width:innerWidth,height:innerHeight,fit:document.documentElement.scrollWidth<=innerWidth,report:document.getElementById('story-gray-browser-report')?.textContent})",
            returnByValue: true,
        });
        result = resultEnvelope.result?.value;
        if (result?.state === 'true' || result?.state === 'false') break;
    }
    if (result?.state !== 'true' || result.width !== width ||
        result.height !== height || !result.fit) {
        throw new Error('Actual device viewport or React editor failed: ' + JSON.stringify(result));
    }
    const ui = result.report ? JSON.parse(result.report) : null;
    if (!ui?.globalLoreOk || !ui?.success || ui.viewport?.width !== width)
        throw new Error('Worldbook selection failed real-viewport assertions: ' + JSON.stringify(ui));
    const shot = await send('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
    await writeFile(reportPath, JSON.stringify({
        viewport: { width, height }, fit: result.fit,
        globalLoreOk: ui.globalLoreOk, success: ui.success,
        selected: ui.storyTitle,
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
