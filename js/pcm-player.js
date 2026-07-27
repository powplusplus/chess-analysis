/** Convert complete little-endian signed 16-bit samples to Web Audio floats. */
export function pcm16LeToFloat32(bytes) {
  const pcm = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const samples = new Float32Array(Math.floor(pcm.byteLength / 2));
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let i = 0; i < samples.length; i++) {
    const value = view.getInt16(i * 2, true);
    samples[i] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return samples;
}

/**
 * Incrementally schedules mono PCM without gaps. The context is deliberately
 * created lazily: a failed/empty stream must not count as started playback.
 */
export class PcmStreamPlayer {
  constructor({
    createContext = () => new (window.AudioContext || window.webkitAudioContext)(),
    onSchedule = () => {},
  } = {}) {
    this.createContext = createContext;
    this.onSchedule = onSchedule;
    this.context = null;
    this.nextStart = 0;
    this.sources = new Set();
    this.carry = null;
    this.carryRate = null;
    this.scheduled = false;
    this.stopped = false;
  }

  _schedule(bytes, sampleRate) {
    if (!bytes.byteLength || this.stopped) return false;
    if (!this.context) {
      this.context = this.createContext();
      this.nextStart = this.context.currentTime;
      if (this.context.state === 'suspended') this.context.resume?.().catch(() => {});
    }
    const samples = pcm16LeToFloat32(bytes);
    if (!samples.length) return false;
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const start = Math.max(this.nextStart, this.context.currentTime);
    source.start(start);
    this.nextStart = start + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    if (!this.scheduled) this.onSchedule();
    this.scheduled = true;
    return true;
  }

  append(chunk, sampleRate = 24000) {
    if (this.stopped) return false;
    const pcm = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    let offset = 0;
    let didSchedule = false;

    // A sample split across responses belongs to the rate of the response in
    // which it began. This also avoids silently dropping an odd boundary byte.
    if (this.carry !== null && pcm.byteLength) {
      didSchedule = this._schedule(Uint8Array.of(this.carry, pcm[0]), this.carryRate) || didSchedule;
      this.carry = null;
      this.carryRate = null;
      offset = 1;
    }

    const completeLength = (pcm.byteLength - offset) & ~1;
    if (completeLength) {
      didSchedule = this._schedule(pcm.subarray(offset, offset + completeLength), sampleRate) || didSchedule;
      offset += completeLength;
    }
    if (offset < pcm.byteLength) {
      this.carry = pcm[offset];
      this.carryRate = sampleRate;
    }
    return didSchedule;
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.carry = null;
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already ended */ }
    }
    this.sources.clear();
    const context = this.context;
    this.context = null;
    if (context) {
      try { await context.close(); } catch { /* already closed */ }
    }
  }
}

/** Stream one segment, falling back only if the stream never scheduled audio. */
export async function consumePcmStream({ stream, player, fallback, signal, isCurrent = () => true }) {
  let scheduled = false;
  try {
    for await (const { pcm, sampleRate } of stream) {
      if (signal?.aborted || !isCurrent()) return { scheduled, cancelled: true };
      scheduled = player.append(pcm, sampleRate) || scheduled;
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || !isCurrent()) {
      return { scheduled, cancelled: true };
    }
    if (scheduled) return { scheduled, error };
    return { scheduled, fallback: await fallback(error), error };
  }
  if (!scheduled && !signal?.aborted && isCurrent()) {
    return { scheduled, fallback: await fallback() };
  }
  return { scheduled };
}
