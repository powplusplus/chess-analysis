// Reads the public Chess.com API straight from the browser.
const API = 'https://api.chess.com/pub';

/** @type {Map<string, Promise<{username:string,title:string|null,avatar:string|null}>>} */
const profileCache = new Map();

export async function fetchPlayer(username) {
  const user = String(username || '').trim().toLowerCase();
  if (!user || !/^[\w.-]{2,30}$/.test(user)) {
    return { username: user, title: null, avatar: null };
  }
  if (profileCache.has(user)) return profileCache.get(user);

  const p = (async () => {
    try {
      const res = await fetch(`${API}/player/${encodeURIComponent(user)}`);
      if (!res.ok) return { username: user, title: null, avatar: null };
      const d = await res.json();
      return {
        username: d.username || user,
        title: d.title || null,
        avatar: d.avatar || null,
      };
    } catch {
      return { username: user, title: null, avatar: null };
    }
  })();
  profileCache.set(user, p);
  return p;
}

export async function fetchPlayers(names) {
  const unique = [...new Set(
    names.map(n => String(n || '').trim().toLowerCase()).filter(Boolean)
  )];
  const profiles = await Promise.all(unique.map(fetchPlayer));
  const map = new Map();
  for (const p of profiles) map.set(p.username.toLowerCase(), p);
  for (const u of unique) if (!map.has(u)) map.set(u, { username: u, title: null, avatar: null });
  return map;
}

export async function fetchRecentGames(username, want = 30) {
  const user = username.trim().toLowerCase();
  if (!/^[\w.-]{2,30}$/.test(user)) throw new Error('That does not look like a username.');

  const arcRes = await fetch(`${API}/player/${encodeURIComponent(user)}/games/archives`);
  if (arcRes.status === 404) throw new Error(`No Chess.com player called “${username}”.`);
  if (!arcRes.ok) throw new Error('Chess.com did not answer. Try again in a moment.');

  const { archives } = await arcRes.json();
  if (!archives || !archives.length) throw new Error(`${username} has no games on record.`);

  const games = [];
  for (let i = archives.length - 1; i >= 0 && games.length < want; i--) {
    const mRes = await fetch(archives[i]);
    if (!mRes.ok) break;
    const data = await mRes.json();
    const list = (data.games || []).filter(g => g.pgn && g.rules === 'chess');
    games.push(...list.reverse());
  }
  if (!games.length) throw new Error(`No standard chess games found for ${username}.`);
  return { user, games: games.slice(0, want) };
}

export function gameIdFromUrl(url) {
  const m = String(url || '').match(/\/game\/(?:live|daily|computer)\/(\d+)/i);
  return m ? m[1] : null;
}

/** Chess.com player.result → phrase after won / lost / drawn. */
const HOW = {
  checkmated: 'by checkmate',
  resigned: 'by resignation',
  timeout: 'on time',
  abandoned: 'by abandonment',
  agreed: 'by agreement',
  repetition: 'by repetition',
  stalemate: 'by stalemate',
  insufficient: 'by insufficient material',
  '50move': 'by the 50-move rule',
  timevsinsufficient: 'by timeout vs insufficient material',
};

/** Compact label under Win/Loss/Draw on game cards. */
const SHORT = {
  checkmated: 'checkmate',
  resigned: 'resignation',
  timeout: 'timeout',
  abandoned: 'abandoned',
  agreed: 'agreement',
  repetition: 'repetition',
  stalemate: 'stalemate',
  insufficient: 'insufficient',
  '50move': '50-move',
  timevsinsufficient: 'time vs material',
};

export function howPhrase(code) {
  const c = String(code || '').toLowerCase();
  if (!c || c === 'win' || c === 'lose') return '';
  return HOW[c] || `by ${c}`;
}

function shortHowOf(code) {
  const c = String(code || '').toLowerCase();
  if (!c || c === 'win' || c === 'lose') return '';
  return SHORT[c] || c;
}

/**
 * Chess.com-style end text from white/black result codes.
 * @returns {{ result:'win'|'loss'|'draw', how:string, headline:string, shortHow:string }}
 */
export function describeEnd(whiteResult, blackResult, opts = {}) {
  const wr = String(whiteResult || '').toLowerCase();
  const br = String(blackResult || '').toLowerCase();
  const { whiteName = 'White', blackName = 'Black', meIsWhite = null } = opts;

  let winner = null; // 'w' | 'b'
  if (wr === 'win') winner = 'w';
  else if (br === 'win') winner = 'b';

  const howCode = winner === 'w' ? br : winner === 'b' ? wr : (wr || br);
  const how = howPhrase(howCode);
  const shortHow = shortHowOf(howCode);

  let result = 'draw';
  if (meIsWhite != null && winner) {
    result = ((winner === 'w') === !!meIsWhite) ? 'win' : 'loss';
  } else if (winner) {
    // No seat → result from white's perspective (1-0 style).
    result = winner === 'w' ? 'win' : 'loss';
  }

  let headline;
  if (!winner) {
    headline = how ? `Game drawn ${how}` : 'Game drawn';
  } else if (meIsWhite != null) {
    const youWon = (winner === 'w') === !!meIsWhite;
    headline = youWon
      ? (how ? `You won ${how}` : 'You won')
      : (how ? `You lost ${how}` : 'You lost');
  } else {
    const name = winner === 'w' ? whiteName : blackName;
    headline = how ? `${name} won ${how}` : `${name} won`;
  }

  return { result, how, headline, shortHow };
}

/** Prefer PGN Termination; fall back to Result. */
export function describeEndFromHeaders(headers, opts = {}) {
  const term = (headers.Termination || '').trim();
  const res = (headers.Result || '').trim();
  const { meIsWhite = null, whiteName = 'White', blackName = 'Black' } = opts;

  let result = 'draw';
  if (res === '1-0') result = meIsWhite == null ? 'win' : (meIsWhite ? 'win' : 'loss');
  else if (res === '0-1') result = meIsWhite == null ? 'loss' : (meIsWhite ? 'loss' : 'win');

  if (term) {
    let headline = term;
    if (meIsWhite != null) {
      const wonBy = term.match(/^(.+?)\s+won\s+(.+)$/i);
      if (wonBy) {
        const who = wonBy[1].trim().toLowerCase();
        const rest = wonBy[2].trim();
        const w = String(whiteName).toLowerCase();
        const b = String(blackName).toLowerCase();
        const whiteWon = who === w || who === 'white';
        const blackWon = who === b || who === 'black';
        if (whiteWon || blackWon) {
          const youWon = whiteWon === !!meIsWhite;
          headline = youWon ? `You won ${rest}` : `You lost ${rest}`;
        }
      }
    }
    const m = term.match(/\b((?:by|on)\s.+)$/i);
    const how = m ? m[1] : '';
    return {
      result,
      how,
      headline,
      shortHow: how.replace(/^(?:by|on)\s+/i, '').replace(/^the\s+/i, ''),
    };
  }

  if (res === '1-0') return describeEnd('win', 'resigned', { whiteName, blackName, meIsWhite });
  if (res === '0-1') return describeEnd('resigned', 'win', { whiteName, blackName, meIsWhite });
  if (res === '1/2-1/2') return describeEnd('agreed', 'agreed', { whiteName, blackName, meIsWhite });
  return { result: 'draw', how: '', headline: '', shortHow: '' };
}

function formatTimeControl(game) {
  const tc = String(game.time_control || '');
  let timeControl = tc;
  const m = tc.match(/^(\d+)(?:\+(\d+(?:\.\d+)?)?)?$/);
  if (m) {
    const base = parseInt(m[1], 10);
    const inc = m[2] != null && m[2] !== '' ? m[2] : null;
    if (game.time_class === 'daily') {
      timeControl = `${base} day${base === 1 ? '' : 's'}`;
    } else if (base >= 60) {
      const mins = Math.round(base / 60);
      timeControl = inc != null ? `${mins}+${inc}` : `${mins} min`;
    } else {
      timeControl = inc != null ? `${base}+${inc}` : `${base}s`;
    }
  }
  return timeControl;
}

export function summarise(game, user) {
  const w = game.white || {}, b = game.black || {};
  const meIsWhite = (w.username || '').toLowerCase() === user;
  const them = meIsWhite ? b : w;

  const end = describeEnd(w.result, b.result, {
    whiteName: w.username || 'White',
    blackName: b.username || 'Black',
    meIsWhite,
  });

  return {
    white: { name: w.username || 'White', rating: w.rating },
    black: { name: b.username || 'Black', rating: b.rating },
    meIsWhite, opponent: them.username || '-',
    result: end.result,
    how: end.how,
    shortHow: end.shortHow,
    headline: end.headline,
    whiteResult: w.result || null,
    blackResult: b.result || null,
    timeClass: game.time_class || 'game',
    timeControl: formatTimeControl(game),
    date: game.end_time ? new Date(game.end_time * 1000) : null,
    pgn: game.pgn,
    url: game.url,
    id: gameIdFromUrl(game.url) || (game.end_time != null ? String(game.end_time) : null),
  };
}
