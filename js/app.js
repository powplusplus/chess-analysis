import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { EnginePool, prefetchEngine, ENGINE_MODES } from './engine.js';
import { icon, colorOf, labelOf } from './icons.js';
import { classifyMove, gameAccuracy, estimateRating, toWhiteCp, winPct } from './classify.js';
import { fetchRecentGames, fetchPlayers, summarise, gameIdFromUrl } from './chesscom.js';
import { pieceSvg } from './pieces.js';
import {
  askCoach, buildGameOverviewPrompt, buildMovePrompt,
  summariseTallies, criticalMoments, moveLine, fmtCpShort,
} from './coach.js';
import { playMoveSound, stopAllMoveSounds, prefetchSounds } from './sounds.js';
import { synthesizeCoachSpeech, splitTtsChunks } from './tts.js';
import { APP_VERSION } from './version.js';

const $ = id => document.getElementById(id);
const VERSION_STORE = 'mcr-version';
const FILES = 'abcdefgh';
const ANIM_MS = 160;

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
  poolMode: null,
  running: false,
  talliesExpanded: false,
  tallyCursor: {},  // key -> move index last jumped to
  animating: false,
  analysisToken: 0,
  coachAbort: null,
  coachCache: new Map(),
  coachReqId: 0,
  coachBusy: false,
  coachTargetKey: null,
  coachSpeakId: 0,
  coachAudio: null,     // HTMLAudioElement for neural TTS
  coachTtsAbort: null,
  user: null,           // chess.com username for current games list
  games: [],            // raw games from last fetch
  gameId: null,         // chess.com game id when reviewing
  pgnLocal: false,      // reviewing a pasted PGN
  autoplay: false,
  autoplayTimer: null,
  autoplayGen: 0,       // bump on stop → drop in-flight ticks
  animCancel: null,     // resolve/cancel current piece flyer
};

// Chess.com highlights: primary rows always visible; rest behind "Show more"
const TALLY_PRIMARY = ['brilliant', 'great', 'best', 'mistake', 'miss', 'blunder'];
const TALLY_SECONDARY = ['excellent', 'good', 'book', 'inaccuracy'];

/* ─────────────────── screens + URL routing ─────────────────── */
const PGN_STORE = 'mcr-pgn';

function show(name) {
  for (const s of ['search', 'games', 'review']) $('screen-' + s).hidden = (s !== name);
  document.body.classList.toggle('reviewing', name === 'review');
}

function readRoute() {
  const p = new URLSearchParams(location.search);
  const user = (p.get('user') || '').trim().toLowerCase() || null;
  const game = (p.get('game') || '').trim() || null;
  const plyRaw = p.get('ply');
  const ply = plyRaw != null && plyRaw !== '' ? parseInt(plyRaw, 10) : null;
  return {
    user,
    game,
    ply: Number.isFinite(ply) && ply >= 0 ? ply : null,
    pgn: p.get('pgn') === '1',
  };
}

function buildUrl(params) {
  const sp = new URLSearchParams();
  if (params.user) sp.set('user', params.user);
  if (params.game) sp.set('game', params.game);
  if (params.pgn) sp.set('pgn', '1');
  if (params.ply != null && params.ply > 0) sp.set('ply', String(params.ply));
  const qs = sp.toString();
  return qs ? `${location.pathname}?${qs}` : (location.pathname || './');
}

function setUrl(params, { replace = false } = {}) {
  const url = buildUrl(params);
  const cur = location.pathname + location.search;
  if (url === cur || url === cur.replace(/\/$/, '') || cur === url.replace(/\/$/, '')) {
    if (replace) history.replaceState(null, '', url);
    return;
  }
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

function setTitle(route) {
  if (route.game && route.user) document.title = `Game ${route.game} · ${route.user} · MCR`;
  else if (route.pgn) document.title = 'PGN review · MCR';
  else if (route.user) document.title = `${route.user} · MCR`;
  else document.title = 'MCR - Magnus Chess Review';
}

function syncPlyUrl() {
  const r = readRoute();
  if (!r.game && !r.pgn) return;
  setUrl({
    user: r.user,
    game: r.game,
    pgn: r.pgn,
    ply: state.ply > 0 ? state.ply : null,
  }, { replace: true });
}

function goHome() {
  stopAnalysis();
  state.user = null;
  state.games = [];
  state.gameId = null;
  state.pgnLocal = false;
  try { sessionStorage.removeItem(PGN_STORE); } catch (_) {}
  setUrl({}, { replace: true });
  setTitle({});
  show('search');
  $('input-user').focus();
}

let routeToken = 0;

async function ensureGames(user) {
  if (state.user === user && state.games.length) return state.games;
  const { user: u, games } = await fetchRecentGames(user);
  state.user = u;
  state.games = games;
  return games;
}

async function applyRoute() {
  const token = ++routeToken;
  const route = readRoute();
  setTitle(route);

  if (route.pgn) {
    let pgn = null;
    try { pgn = sessionStorage.getItem(PGN_STORE); } catch (_) {}
    if (!pgn) { goHome(); return; }
    if (!state.pgnLocal || !state.moves.length) startReview(pgn, null, { localPgn: true });
    else show('review');
    if (token !== routeToken) return;
    if (route.ply != null) await goto(route.ply, { animate: false, skipUrl: true, sound: false });
    return;
  }

  if (route.user && route.game) {
    $('input-user').value = route.user;
    const err = $('search-error');
    err.hidden = true;
    try {
      const games = await ensureGames(route.user);
      if (token !== routeToken) return;
      renderGames(route.user, games);
      const hit = games.map(g => summarise(g, route.user)).find(s => s.id === route.game);
      if (!hit) {
        show('games');
        const list = $('games-list');
        const note = document.createElement('p');
        note.className = 'games-empty';
        note.textContent = `Game ${route.game} not in recent games for ${route.user}.`;
        list.prepend(note);
        return;
      }
      if (state.gameId !== route.game || !state.moves.length) startReview(hit.pgn, hit);
      else show('review');
      if (token !== routeToken) return;
      if (route.ply != null) await goto(route.ply, { animate: false, skipUrl: true, sound: false });
    } catch (ex) {
      if (token !== routeToken) return;
      show('search');
      err.textContent = ex.message || 'Could not load those games.';
      err.hidden = false;
    }
    return;
  }

  if (route.user) {
    $('input-user').value = route.user;
    const err = $('search-error');
    err.hidden = true;
    stopAnalysis();
    state.gameId = null;
    state.pgnLocal = false;
    try {
      const games = await ensureGames(route.user);
      if (token !== routeToken) return;
      renderGames(route.user, games);
      show('games');
    } catch (ex) {
      if (token !== routeToken) return;
      show('search');
      err.textContent = ex.message || 'Could not load those games.';
      err.hidden = false;
    }
    return;
  }

  stopAnalysis();
  state.user = null;
  state.games = [];
  state.gameId = null;
  state.pgnLocal = false;
  show('search');
  $('input-user').focus();
}

$('btn-new').onclick = goHome;
$('btn-back-search').onclick = () => goHome();

$('form-user').onsubmit = async e => {
  e.preventDefault();
  const name = $('input-user').value.trim();
  if (!name) return;
  const err = $('search-error');
  err.hidden = true;
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const user = name.toLowerCase();
    const games = await ensureGames(user);
    renderGames(user, games);
    show('games');
    setUrl({ user });
    setTitle({ user });
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
  try {
    sessionStorage.setItem(PGN_STORE, pgn);
    startReview(pgn, null, { localPgn: true });
    setUrl({ pgn: true });
    setTitle({ pgn: true });
  } catch (ex) {
    const err = $('search-error');
    err.textContent = 'That PGN could not be read.';
    err.hidden = false;
  }
};

/* ─────────────────── titles + avatars ─────────────────── */
function titleBadge(title) {
  return title ? `<span class="chess-title">${esc(title)}</span>` : '';
}

function avatarHtml(p, isWhite, cls = 'pavatar') {
  if (p?.avatar) {
    return `<span class="${cls}"><img src="${esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
  }
  return `<span class="${cls}"><span class="mini-piece">${pieceSvg(isWhite ? 'w' : 'b', 'k')}</span></span>`;
}

function playerNameHtml(p) {
  return `${titleBadge(p.title)}<span class="pname">${esc(p.name)}</span>`;
}

async function enrichSide(side) {
  if (!side?.name) return side;
  const map = await fetchPlayers([side.name]);
  const p = map.get(side.name.toLowerCase());
  if (!p) return side;
  return {
    ...side,
    title: side.title || p.title || null,
    avatar: side.avatar || p.avatar || null,
  };
}

async function enrichMetaPlayers(meta) {
  if (!meta) return meta;
  const [white, black] = await Promise.all([enrichSide(meta.white), enrichSide(meta.black)]);
  return { ...meta, white, black };
}

/* ─────────────────── game picker ─────────────────── */
async function renderGames(user, games) {
  $('games-title').textContent = `Recent games - ${user}`;
  const list = $('games-list');
  list.innerHTML = '';
  if (!games.length) {
    list.innerHTML = '<p class="games-empty">No games found.</p>';
    return;
  }

  const summaries = games.map(g => summarise(g, user));
  const paint = () => {
    list.innerHTML = '';
    summaries.forEach(s => {
      const card = document.createElement('button');
      card.className = 'game-card';
      card.innerHTML = `
        <div class="game-tc">${s.timeControl}<br>${s.timeClass}</div>
        <div class="game-players">
          <span class="game-side">${avatarHtml(s.white, true, 'gavatar')}${titleBadge(s.white.title)}<span class="pname">${esc(s.white.name)}</span> <span class="game-elo">${s.white.rating ?? ''}</span></span>
          <span class="game-side">${avatarHtml(s.black, false, 'gavatar')}${titleBadge(s.black.title)}<span class="pname">${esc(s.black.name)}</span> <span class="game-elo">${s.black.rating ?? ''}</span></span>
        </div>
        <span class="game-res res-${s.result}">${s.result === 'win' ? 'Win' : s.result === 'loss' ? 'Loss' : 'Draw'}</span>
        <span class="game-date">${s.date ? s.date.toLocaleDateString() : ''}</span>`;
      card.onclick = () => {
        if (!s.id) return;
        startReview(s.pgn, s);
        setUrl({ user, game: s.id });
        setTitle({ user, game: s.id });
      };
      list.appendChild(card);
    });
  };

  paint();

  const names = summaries.flatMap(s => [s.white.name, s.black.name]);
  const profiles = await fetchPlayers(names);
  let changed = false;
  for (const s of summaries) {
    for (const side of ['white', 'black']) {
      const p = profiles.get(String(s[side].name || '').toLowerCase());
      if (!p) continue;
      if (s[side].title !== p.title || s[side].avatar !== p.avatar) {
        s[side] = { ...s[side], title: p.title || null, avatar: p.avatar || null };
        changed = true;
      }
    }
  }
  if (changed) paint();
}

/* ─────────────────── loading a game ─────────────────── */
function startReview(pgn, meta, opts = {}) {
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
    white: {
      name: headers.White || 'White',
      rating: headers.WhiteElo,
      title: headers.WhiteTitle || null,
    },
    black: {
      name: headers.Black || 'Black',
      rating: headers.BlackElo,
      title: headers.BlackTitle || null,
    },
  };
  if (!state.meta.white.title && headers.WhiteTitle) state.meta.white.title = headers.WhiteTitle;
  if (!state.meta.black.title && headers.BlackTitle) state.meta.black.title = headers.BlackTitle;
  state.meta.opening = headers.ECOUrl ? prettyOpening(headers.ECOUrl) : (headers.Opening || null);
  state.meta.eco = headers.ECO || null;
  state.flipped = meta ? !meta.meIsWhite : false;
  state.talliesExpanded = false;
  state.tallyCursor = {};
  state.coachCache = new Map();
  if (state.coachAbort) { state.coachAbort.abort(); state.coachAbort = null; }
  state.coachBusy = false;
  state.coachTargetKey = null;
  stopCoachSpeech();
  stopAutoplay();
  state.gameId = meta?.id || gameIdFromUrl(meta?.url) || null;
  state.pgnLocal = !!opts.localPgn;

  show('review');
  buildBoard();
  renderAll();
  setCoachPlaceholder('Engine analysing. Press Analyze when the report is ready.');
  runAnalysis();

  const gameToken = state.gameId || state.meta.white.name + '|' + state.meta.black.name;
  enrichMetaPlayers(state.meta).then(enriched => {
    if (!state.meta) return;
    const cur = state.gameId || state.meta.white.name + '|' + state.meta.black.name;
    if (cur !== gameToken) return;
    state.meta = enriched;
    renderPlayers();
    if (!$('report').hidden) renderReport();
  });
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

function renderBoard(opts = {}) {
  const skip = new Set(opts.skipPiecesOn || (opts.skipPieceOn ? [opts.skipPieceOn] : []));
  const fen = state.ply === 0 ? state.moves[0].fenBefore : state.moves[state.ply - 1].fenAfter;
  const pos = new Chess(fen);
  const squares = $('board').children;
  const last = state.ply > 0 ? state.moves[state.ply - 1] : null;
  const rep = state.ply > 0 ? state.reports[state.ply - 1] : null;

  for (let i = 0; i < 64; i++) {
    const name = squareAt(i);
    const el = squares[i];
    // a1 is dark - (fileIndex + rank) even ⇒ light
    const isLight = (FILES.indexOf(name[0]) + parseInt(name[1], 10)) % 2 === 0;
    el.className = 'sq ' + (isLight ? 'light' : 'dark');
    if (last && (name === last.from || name === last.to)) el.classList.add('hl');

    let html = '';
    const r = Math.floor(i / 8), f = i % 8;
    if (f === 0) html += `<span class="coord rank">${name[1]}</span>`;
    if (r === 7) html += `<span class="coord file">${name[0]}</span>`;

    const p = pos.get(name);
    if (p && !skip.has(name)) html += `<span class="piece-wrap">${pieceSvg(p.color, p.type)}</span>`;
    if (rep && name === last.to && !skip.has(name)) html += `<span class="badge">${icon(rep.cls, false)}</span>`;
    el.innerHTML = html;
  }
  drawArrow(skip.size ? null : rep);
}

function sqCenter(sq) {
  const board = $('board').getBoundingClientRect();
  let f = FILES.indexOf(sq[0]), r = 8 - parseInt(sq[1], 10);
  if (state.flipped) { f = 7 - f; r = 7 - r; }
  const size = board.width / 8;
  return {
    x: board.left + f * size + size / 2,
    y: board.top + r * size + size / 2,
    size,
  };
}

function animatePlyChange(fromPly, toPly) {
  if (Math.abs(toPly - fromPly) !== 1) return Promise.resolve();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();

  const forward = toPly > fromPly;
  const mv = state.moves[forward ? toPly - 1 : fromPly - 1];
  if (!mv) return Promise.resolve();

  const from = forward ? mv.from : mv.to;
  const to = forward ? mv.to : mv.from;
  const a = sqCenter(from), b = sqCenter(to);
  if (!a.size) return Promise.resolve();

  // Paint pre-move FEN so a captured piece stays until the flyer lands.
  // Only hide the mover on its origin square.
  const savedPly = state.ply;
  state.ply = Math.min(fromPly, toPly);
  renderBoard({ skipPiecesOn: [mv.from] });
  state.ply = savedPly;

  const flyer = document.createElement('div');
  flyer.className = 'piece-flyer';
  flyer.innerHTML = pieceSvg(mv.color, mv.piece);
  const half = a.size / 2;
  flyer.style.width = a.size + 'px';
  flyer.style.height = a.size + 'px';
  flyer.style.left = (a.x - half) + 'px';
  flyer.style.top = (a.y - half) + 'px';
  document.body.appendChild(flyer);

  // Force layout, then slide
  flyer.getBoundingClientRect();
  flyer.style.transition = `transform ${ANIM_MS}ms cubic-bezier(.2,.7,.2,1)`;
  flyer.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px)`;

  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      flyer.remove();
      if (state.animCancel === done) state.animCancel = null;
      resolve();
    };
    state.animCancel = done;
    flyer.addEventListener('transitionend', done, { once: true });
    const timer = setTimeout(done, ANIM_MS + 40);
  });
}

function cancelPieceAnim() {
  if (state.animCancel) state.animCancel();
  state.animating = false;
}

function drawArrow(rep) {
  const svg = $('board-overlay');
  svg.innerHTML = '';
  // Hide when you played engine best (or book). Near-best (cls=best, !isBest)
  // still gets an arrow — matches detail "Best was …".
  if (!state.showArrow || !rep || !rep.bestUci) return;
  if (rep.isBest || rep.cls === 'book') return;

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
      <path d="M0 0 L10 5 L0 10 z" fill="#9fcf3f"/></marker></defs>
    <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#9fcf3f" stroke-width="15"
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
    return `${avatarHtml(p, isWhite)}
      ${playerNameHtml(p)}
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
  const fill = $('evalbar-fill');
  const num = $('evalbar-num');
  bar.classList.toggle('flipped', state.flipped);
  if (cp === null) {
    fill.style.height = '50%';
    num.textContent = '-';
    bar.classList.remove('neg');
    return;
  }
  // fill always measures white's share; flipped bar grows from top instead
  const pct = winPct(cp);
  fill.style.height = pct.toFixed(1) + '%';
  const mateIn = state.evals[state.ply].mate;
  num.textContent = mateIn ? 'M' + Math.abs(mateIn) : (Math.abs(cp) / 100).toFixed(1);
  bar.classList.toggle('neg', state.flipped ? cp > 0 : cp < 0);
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
  if (!rep) { el.innerHTML = `<span>${mv.san} - not analysed yet.</span>`; return; }

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
function jumpToClass(cls, color) {
  const idxs = [];
  state.reports.forEach((r, i) => {
    if (!r || r.cls !== cls) return;
    if (color && state.moves[i].color !== color) return;
    idxs.push(i);
  });
  if (!idxs.length) return;

  const key = cls + ':' + (color || '*');
  const cur = state.tallyCursor[key];
  let next;
  // First click (or after leaving this class) → earliest matching move
  if (cur === undefined || !idxs.includes(cur)) {
    next = idxs[0];
  } else {
    next = idxs[(idxs.indexOf(cur) + 1) % idxs.length];
  }
  state.tallyCursor[key] = next;
  setSideTab('moves');
  goto(next + 1, { animate: false });

  document.querySelectorAll('.tally.active').forEach(el => el.classList.remove('active'));
  const row = document.querySelector(`.tally[data-cls="${cls}"]`);
  if (row) row.classList.add('active');
}

function renderReport() {
  const done = state.reports.filter(Boolean);
  if (!done.length) {
    $('report').hidden = true;
    $('tally-more').hidden = true;
    return;
  }
  $('report').hidden = false;

  $('rep-white-name').innerHTML = `${avatarHtml(state.meta.white, true, 'ravatar')}${playerNameHtml(state.meta.white)}`;
  $('rep-black-name').innerHTML = `${avatarHtml(state.meta.black, false, 'ravatar')}${playerNameHtml(state.meta.black)}`;

  const accs = { w: [], b: [] };
  const counts = { w: {}, b: {} };
  state.reports.forEach((r, i) => {
    if (!r) return;
    const c = state.moves[i].color;
    accs[c].push(r.accuracy);
    counts[c][r.cls] = (counts[c][r.cls] || 0) + 1;
  });

  const aw = gameAccuracy(accs.w), ab = gameAccuracy(accs.b);
  $('acc-white').textContent = aw === null ? '-' : aw.toFixed(1);
  $('acc-black').textContent = ab === null ? '-' : ab.toFixed(1);
  $('rating-white').textContent = estimateRating(aw) ?? '-';
  $('rating-black').textContent = estimateRating(ab) ?? '-';

  const order = [...TALLY_PRIMARY.slice(0, 3), ...TALLY_SECONDARY, ...TALLY_PRIMARY.slice(3)];
  // Chess.com order: Brilliant, Great, Best, [Excellent, Good, Book, Inaccuracy], Mistake, Miss, Blunder
  const t = $('tallies');
  t.innerHTML = '';
  for (const cls of order) {
    const w = counts.w[cls] || 0, b = counts.b[cls] || 0;
    const row = document.createElement('div');
    row.className = 'tally';
    row.dataset.cls = cls;

    const nW = document.createElement('button');
    nW.type = 'button';
    nW.className = 'tally-n' + (w ? '' : ' zero');
    nW.textContent = w;
    if (w) nW.style.color = colorOf(cls);
    nW.disabled = !w;
    nW.title = w ? `Show ${labelOf(cls).toLowerCase()} moves for White` : '';
    nW.onclick = e => { e.stopPropagation(); jumpToClass(cls, 'w'); };

    const label = document.createElement('span');
    label.className = 'tally-label';
    label.innerHTML = `${icon(cls)}${labelOf(cls)}`;

    const nB = document.createElement('button');
    nB.type = 'button';
    nB.className = 'tally-n' + (b ? '' : ' zero');
    nB.textContent = b;
    if (b) nB.style.color = colorOf(cls);
    nB.disabled = !b;
    nB.title = b ? `Show ${labelOf(cls).toLowerCase()} moves for Black` : '';
    nB.onclick = e => { e.stopPropagation(); jumpToClass(cls, 'b'); };

    row.title = `Show ${labelOf(cls).toLowerCase()} moves`;
    row.onclick = () => jumpToClass(cls, null);

    row.append(nW, label, nB);
    t.appendChild(row);
  }

  $('tally-more').hidden = true;

  const op = state.meta.opening;
  $('opening').innerHTML = op ? `Opening: <b>${esc(op)}</b>${state.meta.eco ? ' · ' + esc(state.meta.eco) : ''}` : '';
}

/* ─────────────────── evaluation timeline ─────────────────── */
function renderGraph() {
  const cv = $('graph');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 360, h = 72;
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

  const anyEval = state.evals.some(Boolean);
  if (!anyEval) {
    // Placeholder while engine warms / analyses - not a dead black box
    g.fillStyle = '#d8d5d0';
    g.fillRect(0, h * 0.5, w, h * 0.5);
    g.strokeStyle = '#8c8a88';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.fillStyle = '#9b9590';
    g.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
    g.textAlign = 'center';
    g.fillText(state.running ? 'Analysing…' : 'Evaluation', w / 2, h / 2 - 8);
    g.strokeStyle = '#81b64c';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x(state.ply), 0); g.lineTo(x(state.ply), h); g.stroke();
    return;
  }

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
  setSideTab('moves');
  goto(Math.round(frac * state.moves.length));
});

/* ─────────────────── navigation ─────────────────── */
async function goto(ply, opts = {}) {
  const { animate = true, skipUrl = false, sound = true } = opts;
  const next = Math.max(0, Math.min(state.moves.length, ply));
  const prev = state.ply;
  if (next === prev) { renderAll(); return; }

  stopCoachSpeech();

  // Chess.com move click only on single-ply steps (scrub/jump stays quiet).
  if (sound && Math.abs(next - prev) === 1) {
    const mv = state.moves[Math.max(prev, next) - 1];
    playMoveSound(mv);
  }

  if (animate && !state.animating && Math.abs(next - prev) === 1) {
    state.animating = true;
    state.ply = next;
    try { await animatePlyChange(prev, next); }
    finally { state.animating = false; }
    renderAll();
    if (!skipUrl) syncPlyUrl();
    return;
  }

  state.ply = next;
  renderAll();
  if (!skipUrl) syncPlyUrl();
}
function renderAll() {
  renderBoard(); renderPlayers(); renderEvalBar();
  renderMoves(); renderDetail(); renderReport(); renderGraph();
  syncNavControls();
  syncCoachUi();
}

function syncNavControls() {
  const atStart = state.ply <= 0;
  const atEnd = state.ply >= state.moves.length;
  const setDis = (id, on) => {
    const el = $(id);
    if (!el) return;
    el.disabled = on;
    el.classList.toggle('ctl-disabled', on);
  };
  setDis('ctl-first', atStart);
  setDis('ctl-prev', atStart);
  setDis('ctl-next', atEnd);
  setDis('ctl-last', atEnd);
  if (state.autoplay && atEnd) stopAutoplay();
}

function setPlayIcon(playing) {
  const btn = $('ctl-play');
  if (!btn) return;
  const playIco = btn.querySelector('.ctl-ico-play');
  const pauseIco = btn.querySelector('.ctl-ico-pause');
  // SVGElement.hidden often won't sync the [hidden] attribute → CSS stays stale.
  if (playIco) playIco.toggleAttribute('hidden', !!playing);
  if (pauseIco) pauseIco.toggleAttribute('hidden', !playing);
  btn.classList.toggle('playing', !!playing);
  btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
  btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  btn.title = playing ? 'Pause (Space)' : 'Play (Space)';
}

function stopAutoplay() {
  state.autoplay = false;
  state.autoplayGen++;
  if (state.autoplayTimer) {
    clearTimeout(state.autoplayTimer);
    state.autoplayTimer = null;
  }
  stopAllMoveSounds();
  if (state.animating) {
    cancelPieceAnim();
    renderAll();
  }
  setPlayIcon(false);
}

async function autoplayStep(gen) {
  if (!state.autoplay || gen !== state.autoplayGen) return;
  if (state.animating) {
    state.autoplayTimer = setTimeout(() => autoplayStep(gen), 50);
    return;
  }
  if (state.ply >= state.moves.length) { stopAutoplay(); return; }
  await goto(state.ply + 1);
  if (!state.autoplay || gen !== state.autoplayGen) return;
  state.autoplayTimer = setTimeout(() => autoplayStep(gen), 900);
}

function startAutoplay() {
  if (!state.moves.length) return;
  if (state.ply >= state.moves.length) goto(0, { animate: false, sound: false });
  state.autoplay = true;
  state.autoplayGen++;
  const gen = state.autoplayGen;
  setPlayIcon(true);
  if (state.autoplayTimer) {
    clearTimeout(state.autoplayTimer);
    state.autoplayTimer = null;
  }
  // Step once now — setTimeout alone waits a full period before first move.
  autoplayStep(gen);
}

function toggleAutoplay() {
  if (state.autoplay) stopAutoplay();
  else startAutoplay();
}

/* ─────────────────── coach overview ─────────────────── */
function stopCoachSpeech() {
  state.coachSpeakId++;
  if (state.coachTtsAbort) {
    try { state.coachTtsAbort.abort(); } catch { /* ignore */ }
    state.coachTtsAbort = null;
  }
  if (state.coachAudio) {
    try {
      state.coachAudio.pause();
      state.coachAudio.removeAttribute('src');
      state.coachAudio.load();
    } catch { /* ignore */ }
    state.coachAudio = null;
  }
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  } catch { /* ignore */ }
}

function speakCoachBrowser(spoken, id) {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
  const u = new SpeechSynthesisUtterance(spoken);
  u.rate = 0.96;
  u.pitch = 0.92;
  // Prefer a deeper en voice if available (still a fallback).
  try {
    const voices = speechSynthesis.getVoices() || [];
    const pick = voices.find(v => /en(-|_)?(GB|US|AU)/i.test(v.lang) && /male|daniel|george|alex|david|fred/i.test(v.name))
      || voices.find(v => /^en/i.test(v.lang));
    if (pick) u.voice = pick;
  } catch { /* ignore */ }
  setTimeout(() => {
    if (id !== state.coachSpeakId) return;
    try { speechSynthesis.speak(u); } catch { /* ignore */ }
  }, 40);
}

function playCoachBlob(blob, id) {
  return new Promise((resolve, reject) => {
    if (id !== state.coachSpeakId) {
      resolve();
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    state.coachAudio = audio;
    const done = (err) => {
      URL.revokeObjectURL(url);
      if (state.coachAudio === audio) state.coachAudio = null;
      if (err) reject(err);
      else resolve();
    };
    audio.onended = () => done();
    audio.onerror = () => done(new Error('audio play failed'));
    audio.play().catch(done);
  });
}

async function speakCoach(text) {
  stopCoachSpeech();
  const spoken = String(text || '').replace(/\s+/g, ' ').trim();
  if (!spoken) return;
  const id = state.coachSpeakId;
  const ac = new AbortController();
  state.coachTtsAbort = ac;

  try {
    // First short chunk → audio ASAP; prefetch next while playing.
    const chunks = splitTtsChunks(spoken);
    let nextP = synthesizeCoachSpeech(chunks[0], ac.signal);
    for (let i = 0; i < chunks.length; i++) {
      if (id !== state.coachSpeakId) return;
      const blob = await nextP;
      if (id !== state.coachSpeakId) return;
      if (i + 1 < chunks.length) {
        nextP = synthesizeCoachSpeech(chunks[i + 1], ac.signal);
      }
      await playCoachBlob(blob, id);
    }
  } catch (ex) {
    if (ex.name === 'AbortError' || id !== state.coachSpeakId) return;
    // Neural TTS unavailable → last-resort browser voice
    speakCoachBrowser(spoken, id);
  } finally {
    if (state.coachTtsAbort === ac) state.coachTtsAbort = null;
  }
}

function setCoachPlaceholder(msg, isErr = false) {
  const body = $('coach-body');
  body.classList.toggle('thinking', !isErr);
  body.innerHTML = `<p class="${isErr ? 'coach-err' : 'coach-placeholder'}">${esc(msg)}</p>`;
}

function setCoachGenerating() {
  const body = $('coach-body');
  body.classList.add('thinking');
  body.innerHTML = `<div class="coach-skel" aria-busy="true" aria-label="Coach generating">
    <div class="coach-skel-line"></div>
    <div class="coach-skel-line"></div>
    <div class="coach-skel-line"></div>
    <div class="coach-skel-line"></div>
    <div class="coach-skel-line"></div>
    <div class="coach-skel-line"></div>
  </div>`;
}

function setCoachText(text) {
  const body = $('coach-body');
  body.classList.remove('thinking');
  const paras = String(text).trim().split(/\n+/).map(s => s.trim()).filter(Boolean);
  body.innerHTML = paras.length
    ? paras.map(p => `<p>${esc(p)}</p>`).join('')
    : '<p class="coach-placeholder">No note from coach.</p>';
}

function coachSubtitle() {
  const side = meSide();
  const seat = side === 'w' ? 'White' : side === 'b' ? 'Black' : null;
  if (state.ply === 0) return seat ? `Game overview · ${seat}` : 'Game overview';
  const mv = state.moves[state.ply - 1];
  const num = Math.floor((state.ply - 1) / 2) + 1;
  const dots = (state.ply - 1) % 2 === 0 ? '' : '...';
  const moveBit = `Move ${num}${dots ? '…' : '.'} ${mv.san}`;
  return seat ? `${moveBit} · ${seat}` : moveBit;
}

function meSide() {
  // Prefer Chess.com seat when known; else side at bottom of board.
  if (state.meta && state.meta.meIsWhite != null) {
    return state.meta.meIsWhite ? 'w' : 'b';
  }
  if (!state.moves.length) return null;
  return state.flipped ? 'b' : 'w';
}

function analysisReady() {
  return !state.running && state.reports.length && state.reports.every(Boolean);
}

function coachCacheKey() {
  return state.analysisToken + ':' + state.ply + ':' + (meSide() || '-');
}

function syncCoachUi() {
  $('coach-sub').textContent = coachSubtitle();
  const btn = $('btn-coach-analyze');
  const key = coachCacheKey();

  // Scrub away mid-request -> cancel. Cache keeps finished replies.
  if (state.coachBusy && state.coachTargetKey && state.coachTargetKey !== key) {
    if (state.coachAbort) { state.coachAbort.abort(); state.coachAbort = null; }
    state.coachBusy = false;
    state.coachTargetKey = null;
    state.coachReqId++;
    stopCoachSpeech();
  }

  const ready = analysisReady() && state.moves.length > 0;
  btn.disabled = !ready || state.coachBusy;

  if (!state.moves.length) {
    setCoachPlaceholder('Load a game to get coaching.');
    return;
  }
  if (!analysisReady()) {
    setCoachPlaceholder(state.running
      ? 'Engine analysing. Press Analyze when the report is ready.'
      : 'Finish engine analysis first, then press Analyze.');
    return;
  }

  if (state.coachCache.has(key)) {
    setCoachText(state.coachCache.get(key));
    return;
  }
  if (state.coachBusy) {
    setCoachGenerating();
    return;
  }
  setCoachPlaceholder(state.ply === 0
    ? 'Press Analyze for a game overview.'
    : 'Press Analyze for coaching on this move.');
}

async function runCoachAnalyze() {
  if (!analysisReady() || state.coachBusy) return;
  const cacheKey = coachCacheKey();
  if (state.coachCache.has(cacheKey)) {
    const cached = state.coachCache.get(cacheKey);
    setCoachText(cached);
    speakCoach(cached);
    return;
  }

  if (state.coachAbort) state.coachAbort.abort();
  stopCoachSpeech();
  const ac = new AbortController();
  state.coachAbort = ac;
  const reqId = ++state.coachReqId;
  state.coachBusy = true;
  state.coachTargetKey = cacheKey;
  $('btn-coach-analyze').disabled = true;
  setCoachGenerating();

  let prompt;
  try {
    prompt = state.ply === 0 ? makeOverviewPrompt() : makeMovePrompt();
  } catch (ex) {
    state.coachBusy = false;
    state.coachTargetKey = null;
    setCoachPlaceholder(ex.message || 'Could not build coach prompt.', true);
    syncCoachUi();
    return;
  }

  try {
    const text = await askCoach(prompt, ac.signal);
    if (reqId !== state.coachReqId) return;
    const cleaned = scrubCoachText(text);
    state.coachCache.set(cacheKey, cleaned);
    state.coachBusy = false;
    state.coachTargetKey = null;
    setCoachText(cleaned);
    speakCoach(cleaned);
    syncCoachUi();
  } catch (ex) {
    if (ex.name === 'AbortError') return;
    if (reqId !== state.coachReqId) return;
    state.coachBusy = false;
    state.coachTargetKey = null;
    setCoachPlaceholder(ex.message || 'Coach request failed.', true);
    syncCoachUi();
  }
}

$('btn-coach-analyze').onclick = () => runCoachAnalyze();

function scrubCoachText(text) {
  return String(text)
    .replace(/\u2014|\u2013/g, ',')  // em/en dash -> comma
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .trim();
}

function makeOverviewPrompt() {
  const accs = { w: [], b: [] };
  state.reports.forEach((r, i) => {
    if (!r) return;
    accs[state.moves[i].color].push(r.accuracy);
  });
  const aw = gameAccuracy(accs.w), ab = gameAccuracy(accs.b);
  const result = state.meta.result
    || (state.meta.meIsWhite == null ? 'see PGN' : state.meta.result);

  return buildGameOverviewPrompt({
    white: state.meta.white.name,
    black: state.meta.black.name,
    result: result || 'unknown',
    opening: state.meta.opening,
    eco: state.meta.eco,
    accW: aw == null ? null : aw.toFixed(1),
    accB: ab == null ? null : ab.toFixed(1),
    ratingW: estimateRating(aw),
    ratingB: estimateRating(ab),
    tallies: summariseTallies(state.reports, state.moves, meSide()),
    critical: criticalMoments(state.reports, state.moves, state.evals, 5, meSide()),
    moveLine: moveLine(state.moves, state.reports),
    meSide: meSide(),
  });
}

function makeMovePrompt() {
  const idx = state.ply - 1;
  const mv = state.moves[idx];
  const rep = state.reports[idx];
  let bestSan = null;
  if (rep && !rep.isBest && rep.bestUci && rep.cls !== 'book') {
    const c = new Chess(mv.fenBefore);
    try {
      const bm = c.move({
        from: rep.bestUci.slice(0, 2),
        to: rep.bestUci.slice(2, 4),
        promotion: rep.bestUci[4] || 'q',
      });
      if (bm) bestSan = bm.san;
    } catch (_) {}
  } else if (rep && rep.isBest) {
    bestSan = mv.san;
  }

  const start = Math.max(0, idx - 5);
  const recent = state.moves.slice(start, idx + 1).map((m, i) => {
    const j = start + i;
    const num = Math.floor(j / 2) + 1;
    return (j % 2 === 0 ? `${num}. ` : '') + m.san;
  }).join(' ');

  return buildMovePrompt({
    white: state.meta.white.name,
    black: state.meta.black.name,
    meSide: meSide(),
    ply: state.ply,
    moveNum: Math.floor(idx / 2) + 1,
    san: mv.san,
    color: mv.color,
    cls: rep ? labelOf(rep.cls) : null,
    cpBefore: fmtCpShort(state.evals[idx]?.cpWhite),
    cpAfter: fmtCpShort(state.evals[idx + 1]?.cpWhite),
    bestSan,
    fenAfter: mv.fenAfter,
    recent,
    opening: state.meta.opening,
  });
}

$('ctl-first').onclick = () => { stopAutoplay(); goto(0, { animate: false }); };
$('ctl-prev').onclick = () => { stopAutoplay(); goto(state.ply - 1); };
$('ctl-play').onclick = () => toggleAutoplay();
$('ctl-next').onclick = () => { stopAutoplay(); goto(state.ply + 1); };
$('ctl-last').onclick = () => { stopAutoplay(); goto(state.moves.length, { animate: false }); };
$('ctl-flip').onclick = () => { state.flipped = !state.flipped; renderAll(); };
$('ctl-arrow').onclick = e => { state.showArrow = !state.showArrow; e.currentTarget.classList.toggle('on', state.showArrow); renderBoard(); };
$('ctl-arrow').classList.add('on');

document.addEventListener('keydown', e => {
  if ($('screen-review').hidden) return;
  const tag = document.activeElement?.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  // Space on a focused <button> also fires click — skip key handler or double-toggle.
  if ((e.key === ' ' || e.code === 'Space') && tag === 'BUTTON') return;
  if (e.key === 'ArrowLeft') { stopAutoplay(); goto(state.ply - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { stopAutoplay(); goto(state.ply + 1); e.preventDefault(); }
  else if (e.key === 'Home') { stopAutoplay(); goto(0, { animate: false }); }
  else if (e.key === 'End') { stopAutoplay(); goto(state.moves.length, { animate: false }); }
  else if (e.key === ' ' || e.code === 'Space') { toggleAutoplay(); e.preventDefault(); }
  else if (e.key === 'f') { state.flipped = !state.flipped; renderAll(); }
  else if (e.key === 'a') $('ctl-arrow').click();
});

window.addEventListener('resize', () => { if (!$('screen-review').hidden) renderGraph(); });

const MODE_KEY = 'engine-mode';

function getEngineMode() {
  const v = $('depth-select').value;
  return ENGINE_MODES[v] ? v : 'balanced';
}

function restoreEngineMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved && ENGINE_MODES[saved]) $('depth-select').value = saved;
  } catch (_) {}
}

$('depth-select').onchange = () => {
  try { localStorage.setItem(MODE_KEY, getEngineMode()); } catch (_) {}
  if (state.pool) { try { state.pool.destroy(); } catch (_) {} state.pool = null; state.poolMode = null; }
  warmEngineIdle();
  if (state.moves.length) runAnalysis();
};
restoreEngineMode();
// Warm download + boot first worker while idle (hide "Starting…" on first review)
async function warmEngineIdle() {
  const mode = getEngineMode();
  try {
    const cfg = await prefetchEngine(mode);
    if (state.pool || state.running) return;
    const pool = new EnginePool(cfg);
    if (state.pool || state.running) { pool.destroy(); return; }
    state.pool = pool;
    state.poolMode = mode;
    await pool.warmUp();
  } catch (_) { /* offline / blocked — analysis path retries */ }
}
if (typeof requestIdleCallback === 'function') requestIdleCallback(() => { warmEngineIdle(); }, { timeout: 2500 });
else setTimeout(() => { warmEngineIdle(); }, 600);

/* ─────────────────── sidebar tabs ─────────────────── */
function setSideTab(name) {
  const overview = name === 'overview';
  $('tab-overview').classList.toggle('active', overview);
  $('tab-moves').classList.toggle('active', !overview);
  $('tab-overview').setAttribute('aria-selected', overview ? 'true' : 'false');
  $('tab-moves').setAttribute('aria-selected', overview ? 'false' : 'true');
  $('panel-overview').hidden = !overview;
  $('panel-moves').hidden = overview;
  if (!overview) {
    const cur = $('movelist')?.querySelector('.mv.current');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
}
$('tab-overview').onclick = () => setSideTab('overview');
$('tab-moves').onclick = () => setSideTab('moves');

/* ─────────────────── analysis ─────────────────── */
function stopAnalysis() {
  state.running = false;
  state.analysisToken++;
  if (state.pool) { state.pool.destroy(); state.pool = null; state.poolMode = null; }
  if (state.coachAbort) { state.coachAbort.abort(); state.coachAbort = null; }
  state.coachBusy = false;
  state.coachTargetKey = null;
  stopCoachSpeech();
}

async function runAnalysis() {
  const mode = getEngineMode();
  const reusePool = state.pool && state.poolMode === mode && !state.running;
  if (state.pool && !reusePool) {
    try { state.pool.destroy(); } catch (_) {}
    state.pool = null;
    state.poolMode = null;
  }
  if (state.coachAbort) { state.coachAbort.abort(); state.coachAbort = null; }
  state.coachBusy = false;
  state.coachTargetKey = null;
  stopCoachSpeech();
  state.running = false;
  const token = ++state.analysisToken;

  const n = state.moves.length;
  if (!n) return;
  state.evals = new Array(n + 1).fill(null);
  state.reports = new Array(n).fill(null);
  state.tallyCursor = {};
  state.running = true;

  const prog = $('progress'), fill = $('progress-fill'), text = $('progress-text');
  prog.hidden = false;
  $('report').hidden = true;
  $('tally-more').hidden = true;
  fill.style.width = '0%';
  text.textContent = `Loading ${ENGINE_MODES[mode].label}…`;
  renderGraph();
  renderMoves();
  renderDetail();

  let cfg;
  try {
    cfg = await prefetchEngine(mode, ({ pct, label, fromCache }) => {
      if (token !== state.analysisToken) return;
      fill.style.width = Math.max(2, Math.round(pct * 0.35)) + '%';
      const verb = fromCache ? 'Loading' : 'Downloading';
      text.textContent = pct >= 100
        ? `Starting ${label || ENGINE_MODES[mode].label}…`
        : `${verb} ${label || ENGINE_MODES[mode].label}… ${pct}%`;
    });
  } catch (ex) {
    if (token !== state.analysisToken) return;
    text.textContent = 'Could not download engine. Check your connection and retry.';
    fill.style.width = '0%';
    state.running = false;
    return;
  }
  if (token !== state.analysisToken || !state.running) return;

  const depth = cfg.depth;
  fill.style.width = '40%';
  text.textContent = `Starting ${cfg.label}…`;

  let pool = reusePool ? state.pool : null;
  try {
    if (!pool) {
      pool = new EnginePool(cfg);
      state.pool = pool;
      state.poolMode = mode;
    }
    await pool.warmUp();
  } catch (ex) {
    if (token !== state.analysisToken) return;
    console.error('Engine start failed', ex);
    text.textContent = 'Engine failed to start. Try another mode or reload.';
    fill.style.width = '0%';
    state.running = false;
    if (pool) { try { pool.destroy(); } catch (_) {} }
    state.pool = null;
    state.poolMode = null;
    return;
  }
  if (token !== state.analysisToken || !state.running) return;

  const positions = [];
  for (let i = 0; i <= n; i++) {
    const fen = i === 0 ? state.moves[0].fenBefore : state.moves[i - 1].fenAfter;
    positions.push(fen);
  }

  let done = 0;
  const results = new Array(n + 1);
  fill.style.width = '45%';
  text.textContent = `Analysing… 0 / ${n + 1}`;

  await Promise.all(positions.map(async (fen, i) => {
    const c = new Chess(fen);
    let res;
    if (c.isGameOver()) {
      const stm = fen.split(' ')[1];
      let cp = 0;
      if (c.isCheckmate()) cp = stm === 'w' ? -10000 : 10000;
      res = { best: null, lines: [], terminal: true, terminalCpWhite: cp };
    } else {
      res = await pool.analyse(fen, depth);
    }
    if (token !== state.analysisToken || !state.running) return;
    results[i] = res;

    const stm = fen.split(' ')[1];
    const cpWhite = res.terminal ? res.terminalCpWhite
                                 : (res.lines[0] ? toWhiteCp(res.lines[0], stm) : 0);
    const mate = (!res.terminal && res.lines[0] && res.lines[0].mate != null) ? res.lines[0].mate : null;
    state.evals[i] = { cpWhite, mate: mate === null ? null : (stm === 'w' ? mate : -mate) };

    done++;
    const frac = done / (n + 1);
    fill.style.width = Math.round(45 + frac * 55) + '%';
    text.textContent = `Analysing… ${done} / ${n + 1} positions`;

    for (const idx of [i - 1, i]) {
      if (idx < 0 || idx >= n) continue;
      if (state.reports[idx] || !results[idx] || !results[idx + 1]) continue;
      state.reports[idx] = buildReport(idx, results[idx], results[idx + 1]);
    }
    if (done % 3 === 0 || done === n + 1) {
      renderMoves(); renderGraph(); renderReport(); renderEvalBar(); renderDetail();
    }
  }));

  if (token !== state.analysisToken || !state.running) return;
  for (let idx = 0; idx < n; idx++) {
    if (!state.reports[idx] && results[idx] && results[idx + 1]) {
      state.reports[idx] = buildReport(idx, results[idx], results[idx + 1]);
    }
  }
  state.running = false;
  prog.hidden = true;
  renderAll();
  // Keep pool warm for next game / mode re-run
}

function buildReport(idx, before, after) {
  const mv = state.moves[idx];
  const stmAfter = mv.fenAfter.split(' ')[1];
  const prevSame = idx >= 2 ? state.reports[idx - 2] : null;
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
    wBeforePrev: prevSame?.wBefore,
    hasPrev: !!prevSame,
  });
}

/* ─────────────────── util ─────────────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ─────────────────── app version badge ─────────────────── */
function initVersion() {
  const el = $('app-version');
  if (!el) return;
  const label = `v${APP_VERSION}`;
  let prev = null;
  try { prev = localStorage.getItem(VERSION_STORE); } catch { /* private mode */ }
  if (prev && prev !== APP_VERSION) {
    el.textContent = `Updated · ${label}`;
    el.classList.add('app-version-new');
    setTimeout(() => {
      el.textContent = label;
      el.classList.remove('app-version-new');
    }, 4500);
  } else {
    el.textContent = label;
  }
  try { localStorage.setItem(VERSION_STORE, APP_VERSION); } catch { /* ignore */ }
}

// deep-link + browser back/forward
window.addEventListener('popstate', () => { applyRoute(); });
prefetchSounds();
initVersion();
applyRoute();