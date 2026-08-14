/** Decode a little-endian i16 PCM sample array into normalized f32 samples. */
export function i16BytesToFloat32(pcm: number[]): Float32Array {
  const out = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < out.length; i++) {
    const u16 = (pcm[i * 2] ?? 0) | (((pcm[i * 2 + 1] ?? 0) & 0xff) << 8);
    const signed = u16 >= 32768 ? u16 - 65536 : u16;
    out[i] = signed / 32768;
  }
  return out;
}

/** Concatenate AudioBuffers into a 16-bit PCM WAV Blob for download. */
export function audioBuffersToWavBlob(buffers: AudioBuffer[], sampleRate: number, channels: number): Blob {
  const frames = buffers.reduce((n, b) => n + b.length, 0);
  const pcm = new Int16Array(frames * channels);
  let off = 0;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i++) {
      for (let c = 0; c < channels; c++) {
        const s = buf.getChannelData(c)[i];
        const clamped = Math.max(-1, Math.min(1, s));
        pcm[off++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
    }
  }
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Int16Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: "audio/wav" });
}
