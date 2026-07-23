import { labelOf } from './icons.js';

const MODEL = 'gemma-4-31b-it';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function loadApiKey() {
  try {
    const m = await import('./coach-config.js');
    return (m.GOOGLE_API_KEY || '').trim();
  } catch {
    return '';
  }
}

const STYLE = `You are Magnus, a sharp chess coach reviewing a game.
Voice rules (strict):
- No em dashes or en dashes. Use commas, periods, or colons.
- Prefer "it's not X, it's Y" when correcting a misconception.
- Short paragraphs. Direct. No fluff. No emoji. No markdown headings.
- 2 to 4 short paragraphs max.
- Sound like a real coach talking to the player, not a textbook.
- Never only restate the move or its label (Best, Blunder, etc). Explain the idea, the plan, and what to do next.`;

export function buildGameOverviewPrompt(ctx) {
  const {
    white, black, result, opening, eco,
    accW, accB, ratingW, ratingB,
    tallies, critical, moveLine, meSide,
  } = ctx;

  const who = meSide === 'w' ? `You played White (${white}).`
    : meSide === 'b' ? `You played Black (${black}).`
    : `White is ${white}. Black is ${black}.`;

  return `${STYLE}

Task: Game overview. No specific move is selected. Summarise how the game went, the decisive moments, and the main lesson.

${who}
Result from your seat: ${result || 'unknown'}
Opening: ${opening || 'unknown'}${eco ? ` (${eco})` : ''}
Accuracy: White ${accW ?? 'n/a'}, Black ${accB ?? 'n/a'}
Estimated game rating: White ${ratingW ?? 'n/a'}, Black ${ratingB ?? 'n/a'}
Move quality counts: ${tallies}
Critical moments:
${critical || '(none flagged)'}
Moves: ${moveLine}

Write the overview now.`;
}

export function buildMovePrompt(ctx) {
  const {
    white, black, meSide, ply, moveNum, san, color, cls,
    cpBefore, cpAfter, bestSan, fenAfter, recent, opening,
  } = ctx;

  const mover = color === 'w' ? 'White' : 'Black';
  const youMoved = (meSide === 'w' && color === 'w') || (meSide === 'b' && color === 'b');
  const address = youMoved
    ? `You played ${san} as ${mover}.`
    : `${mover} played ${san}. Talk about what this means for the player reviewing.`;

  return `${STYLE}

Task: Move analysis. A move is selected. Explain what went right or wrong on this move, and what to take from it.

Players: White ${white}, Black ${black}
Opening: ${opening || 'unknown'}
Move ${moveNum} (ply ${ply}): ${san} by ${mover}
Engine class: ${cls || 'unknown'}
Eval before (White cp): ${cpBefore ?? 'n/a'}
Eval after (White cp): ${cpAfter ?? 'n/a'}
Engine best: ${bestSan || 'same as played / unknown'}
Position after (FEN): ${fenAfter}
Recent moves: ${recent}
${address}

If the move was good, say why. If it was wrong, name the idea that failed and the better plan in plain words. No em dashes.`;
}

export async function askCoach(prompt, signal) {
  // 1) Same-origin Vercel proxy (preferred - key stays on server)
  let proxyMiss = false;
  try {
    const r = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal,
    });
    if (r.ok) {
      const data = await r.json();
      if (data.text) return data.text;
      throw new Error('Empty coach reply');
    }
    const data = await r.json().catch(() => ({}));
    // No route / missing server key → try browser config. Other errors bubble.
    if (r.status === 404 || r.status === 405) proxyMiss = true;
    else if (r.status === 500 && /GOOGLE_API_KEY|not configured/i.test(data.error || '')) proxyMiss = true;
    else throw new Error(data.error || `Coach API ${r.status}`);
  } catch (ex) {
    if (ex.name === 'AbortError') throw ex;
    if (!proxyMiss && !/Failed to fetch|NetworkError|Load failed/i.test(ex.message || '')) throw ex;
    proxyMiss = true;
  }

  // 2) Local static fallback (js/coach-config.js - gitignored)
  const key = await loadApiKey();
  if (!key || key.includes('your_google')) {
    throw new Error('Coach needs GOOGLE_API_KEY on Vercel (Settings → Environment Variables), or js/coach-config.js locally.');
  }
  return callGemini(key, prompt, signal);
}

async function callGemini(key, prompt, signal) {
  const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
      },
    }),
    signal,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Gemini error ${r.status}`);
  const text = extractText(data);
  if (!text) throw new Error('Empty coach reply');
  return text;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  const spoken = parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  if (spoken) return spoken;
  return parts.filter(p => p.text).map(p => p.text).join('').trim();
}

export function summariseTallies(reports, moves) {
  const keys = ['brilliant', 'great', 'best', 'mistake', 'miss', 'blunder', 'inaccuracy'];
  const bits = [];
  for (const k of keys) {
    const n = reports.filter(r => r && r.cls === k).length;
    if (n) bits.push(`${n} ${labelOf(k)}`);
  }
  return bits.join(', ') || 'mostly solid play';
}

export function criticalMoments(reports, moves, evals, limit = 5) {
  const scored = [];
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    if (!r) continue;
    const weight = ({ blunder: 5, miss: 4, mistake: 3, brilliant: 3, great: 2, inaccuracy: 1 })[r.cls] || 0;
    if (!weight) continue;
    const num = Math.floor(i / 2) + 1;
    const dots = i % 2 === 0 ? '' : '...';
    const cp = evals[i + 1]?.cpWhite;
    const evalBit = cp == null ? '' : ` (eval ${(cp / 100).toFixed(1)})`;
    scored.push({
      weight,
      line: `${num}.${dots} ${moves[i].san} = ${labelOf(r.cls)}${evalBit}`,
    });
  }
  scored.sort((a, b) => b.weight - a.weight);
  return scored.slice(0, limit).map(s => s.line).join('\n');
}

export function moveLine(moves, reports) {
  const parts = [];
  for (let i = 0; i < moves.length; i++) {
    const num = Math.floor(i / 2) + 1;
    const rep = reports[i];
    const tag = rep ? `{${labelOf(rep.cls)}}` : '';
    if (i % 2 === 0) parts.push(`${num}. ${moves[i].san}${tag}`);
    else parts.push(`${moves[i].san}${tag}`);
  }
  return parts.join(' ');
}

export function fmtCpShort(cp) {
  if (cp == null) return null;
  if (Math.abs(cp) > 9000) {
    const n = Math.max(1, Math.round((10000 - Math.abs(cp)) / 10));
    return (cp > 0 ? '+M' : '-M') + n;
  }
  return (cp / 100).toFixed(2);
}
