// Original badge artwork for each classification: a filled disc with a simple
// glyph. Drawn here rather than loaded so the app has no image dependencies.

export const CLASSES = {
  brilliant:  { label: 'Brilliant',  color: 'var(--c-brilliant)',  raw: '#1ec8c0', glyph: 'bang2' },
  great:      { label: 'Great',      color: 'var(--c-great)',      raw: '#5ba3d9', glyph: 'bang1' },
  best:       { label: 'Best',       color: 'var(--c-best)',       raw: '#8ecf4a', glyph: 'star'  },
  excellent:  { label: 'Excellent',  color: 'var(--c-excellent)',  raw: '#a5d44f', glyph: 'check' },
  good:       { label: 'Good',       color: 'var(--c-good)',       raw: '#9fc277', glyph: 'check' },
  book:       { label: 'Book',       color: 'var(--c-book)',       raw: '#c49a6c', glyph: 'book'  },
  forced:     { label: 'Forced',     color: 'var(--c-forced)',     raw: '#93918c', glyph: 'arrow' },
  inaccuracy: { label: 'Inaccuracy', color: 'var(--c-inaccuracy)', raw: '#ffd12a', glyph: 'quest_bang' },
  mistake:    { label: 'Mistake',    color: 'var(--c-mistake)',    raw: '#ff9a2e', glyph: 'quest' },
  miss:       { label: 'Miss',       color: 'var(--c-miss)',       raw: '#ff7a7a', glyph: 'cross' },
  blunder:    { label: 'Blunder',    color: 'var(--c-blunder)',    raw: '#f03530', glyph: 'quest2' },
};

export const ORDER = ['brilliant','great','best','excellent','good','book','forced','inaccuracy','mistake','miss','blunder'];

const GLYPHS = {
  star:  '<path fill="#fff" d="M18 7.4l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6-4.8-4.7 6.6-.9z"/>',
  check: '<path fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" d="M10.5 18.6l4.9 4.9 10.1-10.6"/>',
  cross: '<path fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" d="M11.5 11.5l13 13M24.5 11.5l-13 13"/>',
  book:  '<path fill="#fff" d="M17 11.4c-1.7-1.3-4.1-1.9-7.4-1.9H8.6v16h1c2.9 0 5.6.6 7.4 1.9zm2 16c1.8-1.3 4.5-1.9 7.4-1.9h1v-16h-1c-3.3 0-5.7.6-7.4 1.9z"/>',
  arrow: '<path fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M10 18h13M18 12l6 6-6 6"/>',
  bang1: '<text x="18" y="26.5" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="21" font-weight="900" fill="#fff" text-anchor="middle">!</text>',
  bang2: '<text x="18" y="26.5" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="21" font-weight="900" fill="#fff" text-anchor="middle">!!</text>',
  quest: '<text x="18" y="26.5" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="21" font-weight="900" fill="#fff" text-anchor="middle">?</text>',
  quest2:'<text x="18" y="26.5" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="21" font-weight="900" fill="#fff" text-anchor="middle">??</text>',
  quest_bang:'<text x="18" y="26.5" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="20" font-weight="900" fill="#fff" text-anchor="middle">?!</text>',
};

// useVar: true inside the sidebar (theme colours), false for board badges.
export function icon(cls, useVar = true) {
  const c = CLASSES[cls];
  if (!c) return '';
  const fill = useVar ? c.color : c.raw;
  return `<svg viewBox="0 0 36 36" role="img" aria-label="${c.label}">
    <circle cx="18" cy="18.8" r="16" fill="#000" opacity=".28"/>
    <circle cx="18" cy="18" r="16" fill="${fill}"/>
    ${GLYPHS[c.glyph]}
  </svg>`;
}

export function colorOf(cls) { return (CLASSES[cls] || {}).raw || '#888'; }
export function labelOf(cls) { return (CLASSES[cls] || {}).label || ''; }

/* Chess.com-style time-class glyphs for the games list. */
const TC_GLYPHS = {
  bullet: `
    <path fill="currentColor" d="M10.2 4.2 7.4 14.6h4.1L9.2 22.2l9.4-12.2h-4.4L17.8 4.2z"/>
    <path fill="currentColor" d="M20.8 6.4 18.8 13.6h2.9L19.8 19.2l6.6-8.6h-3.1L25.8 6.4z" opacity=".72"/>`,
  blitz: `<path fill="currentColor" d="M13.2 3.2 9.6 14.8h5.2L12.4 24.8l11.2-14.6h-5.4L22.4 3.2z"/>`,
  rapid: `
    <circle cx="14" cy="14" r="8.2" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <path d="M14 8.2v6.2l4.2 2.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M20.6 6.2 22.8 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="22.2" cy="4.6" r="1.6" fill="currentColor"/>`,
  daily: `
    <circle cx="14" cy="14" r="5.2" fill="currentColor"/>
    <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M14 3.2v2.4M14 22.4v2.4M3.2 14h2.4M22.4 14h2.4"/>
      <path d="m6.4 6.4 1.7 1.7M19.9 19.9l1.7 1.7M19.9 6.4l1.7-1.7M6.4 21.6l1.7-1.7"/>
    </g>`,
  classical: `
    <path d="M9.2 4.2h9.6v2.2H9.2zM10.4 6.4h7.2l-1.8 5.6c1.6 1 2.6 2.6 2.6 4.6 0 3-2.4 5.4-5.4 5.4s-5.4-2.4-5.4-5.4c0-2 1-3.6 2.6-4.6L10.4 6.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M14 16.2v3.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  game: `
    <circle cx="14" cy="14" r="8.2" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <path d="M14 8.2v6.2l3.6 2.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
};

const TC_LABELS = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  daily: 'Daily',
  classical: 'Classical',
  game: 'Game',
};

export function timeClassLabel(cls) {
  const key = String(cls || 'game').toLowerCase();
  return TC_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

export function timeClassIcon(cls) {
  const key = String(cls || 'game').toLowerCase();
  const glyph = TC_GLYPHS[key] || TC_GLYPHS.game;
  const label = timeClassLabel(key);
  return `<svg class="tc-ico" viewBox="0 0 28 28" role="img" aria-label="${label}">${glyph}</svg>`;
}
