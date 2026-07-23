// Chess.com default piece set (Neo) - PNGs mirrored under /pieces/neo/
// Board colours match Chess.com green theme CSS vars.

const BASE = new URL('../pieces/neo/', import.meta.url);

export function pieceImg(color, type) {
  const key = color + type; // e.g. wp, bn
  const src = new URL(key + '.png', BASE).href;
  return `<img class="piece-img" src="${src}" alt="" draggable="false">`;
}

// keep old name as alias so call sites stay simple
export function pieceSvg(color, type) {
  return pieceImg(color, type);
}
