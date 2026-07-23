// UCI wrapper around Stockfish 18 web workers (nmrugg), plus a pool.
// Mode picks build. With COOP/COEP + /sf proxy → multi-thread WASM.
// Else single-thread CDN/blob fallback. Pool parallelizes positions.

const MULTIPV = 2;
const SF_VER = '18.0.0';
const SF_CDN = `https://unpkg.com/stockfish@${SF_VER}/src`;
const SF_LOCAL = '/sf';

/** @typedef {'fast'|'balanced'|'deep'} EngineMode */

/** @type {Record<EngineMode, {
 *   depth: number,
 *   hash: number,
 *   poolMax: number,
 *   label: string,
 *   mt: { file: string, wasm: string }|null,
 *   st: { file: string, wasm: string|null },
 * }>} */
export const ENGINE_MODES = {
  fast: {
    depth: 10,
    hash: 16,
    poolMax: 4,
    label: 'Stockfish 18 asm',
    mt: null,
    st: { file: 'stockfish-18-asm.js', wasm: null },
  },
  balanced: {
    depth: 12,
    hash: 64,
    poolMax: 4,
    label: 'Stockfish 18 Lite',
    mt: { file: 'stockfish-18-lite.js', wasm: 'stockfish-18-lite.wasm' },
    st: { file: 'stockfish-18-lite-single.js', wasm: 'stockfish-18-lite-single.wasm' },
  },
  deep: {
    depth: 16,
    hash: 128,
    poolMax: 2,
    label: 'Stockfish 18',
    mt: { file: 'stockfish-18.js', wasm: 'stockfish-18.wasm' },
    st: { file: 'stockfish-18-single.js', wasm: 'stockfish-18-single.wasm' },
  },
};

const CACHE_NAME = `stockfish-${SF_VER}`;
const prefetchCache = new Map(); // key -> Promise
/** @type {Map<string, string>} CDN/local url -> blob: URL (session) */
const blobUrls = new Map();

/** @type {boolean|null} */
let sameOriginSf = null;

export function canUseThreads() {
  try {
    if (!globalThis.crossOriginIsolated) return false;
    if (typeof SharedArrayBuffer !== 'function') return false;
    if (typeof Atomics !== 'object') return false;
    const m = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return m.buffer instanceof SharedArrayBuffer;
  } catch (_) {
    return false;
  }
}

async function probeSameOriginSf() {
  if (sameOriginSf != null) return sameOriginSf;
  try {
    const r = await fetch(`${SF_LOCAL}/stockfish-18-lite-single.js`, {
      method: 'HEAD',
      cache: 'force-cache',
    });
    sameOriginSf = r.ok;
  } catch (_) {
    sameOriginSf = false;
  }
  return sameOriginSf;
}

function assetUrl(file, sameOrigin) {
  return sameOrigin ? `${SF_LOCAL}/${file}` : `${SF_CDN}/${file}`;
}

/**
 * Resolve concrete build + pool/threads for this browser.
 * @param {EngineMode} mode
 * @returns {Promise<{
 *   mode: EngineMode,
 *   depth: number,
 *   hash: number,
 *   pool: number,
 *   threads: number,
 *   js: string,
 *   wasm: string|null,
 *   label: string,
 *   sameOrigin: boolean,
 *   multiThread: boolean,
 * }>}
 */
export async function resolveEngineConfig(mode) {
  const base = ENGINE_MODES[mode] || ENGINE_MODES.balanced;
  const sameOrigin = await probeSameOriginSf();
  const wantMt = !!(base.mt && canUseThreads() && sameOrigin);
  const build = wantMt ? base.mt : base.st;
  const hw = navigator.hardwareConcurrency || 4;
  const cores = Math.max(1, hw - 1); // leave 1 for UI

  let pool;
  let threads;
  if (wantMt) {
    // Game review = many FENs → prefer parallel engines with a few threads each.
    pool = Math.max(1, Math.min(base.poolMax, Math.max(1, Math.floor(cores / 2)), 4));
    threads = Math.max(1, Math.min(4, Math.floor(cores / pool)));
  } else {
    pool = Math.max(1, Math.min(base.poolMax, cores, 4));
    threads = 1;
  }

  const js = assetUrl(build.file, sameOrigin);
  const wasm = build.wasm ? assetUrl(build.wasm, sameOrigin) : null;
  return {
    mode: ENGINE_MODES[mode] ? mode : 'balanced',
    depth: base.depth,
    hash: base.hash,
    pool,
    threads,
    js,
    wasm,
    label: base.label,
    sameOrigin,
    multiThread: wantMt,
  };
}

function mimeFor(url) {
  return url.endsWith('.wasm') ? 'application/wasm' : 'application/javascript';
}

function ensureBlobUrl(cdnUrl, buf) {
  const existing = blobUrls.get(cdnUrl);
  if (existing) return existing;
  const blob = new Blob([buf], { type: mimeFor(cdnUrl) });
  const blobUrl = URL.createObjectURL(blob);
  blobUrls.set(cdnUrl, blobUrl);
  return blobUrl;
}

async function openEngineCache() {
  if (!('caches' in globalThis)) return null;
  try { return await caches.open(CACHE_NAME); } catch (_) { return null; }
}

/** Load ArrayBuffer from Cache API or network; store on miss. */
async function loadAsset(url, onProgress) {
  const cache = await openEngineCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        onProgress?.(buf.byteLength, buf.byteLength);
        return { buf, fromCache: true };
      }
    } catch (_) { /* fall through to network */ }
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error('Engine download failed (' + res.status + ') for ' + url);
  const total = Number(res.headers.get('content-length')) || 0;

  let buf;
  if (!res.body || !res.body.getReader) {
    buf = await res.arrayBuffer();
    onProgress?.(buf.byteLength, buf.byteLength);
  } else {
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    buf = out.buffer;
    onProgress?.(total || loaded, total || loaded);
  }

  if (cache) {
    try {
      await cache.put(url, new Response(buf.slice(0), {
        headers: { 'Content-Type': mimeFor(url), 'Content-Length': String(buf.byteLength) },
      }));
    } catch (_) { /* quota / private mode */ }
  }
  return { buf, fromCache: false };
}

/** Prefetch JS (+ WASM); reports {loaded,total,pct,label,fromCache}. Returns resolved cfg. */
export function prefetchEngine(mode, onProgress) {
  const key = mode;
  if (prefetchCache.has(key)) return prefetchCache.get(key);

  const promise = (async () => {
    const cfg = await resolveEngineConfig(mode);
    const urls = cfg.wasm ? [cfg.js, cfg.wasm] : [cfg.js];

    // Same-origin MT: browser HTTP cache enough; still warm + progress.
    // Single-thread cross-origin: also need blob URLs for Worker.
    const needBlobs = !cfg.sameOrigin || !cfg.multiThread;

    if (needBlobs && urls.every(u => blobUrls.has(u))) {
      onProgress?.({ loaded: 1, total: 1, pct: 100, label: cfg.label, fromCache: true });
      return cfg;
    }

    const sizes = urls.map(() => 0);
    const loadedArr = urls.map(() => 0);
    const known = urls.map(() => false);
    let anyNetwork = false;

    const report = () => {
      const loaded = loadedArr.reduce((a, b) => a + b, 0);
      const totalKnown = known.every(Boolean);
      const total = sizes.reduce((a, b) => a + b, 0);
      let pct;
      if (totalKnown && total > 0) pct = Math.min(99, Math.round((loaded / total) * 100));
      else pct = Math.min(90, Math.round(loaded / 5e5));
      onProgress?.({ loaded, total, pct, label: cfg.label, fromCache: !anyNetwork });
    };

    await Promise.all(urls.map(async (url, i) => {
      if (needBlobs && blobUrls.has(url)) {
        loadedArr[i] = 1;
        sizes[i] = 1;
        known[i] = true;
        report();
        return;
      }
      const { buf, fromCache } = await loadAsset(url, (loaded, total) => {
        loadedArr[i] = loaded;
        if (total > 0) { sizes[i] = total; known[i] = true; }
        report();
      });
      if (!fromCache) anyNetwork = true;
      if (!known[i]) { sizes[i] = buf.byteLength; known[i] = true; loadedArr[i] = buf.byteLength; }
      if (needBlobs) ensureBlobUrl(url, buf);
      report();
    }));

    onProgress?.({
      loaded: sizes.reduce((a, b) => a + b, 0) || loadedArr.reduce((a, b) => a + b, 0),
      total: sizes.reduce((a, b) => a + b, 0) || loadedArr.reduce((a, b) => a + b, 0),
      pct: 100,
      label: cfg.label,
      fromCache: !anyNetwork,
    });
    return cfg;
  })().catch(err => {
    prefetchCache.delete(key);
    throw err;
  });

  prefetchCache.set(key, promise);
  return promise;
}

/** Absolute URL for wasm hash (SF bootstrap). */
function absUrl(url) {
  return new URL(url, location.href).href;
}

/**
 * MT same-origin: Worker = SF JS itself (pthread spawns same script).
 * ST: same-origin shell or cross-origin blob via sf-worker.js.
 */
function workerUrlFor(cfg) {
  if (cfg.multiThread && cfg.sameOrigin) {
    const u = new URL(cfg.js, location.href);
    if (cfg.wasm) u.hash = encodeURIComponent(absUrl(cfg.wasm));
    return u;
  }

  const jsUrl = cfg.sameOrigin ? absUrl(cfg.js) : (blobUrls.get(cfg.js) || cfg.js);
  const wasmUrl = cfg.wasm
    ? (cfg.sameOrigin ? absUrl(cfg.wasm) : (blobUrls.get(cfg.wasm) || cfg.wasm))
    : null;

  if (cfg.sameOrigin && !cfg.multiThread) {
    // Same-origin single: SF as worker directly (no shell).
    const u = new URL(cfg.js, location.href);
    if (wasmUrl) u.hash = encodeURIComponent(wasmUrl);
    return u;
  }

  const u = new URL('./sf-worker.js', import.meta.url);
  u.searchParams.set('js', jsUrl);
  if (wasmUrl) u.hash = encodeURIComponent(wasmUrl);
  return u;
}

class Engine {
  /** @param {Awaited<ReturnType<typeof resolveEngineConfig>>} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.worker = new Worker(workerUrlFor(cfg));
    this.pending = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.ready = new Promise((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
    this._booted = false;
    this._readyTimer = setTimeout(() => {
      if (this.readyResolve) {
        this.readyReject?.(new Error('Stockfish start timeout'));
        this.readyResolve = null;
        this.readyReject = null;
      }
    }, cfg.wasm ? 180000 : 60000);
    this.worker.onmessage = e => {
      const data = e.data;
      this._onLine(typeof data === 'string' ? data : String(data));
    };
    this.worker.onerror = (err) => {
      if (this.readyReject) {
        this.readyReject(new Error(err?.message || 'worker error'));
        this.readyResolve = null;
        this.readyReject = null;
      }
    };
    this.send('uci');
  }

  send(cmd) { this.worker.postMessage(cmd); }

  _bootOptions() {
    if (this._booted) return;
    this._booted = true;
    this.send('setoption name MultiPV value ' + MULTIPV);
    this.send('setoption name Hash value ' + this.cfg.hash);
    if (this.cfg.multiThread && this.cfg.threads > 1) {
      this.send('setoption name Threads value ' + this.cfg.threads);
    }
    this.send('isready');
  }

  _onLine(line) {
    if (!line) return;

    if (line.startsWith('uciok')) {
      this._bootOptions();
      return;
    }
    if (line.startsWith('readyok')) {
      clearTimeout(this._readyTimer);
      if (this.readyResolve) { this.readyResolve(); this.readyResolve = null; this.readyReject = null; }
      return;
    }
    if (line.startsWith('error ')) {
      clearTimeout(this._readyTimer);
      if (this.readyReject) {
        this.readyReject(new Error(line));
        this.readyResolve = null;
        this.readyReject = null;
      }
      return;
    }

    const p = this.pending;
    if (!p) return;

    if (line.startsWith('info ') && line.includes(' pv ') && !line.includes('bound')) {
      const info = parseInfo(line);
      if (info) p.lines[info.multipv] = info;
      return;
    }
    if (line.startsWith('bestmove')) {
      const best = line.split(/\s+/)[1];
      const lines = [];
      for (let i = 1; i <= MULTIPV; i++) if (p.lines[i]) lines.push(p.lines[i]);
      lines.sort((a, b) => a.multipv - b.multipv);
      this.pending = null;
      p.resolve({ best: best === '(none)' ? null : best, lines });
    }
  }

  // Resolves with { best, lines:[{multipv, cp, mate, depth, pv:[uci..]}] }
  // Scores are from the side-to-move's point of view (raw UCI).
  analyse(fen, depth) {
    return new Promise((resolve, reject) => {
      if (this.pending) {
        reject(new Error('engine busy'));
        return;
      }
      this.pending = { resolve, lines: {} };
      this.send('position fen ' + fen);
      this.send('go depth ' + depth);
    });
  }

  destroy() {
    clearTimeout(this._readyTimer);
    try { this.send('quit'); this.worker.terminate(); } catch (_) {}
  }
}

function parseInfo(line) {
  const t = line.split(/\s+/);
  const out = { multipv: 1, cp: null, mate: null, depth: 0, pv: [] };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':   out.depth = +t[++i]; break;
      case 'multipv': out.multipv = +t[++i]; break;
      case 'score':
        if (t[i + 1] === 'cp') { out.cp = +t[i + 2]; i += 2; }
        else if (t[i + 1] === 'mate') { out.mate = +t[i + 2]; i += 2; }
        break;
      case 'pv': out.pv = t.slice(i + 1); i = t.length; break;
    }
  }
  if (out.cp === null && out.mate === null) return null;
  return out;
}

export class EnginePool {
  /** @param {Awaited<ReturnType<typeof resolveEngineConfig>>} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.size = cfg.pool;
    this.engines = [];
    this.free = [];
    this.queue = [];
    for (let i = 0; i < this.size; i++) {
      const e = new Engine(cfg);
      this.engines.push(e);
      this.free.push(e);
    }
  }

  async warmUp() {
    await Promise.all(this.engines.map(e => e.ready));
  }

  analyse(fen, depth) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, depth, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this.free.length && this.queue.length) {
      const eng = this.free.pop();
      const job = this.queue.shift();
      eng.analyse(job.fen, job.depth)
        .then(job.resolve, job.reject)
        .finally(() => { this.free.push(eng); this._drain(); });
    }
  }

  destroy() { this.engines.forEach(e => e.destroy()); this.engines = []; this.free = []; this.queue = []; }
}
