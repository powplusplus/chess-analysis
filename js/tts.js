// Gemini neural TTS for coach voice (PCM → WAV). Falls back handled by caller.

// Low-latency first. Pro dropped — too slow for coach turnaround.
const TTS_MODELS = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
];
// Charon = informative male; accent/timbre steered hard in the prompt below.
const VOICE = 'Charon';

// Keep prompt tight — long director notes cost input tokens + latency.
const STYLE_PREFIX = `# AUDIO PROFILE: Magnus — Norwegian chess coach
### DIRECTOR'S NOTES
Dry understated Scandinavian male. Soft mid-low chest voice. Calm, wry, matter-of-fact at the board — not theatrical, not American radio.
Pace: Unhurried with natural pauses.
Accent: Light Oslo English. Soft consonants. English only.
#### TRANSCRIPT
`;

/** Aim ~1 short sentence first so audio starts ASAP. */
export function splitTtsChunks(text, target = 160) {
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
    if (buf.length < target && buf.length + 1 + p.length <= target * 1.6) {
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

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
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

async function callGeminiTts(key, model, text, signal) {
  const r = await fetch(`${endpoint(model)}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: STYLE_PREFIX + text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: VOICE },
          },
        },
      },
    }),
    signal,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `TTS ${r.status}`);
  const audio = extractAudio(data);
  if (!audio) throw new Error('Empty TTS audio');
  return pcmToWavBlob(audio.bytes, parseSampleRate(audio.mime));
}

// Static serve.py has no /api/tts — skip after first miss for this session.
let proxyKnownMiss = false;
let cachedApiKey = null;

async function getApiKey() {
  if (cachedApiKey !== null) return cachedApiKey;
  cachedApiKey = await loadApiKey();
  return cachedApiKey;
}

/** Returns a WAV Blob, or throws. Tries /api/tts then browser key. */
export async function synthesizeCoachSpeech(text, signal) {
  const spoken = String(text || '').replace(/\s+/g, ' ').trim();
  if (!spoken) throw new Error('Empty TTS text');

  // 1) Vercel proxy (once we know it misses, go straight to browser key)
  if (!proxyKnownMiss) {
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

  // 2) Browser key — Flash only
  const key = await getApiKey();
  if (!key || key.includes('your_google')) {
    throw new Error('TTS needs GOOGLE_API_KEY');
  }
  let lastErr;
  for (const model of TTS_MODELS) {
    try {
      return await callGeminiTts(key, model, spoken, signal);
    } catch (ex) {
      if (ex.name === 'AbortError') throw ex;
      lastErr = ex;
    }
  }
  throw lastErr || new Error('TTS failed');
}
