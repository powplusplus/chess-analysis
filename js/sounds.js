// Chess.com default board sounds (mirrored under /sounds/)

const BASE = new URL('../sounds/', import.meta.url);
const cache = new Map();
const active = new Set();

function src(name) {
  return new URL(name + '.mp3', BASE).href;
}

function play(name) {
  let base = cache.get(name);
  if (!base) {
    base = new Audio(src(name));
    base.preload = 'auto';
    cache.set(name, base);
  }
  const a = base.cloneNode();
  a.volume = 0.85;
  active.add(a);
  const clear = () => active.delete(a);
  a.addEventListener('ended', clear, { once: true });
  a.addEventListener('error', clear, { once: true });
  a.play().catch(clear);
}

/** Silence any in-flight move clips (e.g. pause autoplay). */
export function stopAllMoveSounds() {
  for (const a of active) {
    try {
      a.pause();
      a.removeAttribute('src');
      a.load();
    } catch { /* ignore */ }
  }
  active.clear();
}

/** Pick + play chess.com sound for one move. */
export function playMoveSound(mv) {
  if (!mv) return;
  const san = mv.san || '';
  let name = 'move-self';
  if (san === 'O-O' || san === 'O-O-O') name = 'castle';
  else if (san.includes('+') || san.includes('#')) name = 'move-check';
  else if (mv.uci && mv.uci.length > 4) name = 'promote';
  else if (mv.captured) name = 'capture';
  play(name);
}

/** Warm caches so first click isn't delayed. */
export function prefetchSounds() {
  for (const n of ['move-self', 'move-check', 'capture', 'castle', 'promote']) {
    if (cache.has(n)) continue;
    const a = new Audio(src(n));
    a.preload = 'auto';
    cache.set(n, a);
  }
}
