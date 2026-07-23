// UCI wrapper around a Stockfish web worker, plus a small pool so several
// positions can be crunched at once.

const MULTIPV = 2;

class Engine {
  constructor() {
    this.worker = new Worker(new URL('./sf-worker.js', import.meta.url));
    this.pending = null;
    this.readyResolve = null;
    this.ready = new Promise(res => { this.readyResolve = res; });
    this.worker.onmessage = e => this._onLine(typeof e.data === 'string' ? e.data : String(e.data));
    this.send('uci');
    this.send('setoption name MultiPV value ' + MULTIPV);
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 32');
    this.send('isready');
  }

  send(cmd) { this.worker.postMessage(cmd); }

  _onLine(line) {
    if (line.startsWith('readyok') || line.startsWith('uciok')) {
      if (this.readyResolve) { this.readyResolve(); this.readyResolve = null; }
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
    return new Promise(resolve => {
      this.pending = { resolve, lines: {} };
      this.send('position fen ' + fen);
      this.send('go depth ' + depth);
    });
  }

  destroy() { try { this.send('quit'); this.worker.terminate(); } catch (_) {} }
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
    this.size = Math.max(1, Math.min(size ?? 3, Math.max(1, hw - 1), 4));
    this.engines = [];
    this.free = [];
    this.queue = [];
    for (let i = 0; i < this.size; i++) {
      const e = new Engine();
      this.engines.push(e);
      this.free.push(e);
    }
  }

  async warmUp() { await Promise.all(this.engines.map(e => e.ready)); }

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
