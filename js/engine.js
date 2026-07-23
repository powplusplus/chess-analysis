// UCI wrapper around Stockfish 18 web workers (nmrugg), plus a small pool.
// Mode picks engine build: asm (fast), lite (balanced), full single (deep).

const MULTIPV = 2;
const SF_BASE = 'https://unpkg.com/stockfish@18.0.0/src';

/** @typedef {'fast'|'balanced'|'deep'} EngineMode */

/** @type {Record<EngineMode, {
 *   depth: number,
 *   js: string,
 *   wasm: string|null,
 *   hash: number,
 *   pool: number,
 *   label: string,
 * }>} */
export const ENGINE_MODES = {
  fast: {
    depth: 10,
    js: `${SF_BASE}/stockfish-18-asm.js`,
    wasm: null,
    hash: 16,
    pool: 2,
    label: 'Stockfish 18 asm',
  },
  balanced: {
    depth: 12,
    js: `${SF_BASE}/stockfish-18-lite-single.js`,
    wasm: `${SF_BASE}/stockfish-18-lite-single.wasm`,
    hash: 32,
    pool: 2,
    label: 'Stockfish 18 Lite',
  },
  deep: {
    depth: 16,
    js: `${SF_BASE}/stockfish-18-single.js`,
    wasm: `${SF_BASE}/stockfish-18-single.wasm`,
    hash: 64,
    pool: 1,
    label: 'Stockfish 18',
  },
};

const CACHE_NAME = 'stockfish-18.0.0';
const prefetchCache = new Map(); // urls-key -> Promise
/** @type {Map<string, string>} CDN url -> blob: URL (session) */
const blobUrls = new Map();

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

/** Prefetch JS (+ WASM) into Cache API + blob URLs; reports {loaded,total,pct,label,fromCache}. */
export function prefetchEngine(mode, onProgress) {
  const cfg = ENGINE_MODES[mode] || ENGINE_MODES.balanced;
  const urls = cfg.wasm ? [cfg.js, cfg.wasm] : [cfg.js];
  const key = urls.join('|');
  if (prefetchCache.has(key)) return prefetchCache.get(key);

  const promise = (async () => {
    // Already have session blobs → instant
    if (urls.every(u => blobUrls.has(u))) {
      onProgress?.({ loaded: 1, total: 1, pct: 100, label: cfg.label, fromCache: true });
      return;
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
      if (blobUrls.has(url)) {
        // Unknown size for cached blob — treat as done for this slot
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
      ensureBlobUrl(url, buf);
      report();
    }));

    onProgress?.({
      loaded: sizes.reduce((a, b) => a + b, 0) || loadedArr.reduce((a, b) => a + b, 0),
      total: sizes.reduce((a, b) => a + b, 0) || loadedArr.reduce((a, b) => a + b, 0),
      pct: 100,
      label: cfg.label,
      fromCache: !anyNetwork,
    });
  })().catch(err => {
    prefetchCache.delete(key);
    throw err;
  });

  prefetchCache.set(key, promise);
  return promise;
}

/** Same-origin worker URL. Blob (or CDN) script via ?js=; WASM via hash (SF bootstrap). */
function workerUrlFor(cfg) {
  const u = new URL('./sf-worker.js', import.meta.url);
  u.searchParams.set('js', blobUrls.get(cfg.js) || cfg.js);
  if (cfg.wasm) u.hash = encodeURIComponent(blobUrls.get(cfg.wasm) || cfg.wasm);
  return u;
}

class Engine {
  /** @param {typeof ENGINE_MODES[EngineMode]} cfg */
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
      this.send('stop');
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
  /** @param {EngineMode} mode */
  constructor(mode) {
    const cfg = ENGINE_MODES[mode] || ENGINE_MODES.balanced;
    this.cfg = cfg;
    const hw = navigator.hardwareConcurrency || 4;
    this.size = Math.max(1, Math.min(cfg.pool, Math.max(1, hw - 1), 3));
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
