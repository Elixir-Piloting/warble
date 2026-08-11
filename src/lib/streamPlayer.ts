import { i16BytesToFloat32 } from "./pcm";

/**
 * Minimum buffered audio (seconds) before playback starts. Prevents the player
 * firing on the first 1-2 chunks alone and gives live streaming real headroom
 * so it can sustain gapless playback once it starts.
 */
export const STREAM_START_SEC = 1.5;

/**
 * Lead-in (seconds) before the first chunk plays once the buffering threshold
 * is met. Small positive offset so the start of speech isn't clipped.
 */
export const PLAY_START_LEAD_SEC = 0.05;

/**
 * Live streaming playback: AudioBuffers are enqueued as chunks arrive and
 * scheduled back-to-back on the Web Audio clock. Playback begins as soon as
 * STREAM_START_SEC of audio has buffered (so it never fires on just the first
 * couple of chunks), or immediately when `finish()` is called (the stream is
 * complete and nothing more will arrive).
 */
export class StreamPlayer {
  private ctx: AudioContext | null = null;
  private queued: AudioBuffer[] = [];
  private queuedDuration = 0;
  private nextTime = 0;
  private started = false;
  private startWallTime = 0;
  private lastArrived = false;
  private stopped = false;
  private totalSeconds = 0;
  private active = new Set<AudioBufferSourceNode>();
  private archive: AudioBuffer[] = [];
  private positionBase = 0;
  private userPaused = false;

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  decodeChunk(pcm: number[], sampleRate: number, channels: number): AudioBuffer {
    const ctx = this.ensureCtx();
    const float = i16BytesToFloat32(pcm);
    const frames = Math.floor(float.length / channels);
    const buffer = ctx.createBuffer(channels, frames, sampleRate);
    for (let c = 0; c < channels; c++) {
      const channel = new Float32Array(frames);
      for (let i = 0; i < frames; i++) channel[i] = float[i * channels + c];
      buffer.copyToChannel(channel, c);
    }
    return buffer;
  }

  /** Queue one decoded chunk. Returns its duration in seconds. */
  enqueue(audioBuffer: AudioBuffer): number {
    if (this.stopped) return 0;
    this.archive.push(audioBuffer);
    this.queued.push(audioBuffer);
    this.queuedDuration += audioBuffer.duration;
    this.totalSeconds += audioBuffer.duration;
    this.drain();
    return audioBuffer.duration;
  }

  /** Signals the protocol `done` event: nothing more will arrive. */
  finish(): void {
    if (this.stopped) return;
    this.lastArrived = true;
    this.drain();
  }

  private drain(): void {
    if (this.stopped) return;
    // Live streaming: start once enough audio has buffered (headroom), or
    // immediately when the whole stream has arrived. Never on 1-2 chunks.
    const ready = !this.userPaused && (this.lastArrived || this.queuedDuration >= STREAM_START_SEC);
    if (!ready || this.queued.length === 0) return;
    if (!this.started) {
      if (this.ctx!.state === "suspended") void this.ctx!.resume();
      this.nextTime = this.ctx!.currentTime + PLAY_START_LEAD_SEC;
      this.startWallTime = performance.now();
      this.positionBase = 0;
      this.started = true;
    }
    while (this.queued.length > 0) {
      const buf = this.queued.shift()!;
      this.queuedDuration -= buf.duration;
      this.schedule(buf);
    }
  }

  private schedule(buf: AudioBuffer): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => this.active.delete(src);
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this.active.add(src);
  }

  /** Total seconds of audio handed to `enqueue` since the last `stop`. */
  get streamedSeconds(): number {
    return this.totalSeconds;
  }

  /**
   * Wall-clock playback position (seconds) of the current live stream. Used to
   * hand the buffered clip to a transport player at the exact spot live
   * playback reached, so the switch is seamless.
   */
  get wallPosition(): number {
    if (!this.ctx || !this.started) return 0;
    const elapsed = this.ctx.currentTime - this.startWallTime;
    return Math.max(0, Math.min(this.positionBase + elapsed, this.totalSeconds));
  }

  get playing(): boolean {
    return this.started && this.active.size > 0;
  }

  /** Prepare for a new live stream (re-arms after a stop/replay). */
  begin(): void {
    this.stopped = false;
    this.hardReset();
  }

  /**
   * Replay previously generated chunks (e.g. the last completed stream).
   * Returns the total duration in seconds.
   */
  replay(buffers: AudioBuffer[]): number {
    this.begin();
    let total = 0;
    for (const b of buffers) {
      total += this.enqueue(b);
    }
    this.finish();
    return total;
  }

  stop(): void {
    this.stopped = true;
    this.hardReset();
  }

  pause(): void {
    if (!this.started || this.stopped) return;
    this.positionBase = this.wallPosition;
    this.userPaused = true;
    for (const source of this.active) {
      try { source.stop(); } catch { /* already ended */ }
    }
    this.active.clear();
    this.started = false;
  }

  resume(): void {
    if (!this.userPaused || this.stopped || this.archive.length === 0) return;
    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") void ctx.resume();
    this.userPaused = false;
    this.queued = [];
    this.queuedDuration = 0;
    const first = this.archive[0];
    const frames = this.archive.reduce((total, buffer) => total + buffer.length, 0);
    const combined = ctx.createBuffer(first.numberOfChannels, frames, first.sampleRate);
    let frame = 0;
    for (const buffer of this.archive) {
      for (let channel = 0; channel < combined.numberOfChannels; channel++) {
        combined.copyToChannel(buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)), channel, frame);
      }
      frame += buffer.length;
    }
    const source = ctx.createBufferSource();
    source.buffer = combined;
    source.connect(ctx.destination);
    source.onended = () => this.active.delete(source);
    this.startWallTime = ctx.currentTime;
    this.nextTime = ctx.currentTime + Math.max(0, combined.duration - this.positionBase);
    this.started = true;
    source.start(ctx.currentTime, Math.min(this.positionBase, combined.duration));
    this.active.add(source);
  }

  private hardReset(): void {
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    }
    this.active.clear();
    this.queued = [];
    this.queuedDuration = 0;
    this.totalSeconds = 0;
    this.nextTime = 0;
    this.started = false;
    this.startWallTime = 0;
    this.lastArrived = false;
    this.archive = [];
    this.positionBase = 0;
    this.userPaused = false;
  }

  dispose(): void {
    this.stop();
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
