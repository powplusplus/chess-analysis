// UCI wrapper around a Stockfish web worker, plus a small pool so several
// positions can be crunched at once.

const MULTIPV = 2;
const SF_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';

let prefetchPromise = null;

/** Download Stockfish into the HTTP cache; reports {loaded,total,pct}. */
export function prefetchStockfish(onProgress) {
  if (prefetchPromise) return prefetchPromise;
  prefetchPromise = (async () => {
    const res = await fetch(SF_URL);
    if (!res.ok) throw new Error('Stockfish download failed (' + res.status + ')');
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !res.body.getReader) {
      await res.arrayBuffer();
      onProgress?.({ loaded: total || 1, total: total || 1, pct: 100 });
      return;
    }
    const reader = res.body.getReader();
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      const pct = total ? Math.min(99, Math.round((loaded / total) * 100)) : Math.min(90, Math.round(loaded / 30000));
      onProgress?.({ loaded, total, pct });
    }
    onProgress?.({ loaded: total || loaded, total: total || loaded, pct: 100 });
  })().catch(err => {
    prefetchPromise = null;
    throw err;
  });
  return prefetchPromise;
}

class Engine {
  constructor() {
    this.worker = new Worker(new URL('./sf-worker.js', import.meta.url));
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
    }, 60000);
    this.worker.onmessage = e => this._onLine(typeof e.data === 'string' ? e.data : String(e.data));
    this.worker.onerror = (err) => {
      if (this.readyReject) {
        this.readyReject(err?.message || 'worker error');
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
    // stockfish.js@10 asm build: Hash max is 16 - higher values hang the engine.
    this.send('setoption name MultiPV value ' + MULTIPV);
    this.send('setoption name Hash value 16');
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
  constructor(size) {
    const hw = navigator.hardwareConcurrency || 4;
    this.size = Math.max(1, Math.min(size ?? 2, Math.max(1, hw - 1), 3));
    this.engines = [];
    this.free = [];
    this.queue = [];
    for (let i = 0; i < this.size; i++) {
      const e = new Engine();
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
