// Reads the public Chess.com API straight from the browser.
const API = 'https://api.chess.com/pub';

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

export function summarise(game, user) {
  const w = game.white || {}, b = game.black || {};
  const meIsWhite = (w.username || '').toLowerCase() === user;
  const me = meIsWhite ? w : b;
  const them = meIsWhite ? b : w;

  let result = 'draw';
  if (me.result === 'win') result = 'win';
  else if (them.result === 'win') result = 'loss';

  const secs = game.time_control ? parseInt(game.time_control, 10) : null;
  return {
    white: { name: w.username || 'White', rating: w.rating },
    black: { name: b.username || 'Black', rating: b.rating },
    meIsWhite, opponent: them.username || '-', result,
    timeClass: game.time_class || 'game',
    timeControl: secs ? `${Math.round(secs / 60)} min` : (game.time_control || ''),
    date: game.end_time ? new Date(game.end_time * 1000) : null,
    pgn: game.pgn,
    url: game.url,
    id: gameIdFromUrl(game.url) || (game.end_time != null ? String(game.end_time) : null),
  };
}
