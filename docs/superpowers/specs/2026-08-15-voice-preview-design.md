# Voice Preview Audio — Design

Date: 2026-08-15
Status: Approved (design)

## Summary

Add lazy-generated preview audio for every voice. Each stock voice and each
cloned (custom) voice gets a short spoken sample that plays through the
existing bottom audio player, so users can hear a voice before choosing it.
The clone wizard's success screen also previews the newly cloned voice before
the user commits to it.

## Background

- Generation lives in `src-tauri/src/tts.rs`. `generate_tts_stream` streams
  PCM chunks via `tts://chunk` events and **always persists a history row**.
  `resolve_voice_state(model, spec)` resolves stock names (`alba`, ...) and
  local `embeddingsPath` / HF URLs into a `ModelState`. `get_tts_voice_state`
  encodes a spec into a cached `ModelState` and returns a handle.
- `store.rs` has `write_wav_file(path, pcm, sample_rate, channels)` which
  writes a 16-bit PCM WAV from little-endian i16 bytes.
- The bottom player (`GeneratedAudioPlayer` in `tts-workspace.tsx`) wraps its
  own `AudioPlayerProvider` and plays a single `item = { id, src }` where `src`
  is a blob URL. It only mounts when a history clip is loaded
  (`showTransport`).
- `AudioPlayerProvider`/`useAudioPlayer` (`src/components/ui/audio-player.tsx`)
  provide `play(item)`, `pause()`, `isPlaying`, `isItemActive(id)`, time/
  duration/scrub/rate. Any component under the provider can drive playback.
- `VoiceRecord` (`src/lib/api.ts`) carries `embeddingsPath` — the spec string
  that resolves a custom voice. Stock voices use their id (e.g. `alba`).
- `VoiceBrowser` (`src/components/voice-browser.tsx`) lists stock + custom
  voices with select/rename/delete. `VoiceCloneWizard` (`voice-clone-wizard.tsx`)
  shows a success screen (`cloned` state) after cloning.

## Design

### 1. Backend: `generate_tts_preview` command

New Tauri command in `src-tauri/src/tts.rs`:

```rust
#[tauri::command]
pub async fn generate_tts_preview(
    state: State<'_, TtsState>,
    voice_spec: String,
    text: String,
) -> Result<tauri::ipc::Response, String>
```

- Loads the model (error if not loaded, same message as `generate_tts_stream`).
- Calls `resolve_voice_state(&model, &voice_spec)` in `spawn_blocking` (same
  pattern as `get_tts_voice_state`) — NOT registered in `state.voices` (no
  handle needed; generation is self-contained).
- Runs `model.generate_stream(&text, &voice_state)`, concatenating the
  i16 PCM bytes of every chunk (same accumulation as `generate_tts_stream`).
- Returns the WAV as bytes via `tauri::ipc::Response::new(wav_bytes)`. Reuse a
  new helper `store::wav_bytes(pcm, sample_rate, channels) -> Result<Vec<u8>, String>`
  extracted from `write_wav_file` (write to a `Vec<u8>` instead of a file;
  `write_wav_file` delegates to it).
- Does NOT persist history, does NOT emit `tts://` events, does NOT touch the
  cancel flag.
- Register in `src-tauri/src/lib.rs` next to the other `tts::*` commands.

### 2. Frontend plumbing

- `src/lib/api.ts`: add
  ```ts
  export function generateTtsPreview(voiceSpec: string, text: string): Promise<ArrayBuffer> {
    return invoke("generate_tts_preview", { voiceSpec, text });
  }
  ```
- New `src/lib/preview.ts`:
  ```ts
  export const PREVIEW_TEXT =
    "Hello! This is a preview of my voice. I hope you enjoy creating with me.";
  const cache = new Map<string, string>();
  export async function getVoicePreviewUrl(spec: string): Promise<string | null> {
    const hit = cache.get(spec);
    if (hit) return hit;
    try {
      const bytes = await generateTtsPreview(spec, PREVIEW_TEXT);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
      cache.set(spec, url);
      return url;
    } catch {
      return null;
    }
  }
  ```
  Lazy on first play; cached blob URL afterward. Null on failure (callers show
  nothing/disabled). `spec` = stock voice id OR custom `embeddingsPath`.
  An optional per-spec in-flight guard prevents double generation.

### 3. Lift `AudioPlayerProvider` to the app shell

`VoiceCloneWizard` is rendered as a sibling of `TtsWorkspace` inside `App.tsx`
(both under a `<>` fragment), so the provider must wrap BOTH. Lift the single
`AudioPlayerProvider` from inside `GeneratedAudioPlayer` to wrap the whole
app in `App.tsx`:

```tsx
return (
  <AudioPlayerProvider>
    <TtsWorkspace ... />
    <VoiceCloneWizard ... />
  </AudioPlayerProvider>
);
```

This puts `TtsWorkspace` (shell + footer + voice browser) and the wizard under
one shared player context.

`GeneratedAudioPlayer` becomes a plain `<footer>` (no provider) that reads
`useAudioPlayer()`.

### 4. Generalized bottom footer

`GeneratedAudioPlayer` is renamed conceptually to a generic transport footer
(it keeps its filename/location) and:

- Still accepts `clip`/`src`/`onDownload` for the history-clip case.
- Adds an optional `preview` prop: `{ id: string; name: string } | null`.
- Renders whenever `showTransport || preview`:
  - Title/subtitle: history clip → `clip.name` + `Local voice · N seconds`;
    preview → `preview.name` + `Voice preview`.
  - Controls unchanged (`AudioPlayerButton`, `AudioPlayerTime`,
    `AudioPlayerProgress`, `AudioPlayerDuration`, `AudioPlayerSpeed`).
  - Download button only for the history-clip case.
- The active item id passed to `AudioPlayerButton` is the preview id when
  previewing (`preview.id`), else `clip.id`.

`showTransport` in `TtsWorkspace` becomes `showTransport = Boolean(currentClip && generatedAudioSrc) || Boolean(preview)`.

### 5. Voice browser play buttons

In `VoiceBrowser`, each stock row and each custom row gets a small play/pause
button (right side, before any checkmark/actions):

- Uses `useAudioPlayer()` (works because the provider now wraps the shell).
- On click: `const url = await getVoicePreviewUrl(spec); if (url) player.play({ id: "preview-" + spec, src: url, data: { name } })`.
- Reflects state: if `player.isItemActive("preview-" + spec) && player.isPlaying`
  show `PauseIcon` and `player.pause()` on click; else show `PlayIcon` and play.
- Guarded against the click also triggering the row's select handler
  (`e.stopPropagation()`).
- Disabled while `loading` or while that preview is being generated (local
  per-spec pending state or the shared in-flight guard).
- `spec` per row: stock → `voice.id`; custom → `voice.embeddingsPath`.

Props added to `VoiceBrowser`: none beyond existing — it imports
`useAudioPlayer` and `getVoicePreviewUrl` directly.

### 6. Clone wizard preview

In `VoiceCloneWizard`, on the success screen (`cloned` state), add a play
button next to the "Use this voice" actions:

- Uses `useAudioPlayer()` + `getVoicePreviewUrl(cloned.embeddingsPath)`.
- Same play/pause pattern as the voice browser rows.
- The wizard's `DialogContent` is under the lifted `AudioPlayerProvider`
  (the provider wraps both `TtsWorkspace` and `VoiceCloneWizard` in `App.tsx`).

## Files Touched

- Modify: `src-tauri/src/tts.rs` — add `generate_tts_preview`.
- Modify: `src-tauri/src/store.rs` — extract `wav_bytes` helper; `write_wav_file` delegates.
- Modify: `src-tauri/src/lib.rs` — register `generate_tts_preview`.
- Modify: `src/lib/api.ts` — add `generateTtsPreview`.
- Create: `src/lib/preview.ts` — `PREVIEW_TEXT`, `getVoicePreviewUrl`.
- Modify: `src/App.tsx` — wrap the app in `AudioPlayerProvider`.
- Modify: `src/components/tts-workspace.tsx` — generalize footer; `showTransport` includes preview.
- Modify: `src/components/voice-browser.tsx` — play buttons on stock + custom rows.
- Modify: `src/components/voice-clone-wizard.tsx` — preview button on success screen.

## Out of Scope

- Persisting previews to disk or in the DB.
- Pre-generating previews at launch (chosen: lazy on first play, cached).
- Changing the history-clip playback behavior.
- Previews in any surface other than the voice browser + clone wizard.

## Testing / Verification

- `cargo test` in `src-tauri` passes (store WAV roundtrip test covers the
  refactor; add a `wav_bytes` roundtrip test).
- `pnpm exec tsc --noEmit` and `pnpm build` pass.
- Manual: in VoiceBrowser, play a stock voice → bottom player appears and
  plays; pause from row; replay is instant (cache). Same for a custom voice.
  In the clone wizard, after cloning, the preview button plays the new voice.
  The history-clip footer still works (download button only for clips).
