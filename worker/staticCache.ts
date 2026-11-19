/** Resource caching is isolated from push delivery and never opens application databases. */
export interface StaticEntry { url: string; revision: string; bytes: number }
export interface StaticManifest { buildId: string; appVersion: string; entries: StaticEntry[]; shell: string[] }
interface CacheDependencies {
  manifest: StaticManifest;
  scope: string;
  caches: CacheStorage;
  fetch: (request: Request) => Promise<Response>;
  digest: (bytes: ArrayBuffer) => Promise<string>;
  waitUntil: (promise: Promise<unknown>) => void;
  now?: () => number;
  maxBytes?: number;
  maxEntries?: number;
}

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const SCRIPT_TIMEOUT_MS = 20_000;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
// A resource used after this long is refreshed in the background: external ones are downloaded
// again, local ones only have their last-use time renewed.
const REFRESH_MS = 24 * 60 * 60 * 1000;
const SIZE_HEADER = 'X-Sully-Cache-Bytes';
const SAVED_HEADER = 'X-Sully-Cache-Saved';
const immutablePath = (path: string) => /^assets\/build\/[^/]+-[\w-]{8,}\.[\w]+$/.test(path);

export function isPublicExternalAsset(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  if (url.hostname === 'fonts.googleapis.com') return url.pathname === '/css2';
  if (url.hostname === 'fonts.gstatic.com') return url.pathname.startsWith('/s/');
  if (['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net'].includes(url.hostname)) {
    return url.pathname.startsWith('/gh/qegj567-cloud/SullyOS-assets@') || /^\/npm\/katex@0\.16\.(9|11)\/dist\//.test(url.pathname);
  }
  if (url.hostname === 'raw.githubusercontent.com') return url.pathname.startsWith('/qegj567-cloud/SullyOS-assets/');
  if (url.hostname === 'cdn.statically.io') return url.pathname.startsWith('/gh/qegj567-cloud/SullyOS-assets/');
  return url.hostname === 'unpkg.com' && url.pathname.startsWith('/katex@0.16.9/dist/');
}

export function createStaticCache(deps: CacheDependencies) {
  const { manifest, caches } = deps;
  const scope = new URL(deps.scope);
  const prefix = `sully-static-${encodeURIComponent(scope.pathname)}-v1-`;
  const shellName = `${prefix}shell-${manifest.buildId}`;
  const runtimeName = `${prefix}runtime`;
  const now = deps.now || Date.now;
  const isBuildScript = (entry?: StaticEntry): entry is StaticEntry =>
    Boolean(entry && entry.url.endsWith('.js') && immutablePath(entry.url));
  const entries = new Map(manifest.entries.map(entry => [new URL(entry.url, scope).href, entry]));
  const shellPaths = new Set(manifest.shell.map(path => new URL(path, scope).href));
  let writeQueue: Promise<unknown> = Promise.resolve();
  const absolute = (path: string) => new URL(path, scope).href;
  const staleKey = absolute('__sully_shell_stale__');
  const keyFor = (entry: StaticEntry) => immutablePath(entry.url)
    ? absolute(entry.url) : `${absolute(entry.url)}?__sully_revision=${entry.revision}`;
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const next = writeQueue.catch(() => {}).then(job);
    writeQueue = next.catch(() => {});
    return next;
  };
  const safeMatch = async (name: string, key: string) => {
    try { return await (await caches.open(name)).match(key); } catch { return undefined; }
  };
  const findOwned = async (key: string): Promise<Response | undefined> => {
    const names = await caches.keys();
    for (const name of names.filter(name => name.startsWith(prefix)).reverse()) {
      const hit = await safeMatch(name, key);
      if (hit) return hit;
    }
    return undefined;
  };

  // Hosts may add scripts to HTML or rewrite parts of it. Such an entry page still belongs to
  // this build as long as every build file it references is one of ours.
  const sameBuildPage = (html: string) => {
    const references = [...html.matchAll(/assets\/build\/[^"'\s<>)]+/g)];
    return references.length > 0 && references.every(match => entries.has(absolute(match[0])));
  };

  async function readBody(response: Response, limit: number, signal?: AbortSignal) {
    const reader = response.body?.getReader();
    if (!reader) return;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (!signal?.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { cancel(); return; }
        chunks.push(value);
      }
      if (signal?.aborted) { cancel(); return; }
    } finally {
      signal?.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  }

  function withBody(response: Response, body: Uint8Array<ArrayBuffer>) {
    const headers = new Headers(response.headers);
    headers.delete('Content-Encoding');
    headers.set('Content-Length', String(body.byteLength));
    return new Response(body, { headers });
  }

  const canStore = (response: Response) => response.status === 200 && response.type !== 'opaque' &&
    !response.redirected && !/\b(no-store|private)\b/i.test(response.headers.get('Cache-Control') || '') &&
    response.headers.get('Vary') !== '*';

  function stamp(response: Response, bytes: number) {
    response.headers.set(SIZE_HEADER, String(bytes));
    response.headers.set(SAVED_HEADER, String(now()));
    return response;
  }

  /** Consumes `response`; callers pass a copy they do not need afterwards. */
  async function cacheable(response: Response, entry?: StaticEntry) {
    if (!canStore(response) || (entry && entry.bytes > MAX_FILE_BYTES)) {
      void response.body?.cancel().catch(() => {});
      return;
    }
    const body = await readBody(response, MAX_FILE_BYTES);
    if (!body) return;
    if (entry && (body.byteLength !== entry.bytes || await deps.digest(body.buffer) !== entry.revision) &&
      !(entry.url === 'index.html' && sameBuildPage(new TextDecoder().decode(body)))) return;
    return stamp(withBody(response, body), body.byteLength);
  }

  // A cached response can be damaged too. Bound reads before handing a script to the
  // module loader, while leaving other assets on their existing streaming path.
  async function verifyScript(response: Response, entry: StaticEntry, signal: AbortSignal) {
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); return; }
    try {
      const body = await readBody(response, entry.bytes, signal);
      if (body?.byteLength === entry.bytes && await deps.digest(body.buffer) === entry.revision && !signal.aborted) {
        return withBody(response, body);
      }
    } catch { /* Truncated bodies can reject while being read. */ }
  }

  async function withScriptTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, requestSignal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (requestSignal?.aborted) abort();
    else requestSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, SCRIPT_TIMEOUT_MS);
    try { return await operation(controller.signal); }
    finally {
      clearTimeout(timer);
      requestSignal?.removeEventListener('abort', abort);
    }
  }

  // Sizes and last-use times of the optional cache, read once per worker start so that writes
  // do not reread every stored response. Only the active worker serves requests.
  interface Stored { size: number; saved: number }
  let runtimeIndex: Promise<Map<string, Stored>> | undefined;
  const describe = (response: Response): Stored => ({
    size: Number(response.headers.get(SIZE_HEADER)) || 0, saved: Number(response.headers.get(SAVED_HEADER)) || 0,
  });
  const indexOf = (cache: Cache) => runtimeIndex ??= (async () => {
    const items = new Map<string, Stored>();
    for (const key of await cache.keys()) {
      const response = await cache.match(key);
      if (response) items.set(key.url, describe(response));
    }
    return items;
  })().catch(error => { runtimeIndex = undefined; throw error; });

  async function findVerifiedScript(entry: StaticEntry, preferred: string, shell: boolean, signal?: AbortSignal) {
    const key = keyFor(entry);
    let damaged = false;
    const check = async (name: string) => {
      if (signal?.aborted) return;
      const candidate = await safeMatch(name, key);
      if (!candidate || (!shell && now() - Number(candidate.headers.get(SAVED_HEADER)) > MAX_AGE)) return;
      const response = await withScriptTimeout(timeout => verifyScript(candidate, entry, timeout), signal);
      if (response) return { response, name, damaged };
      if (signal?.aborted) return;
      damaged = true;
      await serial(async () => {
        if (name === runtimeName) runtimeIndex = undefined;
        await (await caches.open(name)).delete(key);
      }).catch(() => {});
    };
    const direct = await check(preferred);
    if (direct) return direct;
    const names = await caches.keys().catch(() => []);
    for (const name of names.reverse()) {
      if (name === preferred || !name.startsWith(prefix)) continue;
      const fallback = await check(name);
      if (fallback) return fallback;
    }
    return { damaged, response: undefined, name: undefined };
  }

  async function prune(cache: Cache) {
    const items = await indexOf(cache);
    let bytes = 0;
    for (const item of items.values()) bytes += item.size;
    // Least recently used first, so anything past the maximum age is also at the front.
    for (const [key, item] of [...items].sort((a, b) => a[1].saved - b[1].saved)) {
      const expired = !item.saved || now() - item.saved > MAX_AGE;
      if (!expired && items.size <= (deps.maxEntries ?? 256) && bytes <= (deps.maxBytes ?? 96 * 1024 * 1024)) break;
      await cache.delete(key);
      items.delete(key); bytes -= item.size;
    }
  }

  const store = (key: string, response: Response) => serial(async () => {
    const cache = await caches.open(runtimeName);
    const items = await indexOf(cache);
    const item = describe(response);
    await cache.put(key, response);
    items.set(key, item);
    await prune(cache);
  });

  const remember = async (key: string, response: Response, entry?: StaticEntry) => {
    try {
      const stored = await cacheable(response, entry);
      if (stored) await store(key, stored);
    } catch { /* Storage failure must not turn a successful request into an error. */ }
  };

  const touch = async (key: string) => {
    try {
      const current = await safeMatch(runtimeName, key);
      if (!current) return;
      const headers = new Headers(current.headers);
      headers.set(SAVED_HEADER, String(now()));
      await store(key, new Response(current.body, { headers }));
    } catch { /* The resource stays usable with its previous time. */ }
  };

  // Set once a newer release replaced this build: the server stopped serving one of its hashed
  // files, or the next worker reported a release that needs no consent (`markReplaced`). Kept in
  // the shell cache, so it lasts across worker restarts and ends with the build.
  let shellStale: Promise<boolean> | undefined;
  const isShellStale = () => shellStale ??= safeMatch(shellName, staleKey).then(Boolean);
  const markShellStale = async () => {
    shellStale = Promise.resolve(true);
    try { await (await caches.open(shellName)).put(staleKey, new Response(null)); } catch { /* remembered for this worker run */ }
  };
  const refreshing = new Set<string>();
  const missing = (response: Response) => response.status === 404 || response.status === 410 ||
    (response.ok && /^text\/html\b/i.test(response.headers.get('Content-Type') || ''));

  async function fetchScript(request: Request, entry: StaticEntry) {
    const attempt = (next: Request) => withScriptTimeout(async signal => {
      let response: Response;
      try { response = await deps.fetch(new Request(next, { signal })); }
      catch (error) {
        if (signal.aborted && !next.signal.aborted) return;
        throw error;
      }
      if (!response.ok) return { response, verified: false, storable: false };
      if (missing(response)) {
        void response.body?.cancel().catch(() => {});
        return { response: new Response(null, { status: 404 }), verified: false, storable: false };
      }
      const storable = entry.bytes <= MAX_FILE_BYTES && canStore(response);
      const verified = await verifyScript(response, entry, signal);
      if (verified) return { response: verified, verified: true, storable };
    }, next.signal);

    let result = await attempt(request);
    if ((!result || missing(result.response)) && request.cache !== 'reload' && !request.signal.aborted) {
      result = await attempt(new Request(request, { cache: 'reload' }));
    }
    return result;
  }

  async function install() {
    try {
      const cache = await caches.open(shellName);
      // Write HTML last: a shell is usable only after every synchronous dependency is verified.
      async function prepare(path: string) {
        const entry = entries.get(absolute(path));
        if (!entry) throw new Error(`Missing shell entry: ${path}`);
        const key = keyFor(entry);
        if (isBuildScript(entry)) {
          const cached = await findVerifiedScript(entry, shellName, true);
          if (cached.response) {
            await cache.put(key, stamp(cached.response, entry.bytes));
            return;
          }
          const request = new Request(absolute(path), { cache: cached.damaged ? 'reload' : 'default' });
          const result = await fetchScript(request, entry);
          if (!result?.verified || !result.storable) throw new Error(`Resource changed during deployment: ${path}`);
          await cache.put(key, stamp(result.response, entry.bytes));
          return;
        }
        const old = await findOwned(key);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          // Some hosts redirect /index.html to the directory URL, which serves the same page everywhere.
          // A hashed name always has the same content, so the copy the page just downloaded is reused.
          const request = new Request(path === 'index.html' ? scope.href : absolute(path),
            { cache: immutablePath(path) ? 'default' : 'no-cache', signal: controller.signal });
          const response = old || await cacheable(await deps.fetch(request), entry);
          if (!response) throw new Error(`Resource changed during deployment: ${path}`);
          await cache.put(keyFor(entry), response);
        } finally { clearTimeout(timer); }
      }
      const paths = manifest.shell.filter(path => path !== 'index.html');
      // Wait for every writer before removing a failed installation's partial cache.
      let failed = false;
      const jobs = await Promise.allSettled(Array.from({ length: Math.min(4, paths.length) }, async () => {
        while (paths.length && !failed) {
          try { await prepare(paths.shift()!); }
          catch (error) { failed = true; throw error; }
        }
      }));
      const failure = jobs.find((job): job is PromiseRejectedResult => job.status === 'rejected');
      if (failure) throw failure.reason;
      await prepare('index.html');
    } catch (error) {
      await caches.delete(shellName).catch(() => {});
      throw error;
    }
  }

  async function activate(inUseBuilds: string[] | null = []) {
    // Keep the previous shell AND any older release still open in a tab. A non-responsive
    // legacy tab means its version is unknown; defer shell cleanup until a later activation.
    const old = (await caches.keys()).filter(name => name.startsWith(`${prefix}shell-`) && name !== shellName);
    if (inUseBuilds) {
      const protectedNames = new Set(inUseBuilds.map(build => `${prefix}shell-${build}`));
      for (const name of old.slice(0, -1)) if (!protectedNames.has(name)) await caches.delete(name);
    }
    await serial(async () => prune(await caches.open(runtimeName)));
  }

  function handle(request: Request, waitUntil = deps.waitUntil): Promise<Response> | undefined {
    if (request.method !== 'GET' || request.headers.has('Authorization') || request.headers.has('Range') || request.cache === 'no-store') return;
    const url = new URL(request.url);
    const local = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    const pathname = local ? url.pathname.slice(scope.pathname.length) : '';
    const isShell = local && (pathname === '' || pathname === 'index.html');
    // Arbitrary query strings can identify dynamic responses; only existing icon revision URLs are
    // normalized. The entry page is the same for any query, which the app itself reads (e.g. the
    // URL a notification opens).
    if (local && !isShell && [...url.searchParams.keys()].some(key => key !== 'v')) return;
    const canonical = `${url.origin}${url.pathname}`;
    const entry = entries.get(isShell ? absolute('index.html') : canonical);
    // A no-cors request only yields an opaque response, which is never stored.
    const external = !local && isPublicExternalAsset(url) && request.mode !== 'no-cors' && request.credentials !== 'include';
    const hashed = local && immutablePath(pathname);
    if (!entry && !external && !hashed) return;
    const key = entry ? keyFor(entry) : request.url;

    return (async () => {

      const shell = entry && shellPaths.has(absolute(entry.url));
      if (entry && !hashed && await isShellStale()) {
        // The release now on the server supplies the page and the files that keep their names
        // across releases; offline, the copies of this build below still start the app.
        try {
          const fresh = await deps.fetch(new Request(request, { cache: 'no-store' }));
          if (fresh.ok || fresh.type === 'opaqueredirect') return fresh;
        } catch { /* cached copy */ }
      }
      if (isBuildScript(entry)) {
        const cached = await findVerifiedScript(entry, shell ? shellName : runtimeName, Boolean(shell), request.signal);
        if (cached.response) {
          if (shell && cached.name !== shellName) {
            const copy = stamp(cached.response.clone(), entry.bytes);
            waitUntil(caches.open(shellName).then(cache => cache.put(key, copy)).catch(() => {}));
          } else if (!shell && cached.name === runtimeName &&
            now() - Number(cached.response.headers.get(SAVED_HEADER)) > REFRESH_MS && !refreshing.has(key)) {
            refreshing.add(key);
            waitUntil(touch(key).finally(() => refreshing.delete(key)));
          }
          return cached.response;
        }
        const result = await fetchScript(cached.damaged ? new Request(request, { cache: 'reload' }) : request, entry);
        if (!result) return new Response(null, { status: 502, statusText: 'Invalid build script' });
        if (missing(result.response)) waitUntil(markShellStale());
        if (result.verified && result.storable) {
          const copy = stamp(result.response.clone(), entry.bytes);
          const write = shell ? caches.open(shellName).then(cache => cache.put(key, copy)) : store(key, copy);
          waitUntil(write.catch(() => {}));
        }
        return result.response;
      }
      const stored = await safeMatch(shell ? shellName : runtimeName, key);
      let hit = stored;
      if (!hit && (shell || hashed)) {
        try { hit = await findOwned(key); } catch { /* network fallback */ }
      }
      const age = hit ? now() - Number(hit.headers.get(SAVED_HEADER)) : 0;
      if (hit && !shell && age > MAX_AGE) hit = undefined;
      if (hit) {
        if (stored && !shell && age > REFRESH_MS && !refreshing.has(key)) {
          refreshing.add(key);
          waitUntil((external ? deps.fetch(request).then(response => remember(key, response)) : touch(key))
            .catch(() => {}).finally(() => refreshing.delete(key)));
        }
        return hit;
      }
      // A hashed name always has the same content, so the HTTP cache may answer. Other known
      // revisions are revalidated: an older HTTP force-cache response must not satisfy them.
      let response = await deps.fetch(entry && !hashed ? new Request(request, { cache: 'no-cache' }) : request);
      if (hashed && missing(response)) {
        // An HTTP cache can hold a fallback page under this name; ask the server before deciding.
        void response.body?.cancel().catch(() => {});
        response = await deps.fetch(new Request(request, { cache: 'reload' }));
        if (missing(response) && entry) waitUntil(markShellStale());
      }
      // A missing old shell must not be replaced by HTML from a different deployment.
      if (!isShell && (entry || external)) waitUntil(remember(key, response.clone(), entry));
      return response;
    })();
  }

  async function stats() {
    let shellBytes = 0, runtimeBytes = 0, runtimeEntries = 0;
    for (const name of (await caches.keys()).filter(name => name.startsWith(prefix))) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const size = Number(response?.headers.get(SIZE_HEADER)) || 0;
        if (name === runtimeName) { runtimeBytes += size; runtimeEntries++; } else shellBytes += size;
      }
    }
    const index = entries.get(absolute('index.html'));
    const ready = index && await safeMatch(shellName, keyFor(index));
    const scripts = manifest.shell.map(path => entries.get(absolute(path))).filter(isBuildScript);
    return { buildId: manifest.buildId, appVersion: manifest.appVersion, shellBytes, runtimeBytes, runtimeEntries,
      offlineReady: Boolean(ready && (await Promise.all(scripts.map(entry => safeMatch(shellName, keyFor(entry))))).every(Boolean)) };
  }

  const clearRuntime = () => serial(() => { runtimeIndex = undefined; return caches.delete(runtimeName); });
  return { install, activate, handle, stats, clearRuntime, markReplaced: markShellStale };
}
