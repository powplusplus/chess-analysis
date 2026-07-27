import test from 'node:test';
import assert from 'node:assert/strict';
import { consumePcmStream, pcm16LeToFloat32, PcmStreamPlayer } from '../js/pcm-player.js';

function audioHarness(currentTime = 10) {
  const starts = [];
  const sources = [];
  const buffers = [];
  const context = {
    currentTime,
    state: 'running',
    destination: {},
    closed: false,
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      const buffer = { duration: length / sampleRate, sampleRate, getChannelData: () => data, data };
      buffers.push(buffer);
      return buffer;
    },
    createBufferSource() {
      const source = {
        stopped: false,
        connect() {},
        start(at) { starts.push(at); },
        stop() { this.stopped = true; },
      };
      sources.push(source);
      return source;
    },
    async close() { this.closed = true; },
  };
  return { context, starts, sources, buffers };
}

test('converts signed little-endian PCM samples to floats', () => {
  const values = pcm16LeToFloat32(Uint8Array.of(0x00, 0x80, 0, 0, 0xff, 0x7f));
  assert.deepEqual([...values], [-1, 0, 1]);
});

test('preserves an odd byte across chunks and its original sample rate', () => {
  const h = audioHarness();
  const player = new PcmStreamPlayer({ createContext: () => h.context });
  assert.equal(player.append(Uint8Array.of(0x34), 16000), false);
  assert.equal(player.append(Uint8Array.of(0x12, 0, 0), 24000), true);
  assert.deepEqual(h.buffers.map(b => b.sampleRate), [16000, 24000]);
  assert.ok(Math.abs(h.buffers[0].data[0] - 0x1234 / 0x7fff) < 1e-6);
});

test('schedules buffers consecutively and honors each chunk sample rate', () => {
  const h = audioHarness(2);
  const player = new PcmStreamPlayer({ createContext: () => h.context });
  player.append(new Uint8Array(4), 2);
  player.append(new Uint8Array(6), 3);
  assert.deepEqual(h.starts, [2, 3]);
  assert.deepEqual(h.buffers.map(b => b.sampleRate), [2, 3]);
});

test('stop cancels sources, closes the context, and rejects stale chunks', async () => {
  const h = audioHarness();
  const player = new PcmStreamPlayer({ createContext: () => h.context });
  player.append(new Uint8Array(2), 24000);
  await player.stop();
  assert.equal(h.sources[0].stopped, true);
  assert.equal(h.context.closed, true);
  assert.equal(player.append(new Uint8Array(2), 24000), false);
  assert.equal(h.sources.length, 1);
});

test('uses batch fallback when streaming fails before playable audio', async () => {
  let fallbackCalls = 0;
  async function* stream() { throw new Error('offline'); }
  const result = await consumePcmStream({
    stream: stream(), player: { append: () => false },
    fallback: async () => { fallbackCalls++; return 'batch'; },
  });
  assert.equal(fallbackCalls, 1);
  assert.equal(result.fallback, 'batch');
});

test('does not replay through fallback after partial streamed audio', async () => {
  let fallbackCalls = 0;
  async function* stream() {
    yield { pcm: new Uint8Array(2), sampleRate: 24000 };
    throw new Error('mid-stream');
  }
  const result = await consumePcmStream({
    stream: stream(), player: { append: () => true },
    fallback: async () => { fallbackCalls++; },
  });
  assert.equal(result.scheduled, true);
  assert.equal(fallbackCalls, 0);
});

test('cancellation prevents a stale yielded chunk from being scheduled', async () => {
  const controller = new AbortController();
  let appends = 0;
  async function* stream() { controller.abort(); yield { pcm: new Uint8Array(2), sampleRate: 24000 }; }
  const result = await consumePcmStream({
    stream: stream(), signal: controller.signal, player: { append: () => ++appends }, fallback: async () => {},
  });
  assert.equal(result.cancelled, true);
  assert.equal(appends, 0);
});
