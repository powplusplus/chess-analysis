// Gemini neural TTS for coach voice.
// Prefer streamGenerateContent (3.1) → first audio ~2s. Batch waits full render (~audio length).

const STREAM_MODEL = 'gemini-3.1-flash-tts-preview';
const BATCH_MODELS = [
  'gemini-2.5-flash-preview-tts',
  'gemini-3.1-flash-tts-preview',
];
// Charon = informative male; accent/timbre steered in the prompt below.
const VOICE = 'Charon';

// Keep prompt tight — long director notes cost input tokens + latency.
const STYLE_PREFIX = `# AUDIO PROFILE: Magnus — Norwegian chess coach
### DIRECTOR'S NOTES
Dry understated Scandinavian male. Soft mid-low chest voice. Calm, wry, matter-of-fact at the board — not theatrical, not American radio.
Pace: Natural conversational. Light pauses only.
Accent: Light Oslo English. Soft consonants. English only.
#### TRANSCRIPT
`;

/** Aim ~1 short sentence first so batch fallback starts ASAP. */
export function splitTtsChunks(text, target = 100) {
  const spoken = String(text || '').replace(/\s+/g, ' ').trim();
  if (!spoken) return [];
  if (spoken.length <= target) return [spoken];

  const parts = spoken.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let buf = '';
  for (const p of parts) {
    if (!p) continue;
    if (!buf) {
      buf = p;
      continue;
    }
    if (buf.length < target && buf.length + 1 + p.length <= target * 1.5) {
      buf += ` ${p}`;
    } else {
      chunks.push(buf);
      buf = p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [spoken];
}

async function loadApiKey() {
  try {
    const m = await import('./coach-config.js');
    return (m.GOOGLE_API_KEY || '').trim();
  } catch {
    return '';
  }
}

function endpoint(model, stream = false) {
  const method = stream ? 'streamGenerateContent' : 'generateContent';
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;
}

function pcmToWavBlob(pcm, sampleRate = 24000) {
  const channels = 1;
  const bits = 16;
  const blockAlign = channels * (bits / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

function parseSampleRate(mime) {
  const m = /rate=(\d+)/i.exec(mime || '');
  return m ? parseInt(m[1], 10) : 24000;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function extractAudio(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const inline = p.inlineData || p.inline_data;
    if (inline?.data) {
      return {
        bytes: b64ToBytes(inline.data),
        mime: inline.mimeType || inline.mime_type || '',
      };
    }
  }
  return null;
}

function ttsBody(text) {
  return {
    contents: [{ role: 'user', parts: [{ text: STYLE_PREFIX + text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: VOICE },
        },
      },
    },
  };
}

async function callGeminiTts(key, model, text, signal) {
  const r = await fetch(`${endpoint(model)}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ttsBody(text)),
    signal,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `TTS ${r.status}`);
  const audio = extractAudio(data);
  if (!audio) throw new Error('Empty TTS audio');
  return pcmToWavBlob(audio.bytes, parseSampleRate(audio.mime));
}

/**
 * Parse Gemini SSE (alt=sse) and yield PCM Uint8Array chunks + sampleRate.
 * Odd-byte carry handled by caller (Web Audio Int16).
 */
export async function* streamGeminiTts(key, text, signal) {
  const spoken = String(text || '').replace(/\s+/g, ' ').trim();
  if (!spoken) throw new Error('Empty TTS text');

  const url = `${endpoint(STREAM_MODEL, true)}?alt=sse&key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ttsBody(spoken)),
    signal,
  });

  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    const err = new Error(data?.error?.message || `TTS stream ${r.status}`);
    err.status = r.status;
    throw err;
  }
  if (!r.body) throw new Error('TTS stream empty body');

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let sampleRate = 24000;
  let gotAudio = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE events separated by blank line
    let sep;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }
        if (data?.error) {
          const err = new Error(data.error.message || 'TTS stream error');
          err.status = data.error.code;
          throw err;
        }
        const audio = extractAudio(data);
        if (!audio) continue;
        sampleRate = parseSampleRate(audio.mime) || sampleRate;
        gotAudio = true;
        yield { pcm: audio.bytes, sampleRate };
      }
    }
  }

  if (!gotAudio) throw new Error('Empty TTS stream');
}

// Static serve.py has no /api/tts — skip after first miss for this session.
let proxyKnownMiss = false;
let cachedApiKey = null;
// 3.1 free tier is tiny (10 RPD). After quota fail, skip stream for session.
let streamQuotaMiss = false;

async function getApiKey() {
  if (cachedApiKey !== null) return cachedApiKey;
  cachedApiKey = await loadApiKey();
  return cachedApiKey;
}

/** Batch WAV (proxy or browser key). Prefer short chunks for low TTFB. */
export async function synthesizeCoachSpeech(text, signal) {
  const spoken = String(text || '').replace(/\s+/g, ' ').trim();
  if (!spoken) throw new Error('Empty TTS text');

  const key = await getApiKey();
  const hasBrowserKey = !!(key && !key.includes('your_google'));

  // Local static: browser key present → skip /api/tts (serve.py has none).
  if (!hasBrowserKey && !proxyKnownMiss) {
    let proxyMiss = false;
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spoken }),
        signal,
      });
      if (r.ok) {
        const ctype = r.headers.get('content-type') || '';
        if (ctype.includes('audio/') || ctype.includes('octet-stream')) {
          return await r.blob();
        }
        const data = await r.json();
        if (data.audio) {
          return pcmToWavBlob(b64ToBytes(data.audio), data.sampleRate || 24000);
        }
        throw new Error('Empty TTS reply');
      }
      const data = await r.json().catch(() => ({}));
      if (r.status === 404 || r.status === 405) proxyMiss = true;
      else if (r.status === 500 && /GOOGLE_API_KEY|not configured/i.test(data.error || '')) proxyMiss = true;
      else throw new Error(data.error || `TTS API ${r.status}`);
    } catch (ex) {
      if (ex.name === 'AbortError') throw ex;
      if (!proxyMiss && !/Failed to fetch|NetworkError|Load failed/i.test(ex.message || '')) throw ex;
      proxyMiss = true;
    }
    if (proxyMiss) proxyKnownMiss = true;
  }

  if (!hasBrowserKey) {
    throw new Error('TTS needs GOOGLE_API_KEY');
  }
  let lastErr;
  for (const model of BATCH_MODELS) {
    try {
      return await callGeminiTts(key, model, spoken, signal);
    } catch (ex) {
      if (ex.name === 'AbortError') throw ex;
      lastErr = ex;
    }
  }
  throw lastErr || new Error('TTS failed');
}

/**
 * Stream coach speech (3.1). Yields { pcm, sampleRate }.
 * Throws if key missing / quota / stream unsupported — caller falls back to batch.
 */
export async function* streamCoachSpeech(text, signal) {
  const spoken = String(text || '').replace(/\s+/g, ' ').trim();
  if (!spoken) throw new Error('Empty TTS text');
  if (streamQuotaMiss) throw new Error('TTS stream quota');

  const key = await getApiKey();
  if (!key || key.includes('your_google')) {
    throw new Error('TTS needs GOOGLE_API_KEY');
  }

  try {
    yield* streamGeminiTts(key, spoken, signal);
  } catch (ex) {
    if (ex.name === 'AbortError') throw ex;
    if (/quota|rate|RESOURCE_EXHAUSTED|429/i.test(ex.message || '') || ex.status === 429) {
      streamQuotaMiss = true;
    }
    throw ex;
  }
}
