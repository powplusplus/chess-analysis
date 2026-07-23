// Original badge artwork for each classification: a filled disc with a simple
// glyph. Drawn here rather than loaded so the app has no image dependencies.

export const CLASSES = {
  brilliant:  { label: 'Brilliant',  color: 'var(--c-brilliant)',  raw: '#26c2a3', glyph: 'bang2' },
  great:      { label: 'Great',      color: 'var(--c-great)',      raw: '#749bbf', glyph: 'bang1' },
  best:       { label: 'Best',       color: 'var(--c-best)',       raw: '#81b64c', glyph: 'star'  },
  excellent:  { label: 'Excellent',  color: 'var(--c-excellent)',  raw: '#95bb4a', glyph: 'check' },
  good:       { label: 'Good',       color: 'var(--c-good)',       raw: '#96af8b', glyph: 'check' },
  book:       { label: 'Book',       color: 'var(--c-book)',       raw: '#a88865', glyph: 'book'  },
  inaccuracy: { label: 'Inaccuracy', color: 'var(--c-inaccuracy)', raw: '#f7c631', glyph: 'quest_bang' },
  mistake:    { label: 'Mistake',    color: 'var(--c-mistake)',    raw: '#ffa459', glyph: 'quest' },
  miss:       { label: 'Miss',       color: 'var(--c-miss)',       raw: '#ff7769', glyph: 'cross' },
  blunder:    { label: 'Blunder',    color: 'var(--c-blunder)',    raw: '#fa412d', glyph: 'quest2' },
};

export const ORDER = ['brilliant','great','best','excellent','good','book','inaccuracy','mistake','miss','blunder'];

const GLYPHS = {
  star:  '<path fill="#fff" d="M18 7.4l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6-4.8-4.7 6.6-.9z"/>',
  check: '<path fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" d="M10.5 18.6l4.9 4.9 10.1-10.6"/>',
  cross: '<path fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" d="M11.5 11.5l13 13M24.5 11.5l-13 13"/>',
  book:  '<path fill="#fff" d="M17 11.4c-1.7-1.3-4.1-1.9-7.4-1.9H8.6v16h1c2.9 0 5.6.6 7.4 1.9zm2 16c1.8-1.3 4.5-1.9 7.4-1.9h1v-16h-1c-3.3 0-5.7.6-7.4 1.9z"/>',
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
