/**
 * Transport player for a completed clip. Concatenates the buffered AudioBuffers
 * into one AudioBuffer so it behaves like a regular audio player: play / pause /
 * resume / stop / seek, plus currentTime/duration for a progress bar.
 */
export class ClipPlayer {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private buffers: AudioBuffer[] = [];
  private offsetSec = 0;
  private startWall = 0;
  private playing = false;
  private totalSec = 0;

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  get duration(): number {
    return this.totalSec;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTime(): number {
    if (!this.playing) return this.offsetSec;
    const t = this.offsetSec + (performance.now() - this.startWall) / 1000;
    return Math.min(this.totalSec, t);
  }

  /**
   * Load a set of finished AudioBuffers onto the transport. Stops any playback
   * and resets the position to 0. Returns the total duration in seconds.
   */
  load(buffers: AudioBuffer[]): number {
    this.teardownSource();
    this.buffers = [...buffers];
    this.totalSec = this.buffers.reduce((s, b) => s + b.duration, 0);
    this.offsetSec = 0;
    this.playing = false;
    return this.totalSec;
  }

  play(): void {
    if (this.totalSec <= 0 || this.playing) return;
    if (this.offsetSec >= this.totalSec - 0.001) this.offsetSec = 0;
    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") void ctx.resume();
    const concat = this.buildConcat();
    if (!concat) return;
    const src = ctx.createBufferSource();
    src.buffer = concat;
    src.connect(ctx.destination);
    src.onended = () => this.onSourceEnded();
    this.src = src;
    src.start(0, this.offsetSec);
    this.startWall = performance.now();
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.offsetSec = this.currentTime;
    this.playing = false;
    this.teardownSource();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Seek to `t` seconds. Continues playing from the new position if playing. */
  seek(t: number): void {
    if (this.totalSec <= 0) return;
    this.offsetSec = Math.max(0, Math.min(this.totalSec, t));
    if (!this.playing) return;
    this.teardownSource();
    this.playing = false;
    this.play();
  }

  /** Stop playback and reset to 0, keeping the clip loaded. */
  stop(): void {
    this.playing = false;
    this.teardownSource();
    this.offsetSec = 0;
  }

  private onSourceEnded(): void {
    if (!this.playing) return;
    this.playing = false;
    this.offsetSec = this.totalSec;
    this.src = null;
  }

  private buildConcat(): AudioBuffer | null {
    if (this.buffers.length === 0) return null;
    const first = this.buffers[0];
    const channels = first.numberOfChannels;
    const sampleRate = first.sampleRate;
    const totalFrames = this.buffers.reduce((n, b) => n + b.length, 0);
    const ctx = this.ensureCtx();
    const out = ctx.createBuffer(channels, totalFrames, sampleRate);
    const dst: Float32Array[] = [];
    for (let c = 0; c < channels; c++) dst.push(out.getChannelData(c));
    let frame = 0;
    for (const b of this.buffers) {
      for (let c = 0; c < channels; c++) {
        const src = b.numberOfChannels > c ? b.getChannelData(c) : b.getChannelData(0);
        dst[c].set(src, frame);
      }
      frame += b.length;
    }
    return out;
  }

  private teardownSource(): void {
    if (this.src) {
      try {
        this.src.stop();
      } catch {
        /* already ended */
      }
      this.src.onended = null;
      this.src = null;
    }
  }

  dispose(): void {
    this.stop();
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
