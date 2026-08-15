import { generateTtsPreview } from "@/lib/api";

export const PREVIEW_TEXT =
  "Hello! This is a preview of my voice. I hope you enjoy creating with me.";

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export async function getVoicePreviewUrl(spec: string): Promise<string | null> {
  const hit = cache.get(spec);
  if (hit) return hit;
  const inFlight = pending.get(spec);
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      const bytes = await generateTtsPreview(spec, PREVIEW_TEXT);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
      cache.set(spec, url);
      return url;
    } catch {
      return null;
    } finally {
      pending.delete(spec);
    }
  })();
  pending.set(spec, promise);
  return promise;
}
