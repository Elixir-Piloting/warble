# Warble: Voice Cloning Wizard + Persistent Storage

Date: 2026-08-11
Status: Approved design (user: "yes" to Sections 1–4)

## Goal

Add a guided voice-cloning flow and durable storage to the local-TTS app:

1. **Voice clone wizard** — a multi-step screen to clone a voice from a source
   audio file OR a live mic recording, with an on-the-fly conversion of
   non-WAV formats to WAV.
2. **Saved custom voices** — cloned voices persist to disk and are reusable
   anytime from the voice library (select / rename / delete).
3. **Persisted history** — every generation is saved (text + audio + metadata),
   searchable, replayable, and loadable back into the composer for editing.

## Current State

- Tauri v2 app; frontend React 19 + TS + Vite + Tailwind v4 + shadcn/ui;
  backend commands in `src-tauri/src/tts.rs`, registered in `lib.rs`.
- Engine: vendored `pocket-tts` crate (`src-tauri/crates/pocket-tts`) using
  Candle. Voice states (`ModelState`) are produced by
  `TTSModel::get_voice_state*` and kept **in memory only** (`TtsState.voices`).
- `get_tts_voice_state(voiceSpec)` accepts a stock name, `hf://` URL, or a
  local `.wav` / `.safetensors` path, and returns a volatile voice id.
- `VoicePickerDialog` exposes a free-text "custom voice source" input (the
  pain point: a path can be cloned but never saved/reused).
- Generation history is purely in-memory React state (`App.tsx`), capped at 20
  entries; audio exists only as in-memory `AudioBuffer`s.
- Existing helpers: `pcm.ts` (`i16BytesToFloat32`, `audioBuffersToWavBlob`),
  `StreamPlayer` for live chunk playback, `<audio>`-based `AudioPlayer` for
  finished clips.

## Design Decisions (from brainstorming)

- Persist **pre-computed embeddings (.safetensors) + source WAV** per voice so
  reload is instant. (Chosen over re-encoding the WAV on every load.)
- **Decode in browser** — non-WAV clone sources are converted to WAV via Web
  Audio (`decodeAudioData`) + existing WAV encoder; Rust only ever receives
  WAV bytes.
- History persistence is **full**: save text + audio + metadata; users can
  replay and one-click load text back into the composer.
- DB via **rusqlite (bundled)** in Rust; all CRUD behind Tauri commands, no
  SQL in the webview.
- Custom voices support **rename + delete**; recordings are stored per voice
  as the source audio (no separate recordings library).

## Architecture

### Backend (Rust) — new `src-tauri/src/store.rs`

- Owns the SQLite connection (`rusqlite` dep with `bundled` feature) and the
  app-data file layout. Single `Mutex<Connection>` managed by Tauri.
- Storage root = `app_data_dir()` (e.g. `%APPDATA%\com.dog.warble` on
  Windows):

  ```
  warble.db
  voices/<id>/source.wav             ← original clone audio (file or recording)
  voices/<id>/embeddings.safetensors ← pre-computed "audio_prompt" latent
  history/<id>.wav                   ← a persisted generation
  ```

- **Migrations**: `CREATE TABLE IF NOT EXISTS` on first launch in `init()`.

### Schema

```sql
CREATE TABLE IF NOT EXISTS custom_voices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,          -- unix ms
  wav_path         TEXT    NOT NULL,
  embeddings_path  TEXT    NOT NULL,
  duration_sec     REAL,
  sample_rate      INTEGER,
  source           TEXT    NOT NULL           -- 'file' | 'recording'
);

CREATE TABLE IF NOT EXISTS history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  text         TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  char_count   INTEGER,
  chunk_count  INTEGER,
  speech_sec   REAL,
  elapsed_sec  REAL,
  sample_rate  INTEGER,
  channels     INTEGER,
  wav_path     TEXT    NOT NULL,
  voice_label  TEXT
);
```

### Engine integration (small addition to vendored `pocket-tts`)

Add a public method on `TTSModel` that returns the raw speaker-conditioning
tensor from audio bytes — a refactor of the existing encode path inside
`get_voice_state_from_bytes` (mimi encode → speaker_proj → conditioning tensor,
**before** `run_flow_lm_prompt`). Example:

```rust
pub fn encode_voice_prompt_from_bytes(&self, bytes: &[u8]) -> Result<Tensor>
```

- Cloning stores this tensor as an `.safetensors` file with the `audio_prompt`
  key (candle safetensors save), matching the format stock voices from
  `kyutai/pocket-tts-without-voice-cloning` already use.
- Reloading a saved voice reuses the existing
  `get_voice_state_from_prompt_file` path → instant load.

## Tauri Commands

`clone_voice(name, wav_bytes, source)` → encode must run on a clone of the
loaded model in `spawn_blocking`. Write to a temp dir and atomically move into
`voices/<id>/` only after the encode succeeds. Insert row; return record.

`list_custom_voices()` → `Vec<CustomVoice>`
`get_custom_voice(id)` → single record (frontend feeds `embeddings_path` into
`get_tts_voice_state`)
`rename_custom_voice(id, name)` → update row only (paths unchanged)
`delete_custom_voice(id)` → remove files + row; missing file tolerated

`list_history()` → `Vec<HistoryRecord>` (metadata only, no bytes)
`get_history(id)` → record incl. `text`, `wav_path`, `voice_label`
`get_history_audio(id)` → `Vec<u8>` WAV bytes for replay
`delete_history(id)` → remove file + row

Modified `generate_tts_stream(text, voice_id, name, voice_label)`:
- Rust accumulates streamed PCM chunks (already emitted as `tts://chunk`) and,
  in the `done` branch, writes `history/<id>.wav` + inserts the row. Frontend
  live playback unchanged; the DB row is the durable copy. Frontend refreshes
  via `list_history()` after `tts://done`.

Registered in `lib.rs`. The store is managed separately: `app.manage(Mut<Store>)`
where `Store` wraps the connection + data-dir path.

## Frontend

### Voice clone wizard — `src/components/voice-clone-wizard.tsx`

Dialog overlay, launched from the voice library and a "Clone a voice"
shortcut. Three steps:

- **Step 1 · Source** — tabs *Upload file* / *Record*.
  - Upload: native picker (`open()`, filters wav/mp3/m4a/mp4/ogg). Preview +
    play. Non-WAV decoded via `decodeAudioData` → converted with `pcm.ts`,
    so Rust receives WAV.
  - Record: `getUserMedia` + `MediaRecorder`, live rec UI (start/stop),
    captured audio re-encoded to WAV the same way. Permission denied → inline
    error, wizard stays open.
- **Step 2 · Name** — text input (non-empty; duplicate names allowed but
  warned), preview of the chosen source.
- **Step 3 · Cloning** — `clone_voice` with progress state; success card with
  "Use this voice" (loads via `get_tts_voice_state(embeddings_path)`) and
  closes. Failures → inline error, no partial state.

### Voice library — `voice-picker-dialog.tsx`

Add a **Custom voices** section (from `list_custom_voices`) with select /
rename / delete. Selecting loads via embeddings path. The free-text "custom
voice source" input is **replaced** by the wizard + saved-voice list.

### History — `App.tsx` + `tts-workspace.tsx`

- Load from `list_history()` on mount (persisted, no 20-item cap).
- Entry actions: replay (`get_history_audio` → decode → existing player),
  download (existing), **Edit** (loads row `text` into composer), delete.
- DB is the single source of truth.

## Error Handling & Edge Cases

- Commands return `Result<_, String>`; surfaced through the existing
  status/error UI path.
- Clone failures: temp-dir write → atomic move means no half-written rows.
- Delete/rename tolerate missing files; unknown id → error string.
- Recording permission denied → inline error in Step 1.
- Model not loaded when cloning → "load the model first" (boot auto-loads).
- History audio file missing → row kept; replay shows friendly error + offers
  delete.
- Wizard dismissed during clone → clone completes in background; voice saved.
- DB contention → single `Mutex<Connection>`, short-lived accesses.

## Testing

- `pnpm tauri dev`: clone from wav / mp3 / mic recording; custom voice
  persists across restart; history persists; Edit-text → regenerate works.
- `cargo test` in `pocket-tts`: round-trip encode → save `audio_prompt` →
  reload matches live clone.
- `pnpm build` (tsc + vite) and `cargo check` must pass.

## Out of Scope

- No recordings library/tab (recordings live per-voice as source audio).
- No mobile/multi-platform audio hardening (browser decode targets Windows
  webview codecs; Rust decode fallback is future work).
- No cloud/sync, no multi-user.