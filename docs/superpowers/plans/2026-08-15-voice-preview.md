# Voice Preview Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users hear any voice before choosing it — a lazily generated, cached preview plays through the bottom audio player from the voice browser rows and the clone wizard success screen.

**Architecture:** A new Tauri command `generate_tts_preview(voiceSpec, text)` resolves a voice and returns WAV bytes without persisting history. The frontend caches a blob URL per voice spec (`lib/preview.ts`). `AudioPlayerProvider` is lifted from the footer to wrap the whole app in `App.tsx`, so the footer, voice browser, and wizard share one player. The footer is generalized to show a history clip OR a voice preview; play/pause buttons appear on voice rows and the wizard's success screen.

**Tech Stack:** Rust (Tauri commands), React 19, Vite, Tailwind v4, shadcn/ui audio-player context.

## Global Constraints

- TypeScript `strict` with `noUnusedLocals`/`noUnusedParameters`; frontend verification = `pnpm exec tsc --noEmit` (exit 0) + `pnpm build` (exit 0).
- Rust verification = `cargo test` in `src-tauri` (exit 0) + `cargo build` (exit 0). Do NOT run full Tauri dev (needs a display).
- Prettier (frontend): `semi: true`, `trailingComma: "es5"`, `printWidth: 120`, `singleQuote: false`, `tabWidth: 2`, tailwind plugin. App components use trailing semicolons.
- `@/` alias → `src/`. Components live in `src/components/ui/`.
- Preview spec strings: stock voices use their id (`alba`, ...); custom voices use `VoiceRecord.embeddingsPath`.
- The spec: `docs/superpowers/specs/2026-08-15-voice-preview-design.md`.
- `generate_tts_preview` must NOT persist history, must NOT emit `tts://` events, must NOT touch the cancel flag.

---

### Task 1: Backend — `wav_bytes` helper + `generate_tts_preview` command

**Files:**
- Modify: `src-tauri/src/store.rs` (`write_wav_file`, add `wav_bytes`, add test)
- Modify: `src-tauri/src/tts.rs` (add `generate_tts_preview`)
- Modify: `src-tauri/src/lib.rs` (register command)

**Interfaces:**
- Consumes: existing `store::write_wav_file`, `tts::resolve_voice_state`, `pocket_tts::audio::pcm_i16_le_bytes`, `model.generate_stream`.
- Produces: `pub fn store::wav_bytes(pcm: &[u8], sample_rate: u32, channels: u16) -> Result<Vec<u8>, String>`; `#[tauri::command] pub async fn tts::generate_tts_preview(state: State<'_, TtsState>, voice_spec: String, text: String) -> Result<tauri::ipc::Response, String>`. Task 2 calls the command as `invoke("generate_tts_preview", { voiceSpec, text })` expecting `ArrayBuffer`.

- [ ] **Step 1: Extract `wav_bytes` in `store.rs`**

Replace the body of `write_wav_file` (currently `src-tauri/src/store.rs:288-312`) with a delegation, and add `wav_bytes` above it:

```rust
/// Encode 16-bit PCM WAV bytes from little-endian interleaved i16 sample
/// bytes (`pcm` is exactly what `pocket_tts::audio::pcm_i16_le_bytes`
/// produces).
pub fn wav_bytes(pcm: &[u8], sample_rate: u32, channels: u16) -> Result<Vec<u8>, String> {
    use std::io::Write;
    let data_size = pcm.len() as u32;
    let byte_rate = sample_rate * channels as u32 * 2;
    let block_align = channels as u16 * 2;
    let mut out = Vec::with_capacity(44 + pcm.len());
    out.write_all(b"RIFF").map_err(|e| e.to_string())?;
    out.write_all(&(36 + data_size).to_le_bytes()).map_err(|e| e.to_string())?;
    out.write_all(b"WAVE").map_err(|e| e.to_string())?;
    out.write_all(b"fmt ").map_err(|e| e.to_string())?;
    out.write_all(&16u32.to_le_bytes()).map_err(|e| e.to_string())?;
    out.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?; // PCM
    out.write_all(&channels.to_le_bytes()).map_err(|e| e.to_string())?;
    out.write_all(&sample_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    out.write_all(&byte_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    out.write_all(&block_align.to_le_bytes()).map_err(|e| e.to_string())?;
    out.write_all(&16u16.to_le_bytes()).map_err(|e| e.to_string())?; // bits per sample
    out.write_all(b"data").map_err(|e| e.to_string())?;
    out.write_all(&data_size.to_le_bytes()).map_err(|e| e.to_string())?;
    out.write_all(pcm).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Write a standard 16-bit PCM WAV file from little-endian interleaved i16
/// sample bytes.
pub fn write_wav_file(path: &Path, pcm: &[u8], sample_rate: u32, channels: u16) -> Result<(), String> {
    let bytes = wav_bytes(pcm, sample_rate, channels)?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Add a `wav_bytes` roundtrip test**

In the `mod tests` block of `store.rs`, after `test_write_wav_file_roundtrip`, add:

```rust
    #[test]
    fn test_wav_bytes_roundtrip() {
        let pcm: Vec<u8> = vec![0xff, 0xff, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0];
        let sample_rate = 24000u32;
        let channels = 2u16;
        let bytes = wav_bytes(&pcm, sample_rate, channels).expect("encode wav");

        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[12..16], b"fmt ");
        assert_eq!(&bytes[36..40], b"data");

        let data_size = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
        let sr = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
        let bits = u16::from_le_bytes(bytes[34..36].try_into().unwrap());

        assert_eq!(data_size, pcm.len() as u32);
        assert_eq!(sr, sample_rate);
        assert_eq!(bits, 16);
        assert_eq!(&bytes[44..], pcm.as_slice());
    }
```

- [ ] **Step 3: Run the store tests**

Run: `cargo test --lib` (workdir `src-tauri`)
Expected: PASS, including `test_wav_bytes_roundtrip` and `test_write_wav_file_roundtrip`.

- [ ] **Step 4: Add `generate_tts_preview` in `tts.rs`**

Add this after `generate_tts_stream` (after line 442):

```rust
/// Generate a short speech sample for a voice spec WITHOUT persisting it to
/// history or emitting stream events. Returns the WAV bytes so the frontend
/// can play it as a preview blob. `voice_spec` uses the same formats as
/// `get_tts_voice_state` (stock name, `hf://` URL, or local path).
#[tauri::command]
pub async fn generate_tts_preview(
    state: State<'_, TtsState>,
    voice_spec: String,
    text: String,
) -> Result<tauri::ipc::Response, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "model lock poisoned".to_string())?
        .as_ref()
        .ok_or("no model loaded; call load_tts_model first")?
        .clone();

    let spec_out = voice_spec.clone();
    let model_for_resolve = model.clone();
    let voice_state =
        tauri::async_runtime::spawn_blocking(move || -> Result<ModelState, String> {
            resolve_voice_state(&model_for_resolve, &spec_out)
        })
        .await
        .map_err(|e| format!("voice task panicked: {e}"))??;

    let sample_rate = model.sample_rate as u32;
    let channels = model.mimi.channels as u16;

    let generated = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut pcm_accum: Vec<u8> = Vec::new();
        for chunk in model.generate_stream(&text, &voice_state) {
            let tensor = chunk.map_err(|e| format!("generation failed: {e}"))?;
            let tensor = tensor.squeeze(0).map_err(|e| format!("audio shaping failed: {e}"))?;
            let pcm = pocket_tts::audio::pcm_i16_le_bytes(&tensor)
                .map_err(|e| format!("audio encoding failed: {e}"))?;
            pcm_accum.extend_from_slice(&pcm);
        }
        crate::store::wav_bytes(&pcm_accum, sample_rate, channels)
    })
    .await
    .map_err(|e| format!("preview task panicked: {e}"))??;

    Ok(tauri::ipc::Response::new(generated))
}
```

- [ ] **Step 5: Register the command in `lib.rs`**

In `src-tauri/src/lib.rs` invoke_handler list, add after `tts::generate_tts_stream,` (line 28):

```rust
            tts::generate_tts_preview,
```

- [ ] **Step 6: Verify build + tests**

Run: `cargo build` (workdir `src-tauri`) — exit 0.
Run: `cargo test --lib` (workdir `src-tauri`) — exit 0, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/store.rs src-tauri/src/tts.rs src-tauri/src/lib.rs
git commit -m "feat(tts): generate non-persisted voice preview audio"
```

---

### Task 2: Frontend — `generateTtsPreview` API + `lib/preview.ts`

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/lib/preview.ts`

**Interfaces:**
- Consumes: `invoke` from `@tauri-apps/api/core`; the Task 1 command `generate_tts_preview`.
- Produces: `export function generateTtsPreview(voiceSpec: string, text: string): Promise<ArrayBuffer>`; `export const PREVIEW_TEXT: string`; `export async function getVoicePreviewUrl(spec: string): Promise<string | null>`. Tasks 4 and 5 consume `getVoicePreviewUrl` and `PREVIEW_TEXT`.

- [ ] **Step 1: Add `generateTtsPreview` to `api.ts`**

Append to `src/lib/api.ts`:

```ts
export function generateTtsPreview(voiceSpec: string, text: string): Promise<ArrayBuffer> {
  return invoke("generate_tts_preview", { voiceSpec, text });
}
```

- [ ] **Step 2: Create `lib/preview.ts`**

Create `src/lib/preview.ts`:

```ts
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
```

- [ ] **Step 3: Verify typecheck + build**

Run: `pnpm exec tsc --noEmit` — exit 0.
Run: `pnpm build` — exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/lib/preview.ts
git commit -m "feat(frontend): cached voice preview URL helper"
```

---

### Task 3: Lift `AudioPlayerProvider` + generalize the bottom footer

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/tts-workspace.tsx`

**Interfaces:**
- Consumes: `AudioPlayerProvider`, `useAudioPlayer`, `AudioPlayerItem` from `@/components/ui/audio-player`; Task 2's preview URL helper (not directly here); existing `TtsWorkspaceProps`.
- Produces: `AudioPlayerProvider` wrapping both `<TtsWorkspace>` and `<VoiceCloneWizard>` in `App.tsx`; footer accepts nullable `clip`/`src` and self-gates on a "preview" active item (`activeItem.data.kind === "preview"`). Task 4 relies on `useAudioPlayer()` being available inside `VoiceBrowser`, and on the footer rendering when a preview item is active.

- [ ] **Step 1: Wrap the app in `AudioPlayerProvider`**

In `src/App.tsx`, import `AudioPlayerProvider` and wrap the return fragment:

```tsx
import { AudioPlayerProvider } from "@/components/ui/audio-player";
```

Replace the `return (<>...</>);` (currently lines ~457-509) with:

```tsx
  return (
    <AudioPlayerProvider>
      <TtsWorkspace
        ... all existing props unchanged ...
      />
      <VoiceCloneWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCloned={(voice) => void handleCloned(voice)}
      />
    </AudioPlayerProvider>
  );
```

Only the wrapper changes; all existing props are preserved verbatim.

- [ ] **Step 2: Remove `AudioPlayerProvider` from the footer**

In `src/components/tts-workspace.tsx`, remove the `AudioPlayerProvider` import if it is no longer used elsewhere in the file (check: it is only used by `GeneratedAudioPlayer`). Replace the `GeneratedAudioPlayer` function (currently lines 188-218) with a provider-less, self-gating version:

```tsx
function GeneratedAudioPlayer({
  clip,
  src,
  onDownload,
}: {
  clip: HistoryEntry | null;
  src: string | null;
  onDownload: (entry: HistoryEntry) => void;
}) {
  const player = useAudioPlayer<{ kind: "preview"; name: string }>();
  const active = player.activeItem;
  const preview = active && active.data?.kind === "preview" ? active : null;
  const showClip = !preview && clip != null && src != null;
  if (!preview && !showClip) return null;

  const item: AudioPlayerItem<unknown> = preview
    ? (active as AudioPlayerItem<{ kind: "preview"; name: string }>)
    : { id: clip!.id, src: src! };

  return (
    <footer className="border-border bg-background flex min-h-20 shrink-0 items-center gap-5 border-t px-5 py-3">
      <div className="min-w-0 flex-1 basis-0">
        <p className="truncate text-sm font-medium">{preview ? preview.data!.name : clip!.name}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {preview ? "Voice preview" : `Local voice · ${clip!.speechSec.toFixed(2)} seconds`}
        </p>
      </div>
      <div className="flex w-full max-w-xl items-center gap-3">
        <AudioPlayerButton item={item} size="icon-lg" className="rounded-full" />
        <AudioPlayerTime />
        <AudioPlayerProgress className="min-w-20 flex-1" />
        <AudioPlayerDuration />
        <AudioPlayerSpeed size="icon-sm" />
      </div>
      {!preview && (
        <div className="flex flex-1 basis-0 justify-end">
          <Button variant="ghost" size="icon-sm" onClick={() => onDownload(clip!)} aria-label="Download WAV">
            <Download />
          </Button>
        </div>
      )}
    </footer>
  );
}
```

Add `AudioPlayerItem` to the audio-player import in this file (line 3-10 block already imports `AudioPlayerButton`, `AudioPlayerDuration`, `AudioPlayerProgress`, `AudioPlayerProvider`, `AudioPlayerSpeed`, `AudioPlayerTime`; add `useAudioPlayer` and `type AudioPlayerItem`).

- [ ] **Step 3: Always render the footer; remove `showTransport`**

In `TtsWorkspace`:
- Delete the `showTransport` line (currently line 90): `const showTransport = Boolean(props.currentClip && props.generatedAudioSrc);`
- Replace the conditional footer (currently lines 165-171):

```tsx
          {showTransport && (
            <GeneratedAudioPlayer
              clip={props.currentClip!}
              src={props.generatedAudioSrc!}
              onDownload={props.onDownloadClip}
            />
          )}
```

with:

```tsx
          <GeneratedAudioPlayer
            clip={props.currentClip}
            src={props.generatedAudioSrc}
            onDownload={props.onDownloadClip}
          />
```

The footer now self-gates (returns null when nothing to show).

- [ ] **Step 4: Verify typecheck + build**

Run: `pnpm exec tsc --noEmit` — exit 0. (If `AudioPlayerProvider` becomes unused after the footer change, remove it from the import.)
Run: `pnpm build` — exit 0.

- [ ] **Step 5: Manual sanity**

Run `pnpm dev`: generate a clip — footer appears with name + download, plays as before. Clear the clip — footer disappears.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/tts-workspace.tsx
git commit -m "feat(frontend): shared audio player context and generalized preview footer"
```

---

### Task 4: Play buttons in the Voice Browser

**Files:**
- Modify: `src/components/voice-browser.tsx`

**Interfaces:**
- Consumes: `useAudioPlayer` from `@/components/ui/audio-player`; `getVoicePreviewUrl` from `@/lib/preview` (Task 2); `VoiceRecord`/`STOCK_VOICES`; existing props.
- Produces: play/pause buttons on stock + custom rows that play a preview via the shared player and reflect state. No other task consumes this.

- [ ] **Step 1: Add imports**

In `src/components/voice-browser.tsx`, add to the lucide import `Play` and `Pause`:

```tsx
import { ArrowLeft, Check, Mic, Pause, Pencil, Play, Search, Trash2 } from "lucide-react";
```

Add after the `Input` import:

```tsx
import { useAudioPlayer } from "@/components/ui/audio-player";
import { getVoicePreviewUrl } from "@/lib/preview";
```

- [ ] **Step 2: Add the preview hook + helper in `VoiceBrowser`**

At the top of the `VoiceBrowser` function body, after the state declarations, add:

```tsx
  const player = useAudioPlayer();
```

Add a helper before the `return`:

```tsx
  async function togglePreview(spec: string, name: string) {
    const id = `preview-${spec}`;
    if (player.isItemActive(id) && player.isPlaying) {
      player.pause();
      return;
    }
    const url = await getVoicePreviewUrl(spec);
    if (url) void player.play({ id, src: url, data: { kind: "preview", name } });
  }
```

- [ ] **Step 3: Add the play button to stock rows**

In the Pre-built tab, the stock row is currently a `<button onClick={() => onLoadVoice(voice.id)} ...>` (around line 95). Restructure it so the play button is a sibling inside a flex wrapper, and the main button keeps selection. Replace the stock rows block (currently the `voices.map(...)` inside the Pre-built tab) with:

```tsx
              <div className="flex flex-col gap-2">
                {voices.map((voice) => {
                  const active = voiceId != null && selectedCustomVoiceId == null && stockVoice === voice.id;
                  const previewId = `preview-${voice.id}`;
                  const previewPlaying = player.isItemActive(previewId) && player.isPlaying;
                  return (
                    <div
                      key={voice.id}
                      className={`hover:border-primary/60 hover:bg-accent flex items-center gap-3 rounded-xl border p-3 transition-colors ${active ? "border-primary/60 bg-accent" : "border-border"}`}
                    >
                      <button
                        onClick={() => onLoadVoice(voice.id)}
                        disabled={loading}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <VoiceOrb active={active} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{voice.name}</span>
                          <span className="text-muted-foreground mt-0.5 block truncate text-xs">{voice.description}</span>
                        </span>
                      </button>
                      {active && <Check className="text-primary shrink-0" />}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void togglePreview(voice.id, voice.name);
                        }}
                        disabled={loading}
                        className="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-2"
                        aria-label={previewPlaying ? `Pause ${voice.name} preview` : `Play ${voice.name} preview`}
                      >
                        {previewPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>
```

- [ ] **Step 4: Add the play button to custom rows**

In the My voices tab, the custom row currently is a `<button onClick={() => onSelectCustomVoice(voice.id)} ...>` inside a flex row with rename/delete buttons (around line 128). Add a preview button between the checkmark and the rename button. Replace the custom-row select button block (the section from `<button onClick={() => onSelectCustomVoice(voice.id)} ...>` through the `</button>` before the rename button) with a wrapper plus preview button:

```tsx
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <button
                          onClick={() => onSelectCustomVoice(voice.id)}
                          disabled={loading}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <VoiceOrb active={active} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{voice.name}</span>
                            <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                              {voice.source === "recording" ? "Recording" : "File"} · {(voice.durationSec ?? 0).toFixed(1)}s
                            </span>
                          </span>
                        </button>
                        {active && <Check className="text-primary shrink-0" />}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void togglePreview(voice.embeddingsPath, voice.name);
                          }}
                          disabled={loading}
                          className="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-2"
                          aria-label={
                            player.isItemActive(`preview-${voice.embeddingsPath}`) && player.isPlaying
                              ? `Pause ${voice.name} preview`
                              : `Play ${voice.name} preview`
                          }
                        >
                          {player.isItemActive(`preview-${voice.embeddingsPath}`) && player.isPlaying ? (
                            <Pause className="size-4" />
                          ) : (
                            <Play className="size-4" />
                          )}
                        </button>
                      </div>
```

- [ ] **Step 5: Verify typecheck + build**

Run: `pnpm exec tsc --noEmit` — exit 0.
Run: `pnpm build` — exit 0.

- [ ] **Step 6: Manual sanity**

Run `pnpm dev`: open Settings → Voice → click a stock voice's play button. The bottom footer appears with the voice name and "Voice preview", and plays. Click again to pause. Repeat for a custom voice (after cloning one). Replay is instant (cached).

- [ ] **Step 7: Commit**

```bash
git add src/components/voice-browser.tsx
git commit -m "feat(frontend): play voice previews from voice browser rows"
```

---

### Task 5: Preview button in the clone wizard success screen

**Files:**
- Modify: `src/components/voice-clone-wizard.tsx`

**Interfaces:**
- Consumes: `useAudioPlayer` from `@/components/ui/audio-player`; `getVoicePreviewUrl` from `@/lib/preview` (Task 2); `cloned` state (`VoiceRecord | null`).
- Produces: a preview play button on the wizard success screen that plays the cloned voice. Nothing consumes this afterward.

- [ ] **Step 1: Add imports**

In `src/components/voice-clone-wizard.tsx`, add `Pause` to the lucide import (line 2, currently `Check, LoaderCircle, Mic, MicOff, Play, Upload`):

```tsx
import { Check, LoaderCircle, Mic, MicOff, Pause, Play, Upload } from "lucide-react";
```

Add after the `cloneVoice` import (line 15):

```tsx
import { useAudioPlayer } from "@/components/ui/audio-player";
import { getVoicePreviewUrl } from "@/lib/preview";
```

- [ ] **Step 2: Add the hook + helper**

At the top of the `VoiceCloneWizard` function body, after the existing refs (line 44), add:

```tsx
  const player = useAudioPlayer();
```

Add a helper after `startClone` (after line 188):

```tsx
  async function togglePreview() {
    if (!cloned) return;
    const id = `preview-${cloned.embeddingsPath}`;
    if (player.isItemActive(id) && player.isPlaying) {
      player.pause();
      return;
    }
    const url = await getVoicePreviewUrl(cloned.embeddingsPath);
    if (url) void player.play({ id, src: url, data: { kind: "preview", name: cloned.name } });
  }
```

- [ ] **Step 3: Add the preview button to the success screen**

The success screen is the `cloned ? (...)` block (currently lines 204-215). Replace it with:

```tsx
        {cloned ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
              <Check className="size-6" />
            </span>
            <div>
              <p className="font-medium">{cloned.name}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Voice saved · {(cloned.durationSec ?? 0).toFixed(1)}s source audio
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void togglePreview()}>
              {player.isItemActive(`preview-${cloned.embeddingsPath}`) && player.isPlaying ? (
                <Pause className="size-4" /> 
              ) : (
                <Play className="size-4" /> 
              )}
              {player.isItemActive(`preview-${cloned.embeddingsPath}`) && player.isPlaying
                ? "Pause preview"
                : "Preview voice"}
            </Button>
          </div>
        ) : step === 0 ? (
```

- [ ] **Step 4: Verify typecheck + build**

Run: `pnpm exec tsc --noEmit` — exit 0.
Run: `pnpm build` — exit 0.

- [ ] **Step 5: Manual sanity**

Run `pnpm dev`: clone a voice; on the success screen click "Preview voice" — the bottom footer appears with the voice name + "Voice preview" and plays. Pause via the button or the footer.

- [ ] **Step 6: Commit**

```bash
git add src/components/voice-clone-wizard.tsx
git commit -m "feat(frontend): preview cloned voice before use"
```

---

## Self-Review Notes

**Spec coverage:**
- Backend `generate_tts_preview` (no history/events/cancel) → Task 1.
- `api.ts` + `lib/preview.ts` lazy cache → Task 2.
- Provider lifted to wrap App (covers both `TtsWorkspace` and `VoiceCloneWizard`) + generalized footer → Task 3.
- Voice browser play buttons (stock + custom) → Task 4.
- Clone wizard preview on success screen → Task 5.
- Out of scope (persistence, launch pre-generation, history behavior change) intentionally omitted.

**Type consistency:** `getVoicePreviewUrl(spec): Promise<string | null>` used identically in Tasks 4/5. Preview item shape is always `{ id: "preview-" + spec, src, data: { kind: "preview", name } }`; footer checks `activeItem.data?.kind === "preview"` (Task 3). `AudioPlayerItem` imported in tts-workspace for the footer's `item` typing. `generateTtsPreview(voiceSpec, text)` matches the Rust `voice_spec`/`text` params (serde `rename_all = "camelCase"` applies to the TtsLoadResult struct, but command args are passed by the frontend as `{ voiceSpec, text }` matching the Rust parameter names `voice_spec`/`text` via Tauri's default arg mapping — `voiceSpec` maps to `voice_spec`, `text` to `text`).

**Placeholder scan:** every step has complete code or exact commands; no TBD/TODO.
