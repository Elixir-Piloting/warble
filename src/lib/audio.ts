import { audioBuffersToWavBlob } from "@/lib/pcm";

/** Decode any browser-decodable audio blob into 16-bit PCM WAV bytes. */
export async function blobToWavBytes(blob: Blob): Promise<Uint8Array> {
  const ctx = new AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const wavBlob = audioBuffersToWavBlob(
      [decoded],
      decoded.sampleRate,
      decoded.numberOfChannels
    );
    return new Uint8Array(await wavBlob.arrayBuffer());
  } finally {
    void ctx.close();
  }
}

/** Read a path (from the native picker) into raw bytes. */
async function readPathBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return readFile(path);
}

/**
 * Convert a picked file into WAV bytes: pass WAV through losslessly, decode
 * every other format (mp3/m4a/mp4/ogg/…) via the browser and re-encode.
 */
export async function fileToWavBytes(path: string): Promise<Uint8Array> {
  const raw = await readPathBytes(path);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "wav" || ext === "wave") return raw;
  return blobToWavBytes(new Blob([raw as BlobPart]));
}
