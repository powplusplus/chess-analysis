import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { EnginePool } from './engine.js';
import { icon, colorOf, labelOf, ORDER } from './icons.js';
import { classifyMove, gameAccuracy, estimateRating, toWhiteCp, winPct } from './classify.js';
import { fetchRecentGames, summarise } from './chesscom.js';

const $ = id => document.getElementById(id);
const PIECE = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const FILES = 'abcdefgh';

const state = {
  chess: null,
  moves: [],        // {san, uci, from, to, color, fenBefore, fenAfter}
  evals: [],        // one per position, 0..N
  reports: [],      // one per move
  ply: 0,
  flipped: false,
  showArrow: true,
  meta: null,
  pool: null,
  running: false,
};

/* ─────────────────── screens ─────────────────── */
function show(name) {
  for (const s of ['search', 'games', 'review']) $('screen-' + s).hidden = (s !== name);
}

$('btn-new').onclick = () => { stopAnalysis(); show('search'); $('input-user').focus(); };
$('btn-back-search').onclick = () => show('search');

$('form-user').onsubmit = async e => {
  e.preventDefault();
  const name = $('input-user').value.trim();
  if (!name) return;
  const err = $('search-error');
  err.hidden = true;
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const { user, games } = await fetchRecentGames(name);
    renderGames(user, games);
    show('games');
  } catch (ex) {
    err.textContent = ex.message || 'Could not load those games.';
    err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Find games';
  }
};

$('form-pgn').onsubmit = e => {
  e.preventDefault();
  const pgn = $('input-pgn').value.trim();
  if (!pgn) return;
  try { startReview(pgn, null); }
  catch (ex) { const err = $('search-error'); err.textContent = 'That PGN could not be read.'; err.hidden = false; }
};

/* ─────────────────── game picker ─────────────────── */
function renderGames(user, games) {
  $('games-title').textContent = `Recent games — ${user}`;
  const list = $('games-list');
  list.innerHTML = '';
  games.forEach(g => {
    const s = summarise(g, user);
    const card = document.createElement('button');
    card.className = 'game-card';
    card.innerHTML = `
      <div class="game-tc">${s.timeControl}<br>${s.timeClass}</div>
      <div class="game-players">
        <span class="game-side"><i class="chip chip-w"></i>${esc(s.white.name)} <span class="game-elo">${s.white.rating ?? ''}</span></span>
        <span class="game-side"><i class="chip chip-b"></i>${esc(s.black.name)} <span class="game-elo">${s.black.rating ?? ''}</span></span>
      </div>
      <span class="game-res res-${s.result}">${s.result === 'win' ? 'Win' : s.result === 'loss' ? 'Loss' : 'Draw'}</span>
      <span class="game-date">${s.date ? s.date.toLocaleDateString() : ''}</span>`;
    card.onclick = () => startReview(s.pgn, s);
    list.appendChild(card);
  });
  if (!games.length) list.innerHTML = '<p class="games-empty">No games found.</p>';
}

/* ─────────────────── loading a game ─────────────────── */
function startReview(pgn, meta) {
  const c = new Chess();
  c.loadPgn(pgn);                       // throws on malformed PGN
  const history = c.history({ verbose: true });
  if (!history.length) throw new Error('empty game');

  const replay = new Chess();
  const moves = history.map(h => {
    const fenBefore = replay.fen();
    const mv = replay.move(h.san);
    return {
      san: mv.san,
      uci: mv.from + mv.to + (mv.promotion || ''),
      from: mv.from, to: mv.to, color: mv.color,
      piece: mv.piece, captured: mv.captured,
      fenBefore, fenAfter: replay.fen(),
    };
  });

  const headers = parseHeaders(pgn);
  state.chess = replay;
  state.moves = moves;
  state.evals = new Array(moves.length + 1).fill(null);
  state.reports = new Array(moves.length).fill(null);
  state.ply = 0;
  state.meta = meta || {
    white: { name: headers.White || 'White', rating: headers.WhiteElo },
    black: { name: headers.Black || 'Black', rating: headers.BlackElo },
  };
  state.meta.opening = headers.ECOUrl ? prettyOpening(headers.ECOUrl) : (headers.Opening || null);
  state.meta.eco = headers.ECO || null;
  state.flipped = meta ? !meta.meIsWhite : false;

  show('review');
  buildBoard();
  renderAll();
  runAnalysis();
}

function parseHeaders(pgn) {
  const h = {};
  for (const m of pgn.matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) h[m[1]] = m[2];
  return h;
}
function prettyOpening(url) {
  const slug = url.split('/').pop() || '';
  return slug.replace(/-/g, ' ').replace(/\s(\d)\s/g, ' $1.');
}

/* ─────────────────── board ─────────────────── */
function buildBoard() {
  const board = $('board');
  board.innerHTML = '';
  for (let i = 0; i < 64; i++) {
    const sq = document.createElement('div');
    sq.className = 'sq';
    board.appendChild(sq);
  }
}

function squareAt(index) {                       // index 0..63 in display order
  const r = Math.floor(index / 8), f = index % 8;
  const rank = state.flipped ? r + 1 : 8 - r;
  const file = state.flipped ? FILES[7 - f] : FILES[f];
  return file + rank;
}

function renderBoard() {
  const fen = state.ply === 0 ? state.moves[0].fenBefore : state.moves[state.ply - 1].fenAfter;
  const pos = new Chess(fen);
  const squares = $('board').children;
  const last = state.ply > 0 ? state.moves[state.ply - 1] : null;
  const rep = state.ply > 0 ? state.reports[state.ply - 1] : null;

  for (let i = 0; i < 64; i++) {
    const name = squareAt(i);
    const el = squares[i];
    const isLight = (FILES.indexOf(name[0]) + parseInt(name[1], 10)) % 2 === 1;
    el.className = 'sq ' + (isLight ? 'light' : 'dark');
    if (last && (name === last.from || name === last.to)) el.classList.add('hl');

    let html = '';
    const r = Math.floor(i / 8), f = i % 8;
    if (f === 0) html += `<span class="coord rank">${name[1]}</span>`;
    if (r === 7) html += `<span class="coord file">${name[0]}</span>`;

    const p = pos.get(name);
    if (p) html += `<span class="piece ${p.color}">${PIECE[p.type]}</span>`;
    if (rep && name === last.to) html += `<span class="badge">${icon(rep.cls, false)}</span>`;
    el.innerHTML = html;
  }
  drawArrow(rep);
}

function drawArrow(rep) {
  const svg = $('board-overlay');
  svg.innerHTML = '';
  if (!state.showArrow || !rep || !rep.bestUci) return;
  if (rep.cls === 'best' || rep.cls === 'brilliant' || rep.cls === 'great' || rep.cls === 'book') return;

  const from = rep.bestUci.slice(0, 2), to = rep.bestUci.slice(2, 4);
  const c = (sq) => {
    let f = FILES.indexOf(sq[0]), r = 8 - parseInt(sq[1], 10);
    if (state.flipped) { f = 7 - f; r = 7 - r; }
    return { x: f * 100 + 50, y: r * 100 + 50 };
  };
  const a = c(from), b = c(to);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const sx = a.x + ux * 28, sy = a.y + uy * 28;
  const ex = b.x - ux * 34, ey = b.y - uy * 34;
  svg.innerHTML = `
    <defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.4" markerHeight="4.4" orient="auto">
      <path d="M0 0 L10 5 L0 10 z" fill="#81b64c"/></marker></defs>
    <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#81b64c" stroke-width="15"
          stroke-linecap="round" marker-end="url(#ah)" opacity=".85"/>`;
}

/* ─────────────────── players, eval bar ─────────────────── */
function renderPlayers() {
  const m = state.meta;
  const topIsWhite = state.flipped;
  const top = topIsWhite ? m.white : m.black;
  const bot = topIsWhite ? m.black : m.white;
  const mat = materialDiff();

  const strip = (p, isWhite) => {
    const adv = isWhite ? mat : -mat;
    return `<span class="pavatar">${isWhite ? '♔' : '♚'}</span>
      <span class="pname">${esc(p.name)}</span>
      <span class="pelo">${p.rating ? '(' + p.rating + ')' : ''}</span>
      ${adv > 0 ? `<span class="padv">+${adv}</span>` : ''}`;
  };
  $('player-top').innerHTML = strip(top, topIsWhite);
  $('player-bottom').innerHTML = strip(bot, !topIsWhite);
}

function materialDiff() {
  const fen = state.ply === 0 ? state.moves[0].fenBefore : state.moves[state.ply - 1].fenAfter;
  const V = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let d = 0;
  for (const row of new Chess(fen).board()) for (const sq of row) {
    if (!sq) continue;
    d += (sq.color === 'w' ? 1 : -1) * (V[sq.type] || 0);
  }
  return d;
}

function currentCp() {
  const e = state.evals[state.ply];
  if (!e) return null;
  return e.cpWhite;
}

function renderEvalBar() {
  const cp = currentCp();
  const bar = $('evalbar');
  const fill = $('evalbar-white');
  const num = $('evalbar-num');
  if (cp === null) { fill.style.height = '50%'; num.textContent = '—'; bar.classList.remove('neg'); return; }
  const pct = winPct(cp);
  fill.style.height = pct.toFixed(1) + '%';
  const mateIn = state.evals[state.ply].mate;
  num.textContent = mateIn ? 'M' + Math.abs(mateIn) : (Math.abs(cp) / 100).toFixed(1);
  bar.classList.toggle('neg', cp < 0);
}

/* ─────────────────── move list ─────────────────── */
function renderMoves() {
  const list = $('movelist');
  list.innerHTML = '';
  for (let i = 0; i < state.moves.length; i += 2) {
    const num = document.createElement('div');
    num.className = 'mv-num';
    num.textContent = (i / 2 + 1) + '.';
    list.appendChild(num);
    for (const j of [i, i + 1]) {
      if (j >= state.moves.length) { const e = document.createElement('div'); e.className = 'mv empty'; list.appendChild(e); continue; }
      const rep = state.reports[j];
      const btn = document.createElement('button');
      btn.className = 'mv' + (state.ply === j + 1 ? ' current' : '');
      btn.dataset.ply = j + 1;
      btn.innerHTML = `<span>${state.moves[j].san}</span>${rep ? icon(rep.cls) : ''}`;
      btn.onclick = () => goto(j + 1);
      list.appendChild(btn);
    }
  }
  const cur = list.querySelector('.mv.current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function renderDetail() {
  const el = $('move-detail');
  if (state.ply === 0) { el.innerHTML = '<span>Starting position. Use ← and → to step through.</span>'; return; }
  const mv = state.moves[state.ply - 1];
  const rep = state.reports[state.ply - 1];
  if (!rep) { el.innerHTML = `<span>${mv.san} — not analysed yet.</span>`; return; }

  const evalTxt = fmtCp(rep.cpAfter);
  let best = '';
  if (!rep.isBest && rep.bestUci && rep.cls !== 'book') {
    const c = new Chess(mv.fenBefore);
    try {
      const bm = c.move({ from: rep.bestUci.slice(0, 2), to: rep.bestUci.slice(2, 4), promotion: rep.bestUci[4] || 'q' });
      if (bm) best = `Best was <b>${bm.san}</b>`;
    } catch (_) {}
  }
  el.innerHTML = `
    <div class="md-head">${icon(rep.cls)}<span class="md-name" style="color:${colorOf(rep.cls)}">${mv.san} is ${labelOf(rep.cls).toLowerCase()}</span></div>
    <div class="md-best">${evalTxt}${best ? ' · ' + best : ''}${rep.cls === 'book' ? ' · known theory' : ''}</div>`;
}

function fmtCp(cp) {
  if (cp === null || cp === undefined) return '';
  if (Math.abs(cp) > 9000) {
    const n = Math.round((10000 - Math.abs(cp)) / 10);
    return (cp > 0 ? 'White' : 'Black') + ' mates in ' + Math.max(1, n);
  }
  const v = (Math.abs(cp) / 100).toFixed(2);
  if (Math.abs(cp) < 20) return 'Equal (0.0)';
  return (cp > 0 ? 'White ' : 'Black ') + '+' + v;
}

/* ─────────────────── report panel ─────────────────── */
function renderReport() {
  const done = state.reports.filter(Boolean);
  if (!done.length) { $('report').hidden = true; return; }
  $('report').hidden = false;

  $('rep-white-name').textContent = state.meta.white.name;
  $('rep-black-name').textContent = state.meta.black.name;

  const accs = { w: [], b: [] };
  const counts = { w: {}, b: {} };
  state.reports.forEach((r, i) => {
    if (!r) return;
    const c = state.moves[i].color;
    accs[c].push(r.accuracy);
    counts[c][r.cls] = (counts[c][r.cls] || 0) + 1;
  });

  const aw = gameAccuracy(accs.w), ab = gameAccuracy(accs.b);
  $('acc-white').textContent = aw === null ? '—' : aw.toFixed(1);
  $('acc-black').textContent = ab === null ? '—' : ab.toFixed(1);
  $('rating-white').textContent = estimateRating(aw) ?? '—';
  $('rating-black').textContent = estimateRating(ab) ?? '—';

  const t = $('tallies');
  t.innerHTML = ORDER.map(cls => {
    const w = counts.w[cls] || 0, b = counts.b[cls] || 0;
    return `<div class="tally">
      <span class="tally-n ${w ? '' : 'zero'}" style="${w ? 'color:' + colorOf(cls) : ''}">${w}</span>
      <span class="tally-label">${icon(cls)}${labelOf(cls)}</span>
      <span class="tally-n ${b ? '' : 'zero'}" style="${b ? 'color:' + colorOf(cls) : ''}">${b}</span>
    </div>`;
  }).join('');

  const op = state.meta.opening;
  $('opening').innerHTML = op ? `Opening: <b>${esc(op)}</b>${state.meta.eco ? ' · ' + esc(state.meta.eco) : ''}` : '';
}

/* ─────────────────── evaluation timeline ─────────────────── */
function renderGraph() {
  const cv = $('graph');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 600, h = 110;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const n = state.moves.length;
  if (!n) return;
  const x = i => (i / n) * w;
  const y = cp => {
    const p = winPct(cp === null ? 0 : cp);      // 0..100, white's share
    return h - (p / 100) * h;
  };

  g.fillStyle = '#3a3733';
  g.fillRect(0, 0, w, h);

  // white's area
  g.beginPath();
  g.moveTo(0, h);
  for (let i = 0; i <= n; i++) {
    const e = state.evals[i];
    g.lineTo(x(i), y(e ? e.cpWhite : 0));
  }
  g.lineTo(w, h);
  g.closePath();
  g.fillStyle = '#e9e6e1';
  g.fill();

  g.strokeStyle = '#8c8a88';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();

  // one dot per move, coloured by classification
  for (let i = 0; i < n; i++) {
    const rep = state.reports[i];
    if (!rep) continue;
    if (['best', 'excellent', 'good', 'book'].includes(rep.cls)) continue;
    const e = state.evals[i + 1];
    g.beginPath();
    g.arc(x(i + 1), y(e ? e.cpWhite : 0), 3.4, 0, Math.PI * 2);
    g.fillStyle = colorOf(rep.cls);
    g.fill();
    g.lineWidth = 1; g.strokeStyle = '#00000055'; g.stroke();
  }

  // playhead
  g.strokeStyle = '#81b64c';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(x(state.ply), 0); g.lineTo(x(state.ply), h); g.stroke();
}

$('graph').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const frac = (e.clientX - r.left) / r.width;
  goto(Math.round(frac * state.moves.length));
});

/* ─────────────────── navigation ─────────────────── */
function goto(ply) {
  state.ply = Math.max(0, Math.min(state.moves.length, ply));
  renderAll();
}
function renderAll() {
  renderBoard(); renderPlayers(); renderEvalBar();
  renderMoves(); renderDetail(); renderReport(); renderGraph();
}

$('ctl-first').onclick = () => goto(0);
$('ctl-prev').onclick = () => goto(state.ply - 1);
$('ctl-next').onclick = () => goto(state.ply + 1);
$('ctl-last').onclick = () => goto(state.moves.length);
$('ctl-flip').onclick = () => { state.flipped = !state.flipped; renderAll(); };
$('ctl-arrow').onclick = e => { state.showArrow = !state.showArrow; e.currentTarget.classList.toggle('on', state.showArrow); renderBoard(); };
$('ctl-arrow').classList.add('on');

document.addEventListener('keydown', e => {
  if ($('screen-review').hidden) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === 'ArrowLeft') { goto(state.ply - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { goto(state.ply + 1); e.preventDefault(); }
  else if (e.key === 'Home') goto(0);
  else if (e.key === 'End') goto(state.moves.length);
  else if (e.key === 'f') { state.flipped = !state.flipped; renderAll(); }
  else if (e.key === 'a') $('ctl-arrow').click();
});

window.addEventListener('resize', () => { if (!$('screen-review').hidden) renderGraph(); });

$('depth-select').onchange = () => runAnalysis();

/* ─────────────────── analysis ─────────────────── */
function stopAnalysis() {
  state.running = false;
  if (state.pool) { state.pool.destroy(); state.pool = null; }
}

async function runAnalysis() {
  stopAnalysis();
  const depth = parseInt($('depth-select').value, 10);
  const n = state.moves.length;
  state.evals = new Array(n + 1).fill(null);
  state.reports = new Array(n).fill(null);
  state.running = true;

  const prog = $('progress'), fill = $('progress-fill'), text = $('progress-text');
  prog.hidden = false;
  fill.style.width = '0%';
  text.textContent = 'Starting Stockfish…';

  const pool = new EnginePool(3);
  state.pool = pool;
  await pool.warmUp();
  if (!state.running) return;

  const positions = [];
  for (let i = 0; i <= n; i++) {
    const fen = i === 0 ? state.moves[0].fenBefore : state.moves[i - 1].fenAfter;
    positions.push(fen);
  }

  let done = 0;
  const results = new Array(n + 1);
  await Promise.all(positions.map(async (fen, i) => {
    const c = new Chess(fen);
    let res;
    if (c.isGameOver()) {
      const stm = fen.split(' ')[1];
      let cp = 0;
      if (c.isCheckmate()) cp = stm === 'w' ? -10000 : 10000;   // side to move is mated
      res = { best: null, lines: [], terminal: true, terminalCpWhite: cp };
    } else {
      res = await pool.analyse(fen, depth);
    }
    if (!state.running) return;
    results[i] = res;

    const stm = fen.split(' ')[1];
    const cpWhite = res.terminal ? res.terminalCpWhite
                                 : (res.lines[0] ? toWhiteCp(res.lines[0], stm) : 0);
    const mate = (!res.terminal && res.lines[0] && res.lines[0].mate != null) ? res.lines[0].mate : null;
    state.evals[i] = { cpWhite, mate: mate === null ? null : (stm === 'w' ? mate : -mate) };

    done++;
    fill.style.width = Math.round((done / (n + 1)) * 100) + '%';
    text.textContent = `Analysing… ${done} / ${n + 1} positions`;

    // classify any move whose two neighbouring positions are both ready
    for (const idx of [i - 1, i]) {
      if (idx < 0 || idx >= n) continue;
      if (state.reports[idx] || !results[idx] || !results[idx + 1]) continue;
      state.reports[idx] = buildReport(idx, results[idx], results[idx + 1]);
    }
    if (done % 4 === 0 || done === n + 1) { renderMoves(); renderGraph(); renderReport(); renderEvalBar(); }
  }));

  if (!state.running) return;
  for (let idx = 0; idx < n; idx++) {
    if (!state.reports[idx] && results[idx] && results[idx + 1]) {
      state.reports[idx] = buildReport(idx, results[idx], results[idx + 1]);
    }
  }
  state.running = false;
  prog.hidden = true;
  renderAll();
  pool.destroy();
  state.pool = null;
}

function buildReport(idx, before, after) {
  const mv = state.moves[idx];
  const stmAfter = mv.fenAfter.split(' ')[1];
  return classifyMove({
    before: { fen: mv.fenBefore, sideToMove: mv.color, best: before.best, lines: before.lines },
    after: {
      fen: mv.fenAfter,
      lines: after.lines,
      terminalCp: after.terminal ? after.terminalCpWhite : undefined,
    },
    uci: mv.uci,
    san: mv.san,
    sansSoFar: state.moves.slice(0, idx + 1).map(m => m.san),
  });
}

/* ─────────────────── util ─────────────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// deep-link: ?user=name
const params = new URLSearchParams(location.search);
if (params.get('user')) { $('input-user').value = params.get('user'); $('form-user').requestSubmit(); }
else $('input-user').focus();
