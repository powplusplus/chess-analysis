import { labelOf } from './icons.js';

const MODEL = 'gemma-4-31b-it';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_IMAGES = 2;
const MAX_IMAGE_BYTES = 1_000_000; // ~1MB raw base64 decode budget per image
// LOW thinking is plenty for a grounded 2-4 paragraph note and much faster than
// MAX; HIGH is the fallback if a build rejects LOW.
const THINK_LEVELS = ['LOW', 'HIGH'];

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
- Never use "it's not X, it's Y" / "this isn't X, it's Y" / "not about X, about Y". Say the point once, straight.
- Short paragraphs. Direct. No fluff. No emoji. No markdown headings.
- 2 to 4 short paragraphs max.
- Sound like a real coach talking to the player, not a textbook.
- Never only restate the move or its label (Best, Blunder, etc). Explain the idea, the plan, and what to do next.

Grounding rules (strict, never break):
- Use ONLY facts in this prompt: players, result, opening, accuracy, ratings, move tags, evals, engine best, PV, FEN, board images, critical moments.
- Do NOT invent tactics, checks, captures, pins, forks, mates, threats, or piece placements not supported by those facts.
- When board images are attached, trust visible piece placement on those images together with the FEN. Do not place pieces that are not on the boards / FEN.
- Do NOT invent opening names, ECO codes, or plans beyond the given Opening line.
- Do NOT invent scores, ratings, or move labels. Trust Engine class and evals over your own recall.
- If mover better alternative / PV or your-reply PV is given, prefer those labeled lines. Never treat the mover's missed move as the reviewer's reply. If a detail is missing, omit it. Prefer a shorter true note over a vivid guess.
- Before writing, silently check each claim against the facts above. Drop any claim you cannot verify.`;

export function buildGameOverviewPrompt(ctx) {
  const {
    white, black, result, opening, eco,
    accW, accB, ratingW, ratingB,
    tallies, critical, moveLine, meSide,
  } = ctx;

  const seat = meSide === 'w' ? 'White' : meSide === 'b' ? 'Black' : null;
  const youName = meSide === 'w' ? white : meSide === 'b' ? black : null;
  const oppName = meSide === 'w' ? black : meSide === 'b' ? white : null;
  const yourAcc = meSide === 'w' ? accW : meSide === 'b' ? accB : null;
  const oppAcc = meSide === 'w' ? accB : meSide === 'b' ? accW : null;
  const yourRating = meSide === 'w' ? ratingW : meSide === 'b' ? ratingB : null;
  const oppRating = meSide === 'w' ? ratingB : meSide === 'b' ? ratingW : null;

  const seatBlock = seat
    ? `Reviewer seat: ${seat} (${youName}). Opponent: ${oppName} (${seat === 'White' ? 'Black' : 'White'}).
Address the reviewer as "you". Coach THEIR play. Do not write a neutral both-sides report.`
    : `White is ${white}. Black is ${black}.
No reviewer seat known. Keep the overview balanced.`;

  const accBlock = seat
    ? `Your accuracy: ${yourAcc ?? 'n/a'} (opponent ${oppAcc ?? 'n/a'})
Your estimated game rating: ${yourRating ?? 'n/a'} (opponent ${oppRating ?? 'n/a'})`
    : `Accuracy: White ${accW ?? 'n/a'}, Black ${accB ?? 'n/a'}
Estimated game rating: White ${ratingW ?? 'n/a'}, Black ${ratingB ?? 'n/a'}`;

  const task = seat
    ? `Task: Game overview for the player who had ${seat}. No specific move is selected. Summarise how THEIR game went, THEIR decisive moments, and the main lesson for them.`
    : `Task: Game overview. No specific move is selected. Summarise how the game went, the decisive moments, and the main lesson.`;

  return `${STYLE}

${task}

${seatBlock}
Result from your seat: ${result || 'unknown'}
Opening: ${opening || 'unknown'}${eco ? ` (${eco})` : ''}
${accBlock}
Move quality counts: ${tallies}
Critical moments:
${critical || '(none flagged)'}
Moves: ${moveLine}

Write the overview now. Stay inside the facts above. Critical moments and move tags are the only place to cite concrete errors or brilliancies.`;
}

export function buildMovePrompt(ctx) {
  const {
    white, black, meSide, ply, moveNum, san, color, cls,
    cpBefore, cpAfter, bestSan, bestLine, replySan, replyLine,
    fenBefore, fenAfter, recent, opening,
    wBefore, wAfter, drop, sacrifice, hasBoardImages,
  } = ctx;

  const mover = color === 'w' ? 'White' : 'Black';
  const seat = meSide === 'w' ? 'White' : meSide === 'b' ? 'Black' : null;
  const youName = meSide === 'w' ? white : meSide === 'b' ? black : null;
  const oppName = meSide === 'w' ? black : meSide === 'b' ? white : null;
  const youMoved = seat && ((meSide === 'w' && color === 'w') || (meSide === 'b' && color === 'b'));

  const seatBlock = seat
    ? `Reviewer seat: ${seat} (${youName}). Opponent: ${oppName} (${seat === 'White' ? 'Black' : 'White'}).
Address the reviewer as "you". Coach from THEIR seat only. Do not write a neutral both-sides report.`
    : `White is ${white}. Black is ${black}.
No reviewer seat known. Keep the note balanced.`;

  const address = !seat
    ? `${mover} played ${san}.`
    : youMoved
      ? `You (${seat}) played ${san}. This is YOUR move. Judge it for you.`
      : `Opponent (${mover}) played ${san}. Explain what this does to YOU (${seat}). If advising a reply, use ONLY "Your best reply" below, never "Mover better alternative".`;

  const evalHint = seat
    ? `Evals are White-centric (positive = White better). You are ${seat}, so read them from your seat.`
    : `Evals are White-centric (positive = White better).`;

  const task = seat
    ? `Task: Move analysis for the player who had ${seat}. A move is selected. Explain what went right or wrong for THEM, and what THEY should take from it.`
    : `Task: Move analysis. A move is selected. Explain what went right or wrong on this move, and what to take from it.`;

  const winBits = [
    wBefore == null ? null : `Mover win% before: ${Number(wBefore).toFixed(1)}`,
    wAfter == null ? null : `Mover win% after: ${Number(wAfter).toFixed(1)}`,
    drop == null ? null : `Win% drop: ${Number(drop).toFixed(1)}`,
    sacrifice ? 'Engine flagged a real piece sacrifice on this move.' : null,
  ].filter(Boolean).join('\n');

  const boardBlock = hasBoardImages
    ? `Board images: two PNGs are attached before this text. Image 1 = BEFORE the move. Image 2 = AFTER the move (yellow squares = from/to of the played move). Use them with the FEN to see piece placement. Do not invent pieces or tactics not visible there or in the engine facts.`
    : '';

  // "Engine best" is always the better alt for the side that just moved — never the other side's reply.
  const altBlock = `Mover better alternative (instead of ${san}, same side to move BEFORE this ply): ${bestSan || 'same as played / unknown'}
Mover better PV (SAN, starts from the BEFORE position): ${bestLine || 'n/a'}
CRITICAL: That alternative belongs to ${mover} on this ply. It is NOT ${seat || 'the other side'}'s next move.`;

  const replyBlock = replySan
    ? `Your best reply (engine, side to move AFTER ${san}): ${replySan}
Your best reply PV (SAN, starts from the AFTER position): ${replyLine || replySan}`
    : `Your best reply: n/a (no after-position line). Do not invent a reply move. Do not reuse the mover alternative as a reply.`;

  const engineBlock = youMoved || !seat
    ? altBlock
    : `${altBlock}
${replyBlock}`;

  const anchor = !seat
    ? `Anchor on engine class, eval change, and the mover better PV. If the move was good, say why. If wrong, name the failed idea and the better plan from the mover alternative / PV.`
    : youMoved
      ? `Anchor on engine class, eval change, and the mover better PV. If YOUR move was good, say why. If wrong, name YOUR failed idea and YOUR better plan from the mover alternative / PV (that line is yours).`
      : `Opponent moved. Mover better alternative is what THEY missed, not your reply. For how YOU should respond, use only "Your best reply" / reply PV. Never tell the reviewer to play the mover alternative.`;

  return `${STYLE}

${task}

${seatBlock}
Opening: ${opening || 'unknown'}
Move ${moveNum} (ply ${ply}): ${san} by ${mover}
Engine class: ${cls || 'unknown'}
Eval before (White cp): ${cpBefore ?? 'n/a'}
Eval after (White cp): ${cpAfter ?? 'n/a'}
${evalHint}
${winBits ? `${winBits}\n` : ''}${engineBlock}
Position before (FEN): ${fenBefore || 'n/a'}
Position after (FEN): ${fenAfter}
Recent moves: ${recent}
${boardBlock ? `${boardBlock}\n` : ''}${address}

${anchor} Do not invent tactics absent from FEN, board images, or PV. No em dashes.`;
}

function sanitizeImages(images) {
  if (!Array.isArray(images) || !images.length) return [];
  const out = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    if (!img || typeof img.data !== 'string' || !img.data) continue;
    const mime = img.mimeType || 'image/png';
    // Rough byte size from base64 length
    const bytes = Math.floor(img.data.length * 0.75);
    if (bytes > MAX_IMAGE_BYTES) continue;
    out.push({ mimeType: mime, data: img.data });
  }
  return out;
}

function buildParts(prompt, images) {
  const parts = [];
  for (const img of sanitizeImages(images)) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }
  parts.push({ text: prompt });
  return parts;
}

function genConfig(thinkingLevel) {
  return {
    temperature: 0.25,
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingLevel },
  };
}

function isThinkingLevelError(msg) {
  return /thinking[_ ]?level|invalid.*(MAX|LOW|HIGH)|unsupported.*thinking/i.test(msg || '');
}

export async function askCoach(prompt, signal, images) {
  const imgs = sanitizeImages(images);
  // 1) Same-origin Vercel proxy (preferred - key stays on server)
  let proxyMiss = false;
  try {
    const r = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, images: imgs.length ? imgs : undefined }),
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
  return callGemini(key, prompt, signal, imgs);
}

async function callGemini(key, prompt, signal, images) {
  const parts = buildParts(prompt, images);
  let lastErr = null;
  for (const level of THINK_LEVELS) {
    const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: genConfig(level),
      }),
      signal,
    });
    const data = await r.json();
    if (r.ok) {
      const text = extractText(data);
      if (!text) throw new Error('Empty coach reply');
      return text;
    }
    const msg = data?.error?.message || `Gemini error ${r.status}`;
    lastErr = new Error(msg);
    if (!isThinkingLevelError(msg)) throw lastErr;
  }
  throw lastErr || new Error('Gemini request failed');
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  const spoken = parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  if (spoken) return spoken;
  return parts.filter(p => p.text).map(p => p.text).join('').trim();
}

function tallyBits(reports) {
  const keys = ['brilliant', 'great', 'best', 'mistake', 'miss', 'blunder', 'inaccuracy'];
  const bits = [];
  for (const k of keys) {
    const n = reports.filter(r => r && r.cls === k).length;
    if (n) bits.push(`${n} ${labelOf(k)}`);
  }
  return bits.join(', ') || 'mostly solid play';
}

export function summariseTallies(reports, moves, meSide = null) {
  if (!meSide) return tallyBits(reports);
  const yours = [], opp = [];
  reports.forEach((r, i) => {
    if (!r || !moves[i]) return;
    (moves[i].color === meSide ? yours : opp).push(r);
  });
  return `Yours (${meSide === 'w' ? 'White' : 'Black'}): ${tallyBits(yours)}; Opponent: ${tallyBits(opp)}`;
}

export function criticalMoments(reports, moves, evals, limit = 5, meSide = null) {
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
    const who = !meSide ? ''
      : moves[i].color === meSide ? 'You · '
      : 'Opponent · ';
    scored.push({
      weight,
      line: `${who}${num}.${dots} ${moves[i].san} = ${labelOf(r.cls)}${evalBit}`,
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
