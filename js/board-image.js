// Offscreen FEN → PNG for coach multimodal prompts.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';

const FILES = 'abcdefgh';
const SIZE = 384;
const SQ = SIZE / 8;
const LIGHT = '#ebecd0';
const DARK = '#739552';
const HL = 'rgba(255,255,51,0.5)';
const COORD_ON_LIGHT = '#739552';
const COORD_ON_DARK = '#ebecd0';
const PIECE_BASE = new URL('../pieces/neo/', import.meta.url);

const KEYS = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk'];
const pieceCache = new Map();
let loadPromise = null;

function pieceUrl(key) {
  return new URL(key + '.png', PIECE_BASE).href;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + src));
    img.src = src;
  });
}

export function prefetchPieces() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all(KEYS.map(async (key) => {
    if (pieceCache.has(key)) return;
    const img = await loadImage(pieceUrl(key));
    pieceCache.set(key, img);
  }));
  return loadPromise;
}

function squareAt(i, flipped) {
  let f = i % 8;
  let r = Math.floor(i / 8);
  if (flipped) { f = 7 - f; r = 7 - r; }
  return FILES[f] + (8 - r);
}

function isLightSquare(name) {
  return (FILES.indexOf(name[0]) + parseInt(name[1], 10)) % 2 === 0;
}

/**
 * @param {string} fen
 * @param {{ lastFrom?: string, lastTo?: string, flipped?: boolean }} [opts]
 * @returns {Promise<{ mimeType: string, data: string }>}
 */
export async function fenToPngBase64(fen, opts = {}) {
  await prefetchPieces();
  const flipped = !!opts.flipped;
  const lastFrom = opts.lastFrom || null;
  const lastTo = opts.lastTo || null;
  const pos = new Chess(fen);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < 64; i++) {
    const name = squareAt(i, flipped);
    const col = i % 8;
    const row = Math.floor(i / 8);
    const x = col * SQ;
    const y = row * SQ;
    const light = isLightSquare(name);
    ctx.fillStyle = light ? LIGHT : DARK;
    ctx.fillRect(x, y, SQ, SQ);

    if (name === lastFrom || name === lastTo) {
      ctx.fillStyle = HL;
      ctx.fillRect(x, y, SQ, SQ);
    }

    // Rank/file coords on a-file and 1st rank edges of the view
    ctx.font = `bold ${Math.max(10, SQ * 0.22)}px system-ui,sans-serif`;
    ctx.textBaseline = 'top';
    if (col === 0) {
      ctx.fillStyle = light ? COORD_ON_LIGHT : COORD_ON_DARK;
      ctx.textAlign = 'left';
      ctx.fillText(name[1], x + 3, y + 2);
    }
    if (row === 7) {
      ctx.fillStyle = light ? COORD_ON_LIGHT : COORD_ON_DARK;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(name[0], x + SQ - 3, y + SQ - 2);
    }

    const p = pos.get(name);
    if (p) {
      const key = p.color + p.type;
      const img = pieceCache.get(key);
      if (img) {
        const pad = SQ * 0.04;
        ctx.drawImage(img, x + pad, y + pad, SQ - pad * 2, SQ - pad * 2);
      }
    }
  }

  const dataUrl = canvas.toDataURL('image/png');
  const data = dataUrl.replace(/^data:image\/png;base64,/, '');
  return { mimeType: 'image/png', data };
}
