// Streaming Gemini TTS proxy. Pipes streamGenerateContent SSE straight to the
// browser so the deployed site gets first-audio ~2s instead of waiting for a
// full batch render (~audio length). Keeps GOOGLE_API_KEY on the server.
const STREAM_MODELS = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
];
const VOICE = 'Charon';

const STYLE_PREFIX = `# AUDIO PROFILE: Magnus — Norwegian chess coach
### DIRECTOR'S NOTES
Dry understated Scandinavian male. Soft mid-low chest voice. Calm, wry, matter-of-fact at the board — not theatrical, not American radio.
Pace: Natural conversational. Light pauses only.
Accent: Light Oslo English. Soft consonants. English only.
#### TRANSCRIPT
`;

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
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

function isQuota(msg) {
  return /quota|rate|high demand|overloaded|RESOURCE_EXHAUSTED|429|503/i.test(msg || '');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const text = body && body.text;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing text' });
  }

  let lastErr = null;
  let lastStatus = 502;
  for (const model of STREAM_MODELS) {
    let upstream;
    try {
      upstream = await fetch(`${endpoint(model)}?alt=sse&key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ttsBody(text)),
      });
    } catch (ex) {
      lastErr = ex.message || 'TTS stream fetch failed';
      continue;
    }

    if (!upstream.ok || !upstream.body) {
      const data = await upstream.json().catch(() => ({}));
      lastErr = data?.error?.message || `TTS stream ${upstream.status}`;
      lastStatus = upstream.status || 502;
      // Try the next model on quota / overload; otherwise stop.
      if (isQuota(lastErr) || isQuota(String(upstream.status))) continue;
      break;
    }

    // Headers can only be set once — commit before piping any bytes.
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.status(200);
    try {
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
    } catch (ex) {
      // Upstream dropped mid-stream — end what we have; client falls back.
      lastErr = ex.message || 'TTS stream interrupted';
    }
    return res.end();
  }

  const status = lastStatus >= 400 ? lastStatus : 502;
  return res.status(status).json({ error: lastErr || 'TTS stream failed' });
}
