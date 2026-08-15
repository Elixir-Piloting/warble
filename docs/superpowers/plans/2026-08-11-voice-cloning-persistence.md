# Voice Cloning Wizard + Persistent Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guided voice-clone wizard, persisted custom voices (embeddings + source WAV), and an SQLite-backed generation history with replay/edit to the warble TTS app.

**Architecture:** Rust owns all data. A new `src-tauri/src/store.rs` module wraps a rusqlite connection + app-data file layout behind Tauri commands. Cloning runs the existing `pocket-tts` encoder on a blocking thread and stores the pre-computed `audio_prompt` latent as `.safetensors` plus the source `.wav`. `generate_tts_stream` accumulates the PCM it already emits and writes a WAV + history row at completion. The frontend gets a 3-step wizard dialog, a custom-voices section in the voice library, and a persisted, editable history panel.

**Tech Stack:** Tauri v2, rusqlite (bundled), pocket-tts (vendored, Candle), React 19 + TS + Vite + Tailwind v4 + shadcn/ui.

## Global Constraints

- Everything already true: engine voice states live in `TtsState.voices` (in-memory); commands return `Result<_, String>`; UI errors surface through `setStatus(String(error))`.
- Storage root is `app_data_dir()`; layout:
  ```
  warble.db
  voices/<id>/source.wav             ← original clone audio
  voices/<id>/embeddings.safetensors ← "audio_prompt" latent
  history/<id>.wav                   ← persisted generation audio
  ```
- Frontend passes `Uint8Array` for `wav_bytes`; Tauri v2 maps it to `Vec<u8>` (binary IPC).
- `get_history_audio` returns `tauri::ipc::Response` (binary) so audio never crosses IPC as JSON.
- Command names are globally unique (Tauri requirement). Frontend args use camelCase.
- Existing commands, events (`tts://chunk|done|error`), `StreamPlayer`, `AudioPlayer`, and `pcm.ts` helpers are preserved and reused, not rewritten.

---

### Task 1: Extract reusable voice-prompt encoder in pocket-tts

**Files:**
- Modify: `src-tauri/crates/pocket-tts/src/tts_model.rs:504-560`
- Test: `src-tauri/crates/pocket-tts/tests/integration_tests.rs`

**Interfaces:**
- Consumes: existing `TTSModel::get_voice_state_from_bytes`, `get_voice_state_from_prompt_file`.
- Produces: `pub fn encode_voice_prompt_from_bytes(&self, bytes: &[u8]) -> anyhow::Result<Tensor>` (returns the `[B, T, dim]` conditioning tensor, NOT the flow state). Later tasks save this as `audio_prompt` and reload via the existing `get_voice_state_from_prompt_file`.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/crates/pocket-tts/tests/integration_tests.rs`. First ensure the imports exist at the top of the file (add if missing):

```rust
use std::collections::HashMap;
use pocket_tts::voice_state::ModelState;
```

Append these tests at the end of the file:

```rust
#[test]
fn test_voice_prompt_roundtrip() {
    if !require_hf_token("test_voice_prompt_roundtrip") {
        return;
    }
    let model = get_model();
    let bytes = std::fs::read(get_ref_wav_path()).expect("read ref wav");

    let prompt = model
        .encode_voice_prompt_from_bytes(&bytes)
        .expect("encode voice prompt");
    assert_eq!(prompt.dims().len(), 3, "expected [B, T, dim] prompt");
    assert_eq!(prompt.dims()[0], 1);

    let safetensors_path = std::env::temp_dir().join("warble-roundtrip-prompt.safetensors");
    let mut tensors = HashMap::new();
    tensors.insert("audio_prompt".to_string(), prompt);
    candle_core::safetensors::save(&tensors, &safetensors_path).expect("save safetensors");

    let state_from_file = model
        .get_voice_state_from_prompt_file(&safetensors_path)
        .expect("load voice state from file");
    let state_from_wav = model
        .get_voice_state_from_bytes(&bytes)
        .expect("load voice state from wav");
    assert_state_equal(&state_from_file, &state_from_wav);

    let _ = std::fs::remove_file(&safetensors_path);
}

fn assert_state_equal(a: &ModelState, b: &ModelState) {
    assert_eq!(a.len(), b.len(), "state key count differs");
    for (module_key, module_a) in a {
        let module_b = b
            .get(module_key)
            .unwrap_or_else(|| panic!("module key missing: {module_key}"));
        assert_eq!(module_a.len(), module_b.len(), "module {module_key} key count differs");
        for (name, ta) in module_a {
            let tb = module_b
                .get(name)
                .unwrap_or_else(|| panic!("tensor key missing: {module_key}.{name}"));
            assert_eq!(ta.dims(), tb.dims(), "dims differ for {module_key}.{name}");
            let fa = ta
                .flatten_all()
                .and_then(|t| t.to_dtype(candle_core::DType::F32))
                .and_then(|t| t.to_vec1::<f32>())
                .unwrap_or_else(|e| panic!("flatten {module_key}.{name}: {e}"));
            let fb = tb
                .flatten_all()
                .and_then(|t| t.to_dtype(candle_core::DType::F32))
                .and_then(|t| t.to_vec1::<f32>())
                .unwrap_or_else(|e| panic!("flatten {module_key}.{name}: {e}"));
            assert_eq!(fa.len(), fb.len());
            for (i, (x, y)) in fa.iter().zip(fb.iter()).enumerate() {
                assert!(
                    (x - y).abs() < 1e-3,
                    "value mismatch at {module_key}.{name}[{i}]: {x} vs {y}"
                );
            }
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p pocket-tts --test integration_tests test_voice_prompt_roundtrip -- --nocapture`
Expected: FAIL with `error[E0599]: no method named `encode_voice_prompt_from_bytes` found for struct `TTSModel``.

- [ ] **Step 3: Refactor the encode path and add the new method**

In `src-tauri/crates/pocket-tts/src/tts_model.rs`, replace the entire body of `get_voice_state_from_tensor` (currently lines ~504-560) so it delegates to a new encoder. The method should become:

```rust
    /// Create voice state from audio tensor
    pub fn get_voice_state_from_tensor(&self, audio: &Tensor) -> Result<ModelState> {
        let conditioning = self.encode_voice_prompt_from_tensor(audio)?;
        let mut flow_state = init_states(1, 1000);
        self.run_flow_lm_prompt(&conditioning, &mut flow_state)?;
        Ok(flow_state)
    }

    /// Encode raw WAV bytes into a speaker-conditioning prompt tensor.
    ///
    /// This is the pre-computed `audio_prompt` latent stored in
    /// `.safetensors` voice files. Produces `[B, T, dim]`.
    pub fn encode_voice_prompt_from_bytes(&self, bytes: &[u8]) -> Result<Tensor> {
        let (audio, sample_rate) = crate::audio::read_wav_from_bytes(bytes)?;
        let audio = if sample_rate != self.sample_rate as u32 {
            crate::audio::resample(&audio, sample_rate, self.sample_rate as u32)?
        } else {
            audio
        };
        let audio = audio.unsqueeze(0)?;
        self.encode_voice_prompt_from_tensor(&audio)
    }

    /// Encode a `[B, C, T]` audio tensor into a `[B, T, dim]` conditioning
    /// prompt (mimi encode → speaker projection), without running the flow LM.
    pub fn encode_voice_prompt_from_tensor(&self, audio: &Tensor) -> Result<Tensor> {
        let mut model_state = init_states(1, 1000);

        // Ensure audio tensor is on the same device as the model (fixes Metal device mismatch)
        let audio = if audio.device().same_device(&self.device) {
            audio.clone()
        } else {
            audio.to_device(&self.device)?
        };

        // Pad audio to a multiple of frame size for streaming conv stride alignment
        let frame_size = self.mimi.frame_size();
        let (b, c, t) = audio.dims3()?;
        let pad_len = if t % frame_size != 0 {
            frame_size - (t % frame_size)
        } else {
            0
        };
        let audio = if pad_len > 0 {
            let pad = Tensor::zeros((b, c, pad_len), audio.dtype(), &self.device)?;
            Tensor::cat(&[&audio, &pad], 2)?
        } else {
            audio
        };

        // Encode audio through Mimi in chunks to avoid OOM in SEANet Conv1d layers.
        let mut encoded_chunks = Vec::new();
        let (_b, _c, total_samples) = audio.dims3()?;
        let chunk_frames = self.adaptive_voice_prompt_chunk_frames(total_samples, frame_size);
        let chunk_size = frame_size * chunk_frames;

        for start in (0..total_samples).step_by(chunk_size) {
            let end = std::cmp::min(start + chunk_size, total_samples);
            let chunk = audio.narrow(2, start, end - start)?;
            let code = self.mimi.encode_to_latent(&chunk, &mut model_state, 0)?;
            encoded_chunks.push(code);
        }
        let encoded = Tensor::cat(&encoded_chunks, 2)?;

        // Transpose from [B, D, T] to [B, T, D]
        let latents = encoded.transpose(1, 2)?.to_dtype(DType::F32)?;

        // Project to flow model space: [B, T, ldim] @ [dim, ldim].T -> [B, T, dim]
        let (b, t, d) = latents.dims3()?;
        let latents_2d = latents.reshape((b * t, d))?;
        let conditioning_2d = latents_2d.matmul(&self.speaker_proj_weight.t()?)?;
        let conditioning = conditioning_2d.reshape((b, t, self.dim))?;

        Ok(conditioning)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p pocket-tts --test integration_tests test_voice_prompt_roundtrip -- --nocapture`
Expected: PASS (test prints nothing extra and does not assert; skips if `HF_TOKEN` unset).

Also run the existing encode-path tests to confirm no behavior change:
Run: `cargo test -p pocket-tts --test integration_tests -- --nocapture`
Expected: PASS (existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/crates/pocket-tts/src/tts_model.rs src-tauri/crates/pocket-tts/tests/integration_tests.rs
git commit -m "feat(tts): expose encode_voice_prompt_from_bytes for saved embeddings"
```

---

### Task 2: Store module (SQLite + app-data layout) with unit tests

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `pub struct Store { dir: PathBuf, conn: Arc<Mutex<Connection>> }` with `Store::init(dir) -> Result<Self, String>`.
  - `pub fn now_ms() -> i64`
  - `pub fn write_wav_file(path: &Path, pcm: &[u8], sample_rate: u32, channels: u16) -> Result<(), String>`
  - Voice CRUD: `insert_voice`, `set_voice_files`, `list_voices`, `get_voice`, `rename_voice`, `delete_voice`.
  - History CRUD: `insert_history`, `set_history_wav_path`, `list_history`, `get_history`, `delete_history`.
  - Serde types `VoiceRecord`, `HistoryRecord` (camelCase), input struct `NewHistory`.
  - Used later by `clone_voice` (Task 3) and `generate_tts_stream` (Task 4).

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
rusqlite = { version = "0.37", features = ["bundled"] }
```

- [ ] **Step 2: Write the failing store tests**

Create `src-tauri/src/store.rs` with the struct/schema/CRUD from Step 4 **plus** this `#[cfg(test)]` module at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> Store {
        let dir = std::env::temp_dir().join(format!("warble-store-test-{}", std::process::id()));
        Store::init(dir).expect("init store")
    }

    #[test]
    fn test_empty_schema() {
        let store = temp_store();
        assert!(store.list_voices().unwrap().is_empty());
        assert!(store.list_history().unwrap().is_empty());
    }

    #[test]
    fn test_voice_crud() {
        let store = temp_store();
        let id = store.insert_voice("My Voice", "file").unwrap();
        store
            .set_voice_files(id, Path::new("/v/source.wav"), Path::new("/v/e.safetensors"), Some(2.5), Some(24000))
            .unwrap();

        let voices = store.list_voices().unwrap();
        assert_eq!(voices.len(), 1);
        assert_eq!(voices[0].name, "My Voice");
        assert_eq!(voices[0].embeddings_path, "/v/e.safetensors");

        let rec = store.get_voice(id).unwrap().unwrap();
        assert_eq!(rec.source, "file");
        assert_eq!(rec.duration_sec, Some(2.5));

        store.rename_voice(id, "Renamed").unwrap();
        assert_eq!(store.get_voice(id).unwrap().unwrap().name, "Renamed");

        let deleted = store.delete_voice(id).unwrap();
        assert_eq!(deleted.id, id);
        assert!(store.get_voice(id).unwrap().is_none());
    }

    #[test]
    fn test_history_crud() {
        let store = temp_store();
        let id = store
            .insert_history(&NewHistory {
                name: "Hello".to_string(),
                text: "Hello world".to_string(),
                created_at: now_ms(),
                char_count: Some(11),
                chunk_count: Some(4),
                speech_sec: Some(1.0),
                elapsed_sec: Some(1.5),
                sample_rate: Some(24000),
                channels: Some(1),
                voice_label: Some("Alba".to_string()),
            })
            .unwrap();
        store.set_history_wav_path(id, Path::new("/h/1.wav")).unwrap();

        let list = store.list_history().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].text, "Hello world");

        let rec = store.get_history(id).unwrap().unwrap();
        assert_eq!(rec.voice_label.as_deref(), Some("Alba"));

        let deleted = store.delete_history(id).unwrap();
        assert_eq!(deleted.wav_path, "/h/1.wav");
        assert!(store.get_history(id).unwrap().is_none());
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p warble --lib store::tests --manifest-path src-tauri/Cargo.toml`
Expected: FAIL with `error[E0433]: failed to resolve: use of undeclared crate or module `store`` (module not yet declared) or `cannot find module`. (The dependency download of rusqlite bundled compiles SQLite via cc — allow several minutes on first run.)

- [ ] **Step 4: Implement the store**

Write the full contents of `src-tauri/src/store.rs`:

```rust
//! Durable storage for custom voices and generation history.
//!
//! Owns the SQLite connection and the app-data file layout under
//! `app_data_dir()`. All CRUD is exposed through Tauri commands in this
//! module; the webview never touches SQL directly.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde::Serialize;

/// Shared, cloneable store handle used by commands and blocking tasks.
#[derive(Clone)]
pub struct Store {
    dir: PathBuf,
    conn: Arc<Mutex<Connection>>,
}

impl Store {
    /// Open (creating if needed) the SQLite database in `dir` and run
    /// schema migrations.
    pub fn init(dir: PathBuf) -> Result<Self, String> {
        let conn = Connection::open(dir.join("warble.db")).map_err(|e| e.to_string())?;
        let store = Self { dir, conn: Arc::new(Mutex::new(conn)) };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Root data dir (contains `warble.db`, `voices/`, `history/`).
    pub fn data_dir(&self) -> &Path {
        &self.dir
    }

    /// `dir/voices/<id>` — final location for a voice's files.
    pub fn voice_dir(&self, id: i64) -> PathBuf {
        self.dir.join("voices").join(id.to_string())
    }

    /// `dir/history/<id>.wav` — persisted audio for a generation.
    pub fn history_wav_path(&self, id: i64) -> PathBuf {
        self.dir.join("history").join(format!("{id}.wav"))
    }

    // ---- custom voices ----

    /// Insert a placeholder row and return its id. Paths are filled in by
    /// [`Self::set_voice_files`] once files are staged.
    pub fn insert_voice(&self, name: &str, source: &str) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        conn.execute(
            "INSERT INTO custom_voices (name, created_at, wav_path, embeddings_path, source)
             VALUES (?1, ?2, '', '', ?3)",
            rusqlite::params![name, now_ms(), source],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn set_voice_files(
        &self,
        id: i64,
        wav_path: &Path,
        embeddings_path: &Path,
        duration_sec: Option<f64>,
        sample_rate: Option<i64>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        conn.execute(
            "UPDATE custom_voices
             SET wav_path = ?1, embeddings_path = ?2, duration_sec = ?3, sample_rate = ?4
             WHERE id = ?5",
            rusqlite::params![
                wav_path.to_string_lossy(),
                embeddings_path.to_string_lossy(),
                duration_sec,
                sample_rate,
                id
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_voices(&self) -> Result<Vec<VoiceRecord>, String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, created_at, wav_path, embeddings_path, duration_sec, sample_rate, source
                 FROM custom_voices ORDER BY created_at DESC, id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(VoiceRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    wav_path: row.get(3)?,
                    embeddings_path: row.get(4)?,
                    duration_sec: row.get(5)?,
                    sample_rate: row.get(6)?,
                    source: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn get_voice(&self, id: i64) -> Result<Option<VoiceRecord>, String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, created_at, wav_path, embeddings_path, duration_sec, sample_rate, source
                 FROM custom_voices WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([id], |row| {
                Ok(VoiceRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    wav_path: row.get(3)?,
                    embeddings_path: row.get(4)?,
                    duration_sec: row.get(5)?,
                    sample_rate: row.get(6)?,
                    source: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.next().map(|r| r.map_err(|e| e.to_string())).transpose()
    }

    pub fn rename_voice(&self, id: i64, name: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        conn.execute(
            "UPDATE custom_voices SET name = ?1 WHERE id = ?2",
            rusqlite::params![name, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Delete a voice row and return the record (caller removes files).
    pub fn delete_voice(&self, id: i64) -> Result<VoiceRecord, String> {
        let rec = self.get_voice(id)?.ok_or_else(|| format!("unknown voice id: {id}"))?;
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        conn.execute("DELETE FROM custom_voices WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(rec)
    }

    // ---- history ----

    /// Insert a history row and return its id. `wav_path` is filled in by
    /// [`Self::set_history_wav_path`] once the file is written.
    pub fn insert_history(&self, new: &NewHistory) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        conn.execute(
            "INSERT INTO history
               (name, text, created_at, char_count, chunk_count, speech_sec, elapsed_sec,
                sample_rate, channels, wav_path, voice_label)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '', ?10)",
            rusqlite::params![
                new.name,
                new.text,
                new.created_at,
                new.char_count,
                new.chunk_count,
                new.speech_sec,
                new.elapsed_sec,
                new.sample_rate,
                new.channels,
                new.voice_label
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn set_history_wav_path(&self, id: i64, path: &Path) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        conn.execute(
            "UPDATE history SET wav_path = ?1 WHERE id = ?2",
            rusqlite::params![path.to_string_lossy(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_history(&self) -> Result<Vec<HistoryRecord>, String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, text, created_at, char_count, chunk_count, speech_sec,
                        elapsed_sec, sample_rate, channels, wav_path, voice_label
                 FROM history ORDER BY created_at DESC, id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(HistoryRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    text: row.get(2)?,
                    created_at: row.get(3)?,
                    char_count: row.get(4)?,
                    chunk_count: row.get(5)?,
                    speech_sec: row.get(6)?,
                    elapsed_sec: row.get(7)?,
                    sample_rate: row.get(8)?,
                    channels: row.get(9)?,
                    wav_path: row.get(10)?,
                    voice_label: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn get_history(&self, id: i64) -> Result<Option<HistoryRecord>, String> {
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, text, created_at, char_count, chunk_count, speech_sec,
                        elapsed_sec, sample_rate, channels, wav_path, voice_label
                 FROM history WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([id], |row| {
                Ok(HistoryRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    text: row.get(2)?,
                    created_at: row.get(3)?,
                    char_count: row.get(4)?,
                    chunk_count: row.get(5)?,
                    speech_sec: row.get(6)?,
                    elapsed_sec: row.get(7)?,
                    sample_rate: row.get(8)?,
                    channels: row.get(9)?,
                    wav_path: row.get(10)?,
                    voice_label: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.next().map(|r| r.map_err(|e| e.to_string())).transpose()
    }

    /// Delete a history row and return the record (caller removes file).
    pub fn delete_history(&self, id: i64) -> Result<HistoryRecord, String> {
        let rec = self.get_history(id)?.ok_or_else(|| format!("unknown history id: {id}"))?;
        let conn = self.conn.lock().map_err(|_| "store lock poisoned".to_string())?;
        conn.execute("DELETE FROM history WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(rec)
    }
}

/// Current unix epoch in milliseconds.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Write a standard 16-bit PCM WAV file from little-endian interleaved i16
/// sample bytes (`pcm` is exactly what `pocket_tts::audio::pcm_i16_le_bytes`
/// produces).
pub fn write_wav_file(path: &Path, pcm: &[u8], sample_rate: u32, channels: u16) -> Result<(), String> {
    use std::io::Write;
    let data_size = pcm.len() as u32;
    let byte_rate = sample_rate * channels as u32 * 2;
    let block_align = channels as u32 * 2;
    let mut f = std::fs::File::create(path).map_err(|e| e.to_string())?;
    f.write_all(b"RIFF").map_err(|e| e.to_string())?;
    f.write_all(&(36 + data_size).to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(b"WAVE").map_err(|e| e.to_string())?;
    f.write_all(b"fmt ").map_err(|e| e.to_string())?;
    f.write_all(&16u32.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?; // PCM
    f.write_all(&channels.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&sample_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&byte_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&block_align.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&16u16.to_le_bytes()).map_err(|e| e.to_string())?; // bits per sample
    f.write_all(b"data").map_err(|e| e.to_string())?;
    f.write_all(&data_size.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(pcm).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRecord {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub wav_path: String,
    pub embeddings_path: String,
    pub duration_sec: Option<f64>,
    pub sample_rate: Option<i64>,
    pub source: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub id: i64,
    pub name: String,
    pub text: String,
    pub created_at: i64,
    pub char_count: Option<i64>,
    pub chunk_count: Option<i64>,
    pub speech_sec: Option<f64>,
    pub elapsed_sec: Option<f64>,
    pub sample_rate: Option<i64>,
    pub channels: Option<i64>,
    pub wav_path: String,
    pub voice_label: Option<String>,
}

pub struct NewHistory {
    pub name: String,
    pub text: String,
    pub created_at: i64,
    pub char_count: Option<i64>,
    pub chunk_count: Option<i64>,
    pub speech_sec: Option<f64>,
    pub elapsed_sec: Option<f64>,
    pub sample_rate: Option<i64>,
    pub channels: Option<i64>,
    pub voice_label: Option<String>,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS custom_voices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  wav_path         TEXT    NOT NULL,
  embeddings_path  TEXT    NOT NULL,
  duration_sec     REAL,
  sample_rate      INTEGER,
  source           TEXT    NOT NULL
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
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> Store {
        let dir = std::env::temp_dir().join(format!("warble-store-test-{}", std::process::id()));
        Store::init(dir).expect("init store")
    }

    #[test]
    fn test_empty_schema() {
        let store = temp_store();
        assert!(store.list_voices().unwrap().is_empty());
        assert!(store.list_history().unwrap().is_empty());
    }

    #[test]
    fn test_voice_crud() {
        let store = temp_store();
        let id = store.insert_voice("My Voice", "file").unwrap();
        store
            .set_voice_files(id, Path::new("/v/source.wav"), Path::new("/v/e.safetensors"), Some(2.5), Some(24000))
            .unwrap();

        let voices = store.list_voices().unwrap();
        assert_eq!(voices.len(), 1);
        assert_eq!(voices[0].name, "My Voice");
        assert_eq!(voices[0].embeddings_path, "/v/e.safetensors");

        let rec = store.get_voice(id).unwrap().unwrap();
        assert_eq!(rec.source, "file");
        assert_eq!(rec.duration_sec, Some(2.5));

        store.rename_voice(id, "Renamed").unwrap();
        assert_eq!(store.get_voice(id).unwrap().unwrap().name, "Renamed");

        let deleted = store.delete_voice(id).unwrap();
        assert_eq!(deleted.id, id);
        assert!(store.get_voice(id).unwrap().is_none());
    }

    #[test]
    fn test_history_crud() {
        let store = temp_store();
        let id = store
            .insert_history(&NewHistory {
                name: "Hello".to_string(),
                text: "Hello world".to_string(),
                created_at: now_ms(),
                char_count: Some(11),
                chunk_count: Some(4),
                speech_sec: Some(1.0),
                elapsed_sec: Some(1.5),
                sample_rate: Some(24000),
                channels: Some(1),
                voice_label: Some("Alba".to_string()),
            })
            .unwrap();
        store.set_history_wav_path(id, Path::new("/h/1.wav")).unwrap();

        let list = store.list_history().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].text, "Hello world");

        let rec = store.get_history(id).unwrap().unwrap();
        assert_eq!(rec.voice_label.as_deref(), Some("Alba"));

        let deleted = store.delete_history(id).unwrap();
        assert_eq!(deleted.wav_path, "/h/1.wav");
        assert!(store.get_history(id).unwrap().is_none());
    }
}
```

- [ ] **Step 5: Declare the module in lib.rs**

In `src-tauri/src/lib.rs`, change the top to:

```rust
mod store;
mod tts;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test -p warble --lib store::tests --manifest-path src-tauri/Cargo.toml`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/store.rs src-tauri/src/lib.rs
git commit -m "feat(store): SQLite-backed custom voice and history storage"
```

---

### Task 3: Voice commands (clone/list/get/rename/delete) + app wiring

**Files:**
- Modify: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: `Store`, `VoiceRecord`, `crate::tts::TtsState`, `TTSModel::encode_voice_prompt_from_bytes` (Task 1).
- Produces commands (all `pub`):
  - `async fn clone_voice(tts, store, name: String, wav_bytes: Vec<u8>, source: String) -> Result<VoiceRecord, String>`
  - `fn list_custom_voices(store) -> Result<Vec<VoiceRecord>, String>`
  - `fn get_custom_voice(store, id: i64) -> Result<VoiceRecord, String>`
  - `fn rename_custom_voice(store, id: i64, name: String) -> Result<(), String>`
  - `fn delete_custom_voice(store, id: i64) -> Result<(), String>`

- [ ] **Step 1: Confirm the compiler gate**

There is no unit-test harness for Tauri commands in this repo, so the red/green gate is the compiler. First confirm a clean baseline:

Run: `cargo check -p warble --manifest-path src-tauri/Cargo.toml`
Expected: PASS (tree is green before these commands exist).

- [ ] **Step 2: Add the command implementations to store.rs**

Append to `src-tauri/src/store.rs` (after `delete_history`, before `#[cfg(test)]`):

```rust
// ---- voice Tauri commands ----

#[tauri::command]
pub fn list_custom_voices(store: State<'_, Store>) -> Result<Vec<VoiceRecord>, String> {
    store.list_voices()
}

#[tauri::command]
pub fn get_custom_voice(store: State<'_, Store>, id: i64) -> Result<VoiceRecord, String> {
    store.get_voice(id)?.ok_or_else(|| format!("unknown voice id: {id}"))
}

#[tauri::command]
pub fn rename_custom_voice(store: State<'_, Store>, id: i64, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("voice name cannot be empty".to_string());
    }
    store.rename_voice(id, &name)
}

#[tauri::command]
pub fn delete_custom_voice(store: State<'_, Store>, id: i64) -> Result<(), String> {
    let rec = store.delete_voice(id)?;
    let _ = std::fs::remove_dir_all(store.voice_dir(rec.id));
    Ok(())
}

/// Clone a voice from WAV bytes: encodes speaker embeddings via the loaded
/// model, stages files in a temp dir, then atomically moves them into
/// `voices/<id>/` and records the row.
#[tauri::command]
pub async fn clone_voice(
    tts: State<'_, crate::tts::TtsState>,
    store: State<'_, Store>,
    name: String,
    wav_bytes: Vec<u8>,
    source: String,
) -> Result<VoiceRecord, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("voice name cannot be empty".to_string());
    }
    let source = if source == "recording" { "recording" } else { "file" }.to_string();

    let model = tts
        .model
        .lock()
        .map_err(|_| "model lock poisoned".to_string())?
        .as_ref()
        .ok_or("no model loaded; call load_tts_model first")?
        .clone();
    let store = store.inner().clone();

    let id = tauri::async_runtime::spawn_blocking(move || -> Result<i64, String> {
        let id = store.insert_voice(&name, &source)?;

        let cleanup = |id: i64, dir: &Path| {
            let _ = store.delete_voice(id);
            let _ = std::fs::remove_dir_all(dir);
        };

        let voices_root = store.data_dir().join("voices");
        std::fs::create_dir_all(&voices_root).map_err(|e| e.to_string())?;
        let tmp_dir = voices_root.join(format!(".tmp-{id}"));
        std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;

        let wav_path = tmp_dir.join("source.wav");
        if let Err(e) = std::fs::write(&wav_path, &wav_bytes) {
            cleanup(id, &tmp_dir);
            return Err(format!("failed to write source audio: {e}"));
        }

        let prompt = match model.encode_voice_prompt_from_bytes(&wav_bytes) {
            Ok(p) => p,
            Err(e) => {
                cleanup(id, &tmp_dir);
                return Err(format!("voice cloning failed: {e}"));
            }
        };
        let mut tensors = HashMap::new();
        tensors.insert("audio_prompt".to_string(), prompt);
        let safetensors_path = tmp_dir.join("embeddings.safetensors");
        if let Err(e) = candle_core::safetensors::save(&tensors, &safetensors_path) {
            cleanup(id, &tmp_dir);
            return Err(format!("failed to write embeddings: {e}"));
        }

        let (audio, sample_rate) = match pocket_tts::audio::read_wav_from_bytes(&wav_bytes) {
            Ok(v) => v,
            Err(e) => {
                cleanup(id, &tmp_dir);
                return Err(format!("failed to parse wav: {e}"));
            }
        };
        let num_samples = audio.dims()[1] as f64;
        let duration_sec = num_samples / sample_rate as f64;

        let final_dir = store.voice_dir(id);
        if let Err(e) = std::fs::rename(&tmp_dir, &final_dir) {
            cleanup(id, &tmp_dir);
            return Err(format!("failed to finalize voice files: {e}"));
        }

        store.set_voice_files(
            id,
            &final_dir.join("source.wav"),
            &final_dir.join("embeddings.safetensors"),
            Some(duration_sec),
            Some(sample_rate as i64),
        )?;

        Ok(id)
    })
    .await
    .map_err(|e| format!("clone task panicked: {e}"))??;

    store.get_voice(id)?.ok_or_else(|| "voice disappeared after insert".to_string())
}
```

Add the required imports at the top of `store.rs`:

```rust
use tauri::State;
```

(The `HashMap` import is already present from Task 2.)

- [ ] **Step 3: Register commands + initialize the store in lib.rs**

Replace `src-tauri/src/lib.rs` with the version below. The four history commands are **registered in a comment block** (`// store::list_history, …`) so the tree stays green until Task 4 defines them; uncomment in Task 4.

```rust
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod store;
mod tts;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(tts::TtsState::default())
        .setup(|app| {
            use tauri::Manager;
            let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            app.manage(store::Store::init(dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            tts::load_tts_model,
            tts::get_tts_voice_state,
            tts::generate_tts_stream,
            store::clone_voice,
            store::list_custom_voices,
            store::get_custom_voice,
            store::rename_custom_voice,
            store::delete_custom_voice,
            // store::list_history,
            // store::get_history,
            // store::get_history_audio,
            // store::delete_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Grant fs read permission**

In `src-tauri/capabilities/default.json`, replace the `permissions` array with:

```json
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    { "identifier": "fs:allow-write-file", "allow": [{ "path": "**" }] },
    { "identifier": "fs:allow-read-file", "allow": [{ "path": "**" }] }
  ]
```

- [ ] **Step 5: Verify it compiles**

Run: `cargo check -p warble --manifest-path src-tauri/Cargo.toml`
Expected: PASS (history commands omitted from the handler for now; `Clone`, `State`, `pocket_tts`, `candle_core` all resolve).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/store.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(store): voice clone/list/get/rename/delete commands"
```

---

### Task 4: History commands + generation persistence

**Files:**
- Modify: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/tts.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `Store`, `HistoryRecord`, `NewHistory`, `write_wav_file`, `now_ms` (Task 2); `TtsState` (existing).
- Produces commands:
  - `fn list_history(store) -> Result<Vec<HistoryRecord>, String>`
  - `fn get_history(store, id: i64) -> Result<HistoryRecord, String>`
  - `fn get_history_audio(store, id: i64) -> Result<tauri::ipc::Response, String>`
  - `fn delete_history(store, id: i64) -> Result<(), String>`
- Modifies `generate_tts_stream` signature to:
  `pub async fn generate_tts_stream(app, state, store, text: String, voice_id: String, name: String, voice_label: Option<String>) -> Result<u32, String>`

- [ ] **Step 1: Add the history commands to store.rs**

Append to `src-tauri/src/store.rs` before `#[cfg(test)]`:

```rust
// ---- history Tauri commands ----

#[tauri::command]
pub fn list_history(store: State<'_, Store>) -> Result<Vec<HistoryRecord>, String> {
    store.list_history()
}

#[tauri::command]
pub fn get_history(store: State<'_, Store>, id: i64) -> Result<HistoryRecord, String> {
    store.get_history(id)?.ok_or_else(|| format!("unknown history id: {id}"))
}

#[tauri::command]
pub fn get_history_audio(store: State<'_, Store>, id: i64) -> Result<tauri::ipc::Response, String> {
    let rec = store.get_history(id)?.ok_or_else(|| format!("unknown history id: {id}"))?;
    let bytes = std::fs::read(&rec.wav_path).map_err(|e| format!("failed to read audio: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn delete_history(store: State<'_, Store>, id: i64) -> Result<(), String> {
    let rec = store.delete_history(id)?;
    let _ = std::fs::remove_file(&rec.wav_path);
    Ok(())
}
```

- [ ] **Step 2: Modify generate_tts_stream in tts.rs**

In `src-tauri/src/tts.rs`:

1. Add at the top, after the existing imports:

```rust
use crate::store::{NewHistory, Store};
```

2. Replace the entire `generate_tts_stream` function (lines ~292-380) with:

```rust
/// Generate speech for `text` using a previously created voice state,
/// streaming each audio chunk to the frontend as a `tts://chunk` event.
///
/// Returns the number of chunks streamed once generation completes. The full
/// output is also persisted to disk as `history/<id>.wav` and recorded in the
/// store so users can replay / edit it later.
#[tauri::command]
pub async fn generate_tts_stream(
    app: AppHandle,
    state: State<'_, TtsState>,
    store: State<'_, Store>,
    text: String,
    voice_id: String,
    name: String,
    voice_label: Option<String>,
) -> Result<u32, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "model lock poisoned".to_string())?
        .as_ref()
        .ok_or("no model loaded; call load_tts_model first")?
        .clone();

    let voice_state = state
        .voices
        .lock()
        .map_err(|_| "voices lock poisoned".to_string())?
        .get(&voice_id)
        .cloned()
        .ok_or_else(|| format!("unknown voice_id: {voice_id}"))?;

    let sample_rate = model.sample_rate as u32;
    let channels = model.mimi.channels as u16;

    let app = app.clone();
    let voice_id_out = voice_id.clone();
    let store = store.inner().clone();
    let name = if name.trim().is_empty() {
        "Untitled generation".to_string()
    } else {
        name
    };
    let created_at = crate::store::now_ms();
    let char_count = text.chars().count() as i64;
    let t0 = std::time::Instant::now();

    tauri::async_runtime::spawn_blocking(move || {
        let mut index: u32 = 0;
        let mut pcm_accum: Vec<u8> = Vec::new();

        for chunk in model.generate_stream(&text, &voice_state) {
            let tensor = match chunk {
                Ok(t) => t,
                Err(e) => {
                    emit(&app, "error", TtsErrorPayload {
                        voice_id: voice_id_out.clone(),
                        message: format!("generation failed: {e}"),
                    });
                    return Err(format!("generation failed: {e}"));
                }
            };

            // Each chunk is [batch=1, channels, samples]; PCM encoding needs 2D.
            let tensor = match tensor.squeeze(0) {
                Ok(t) => t,
                Err(e) => {
                    emit(&app, "error", TtsErrorPayload {
                        voice_id: voice_id_out.clone(),
                        message: format!("audio shaping failed: {e}"),
                    });
                    return Err(format!("audio shaping failed: {e}"));
                }
            };

            let pcm = match pocket_tts::audio::pcm_i16_le_bytes(&tensor) {
                Ok(bytes) => bytes,
                Err(e) => {
                    emit(&app, "error", TtsErrorPayload {
                        voice_id: voice_id_out.clone(),
                        message: format!("audio encoding failed: {e}"),
                    });
                    return Err(format!("audio encoding failed: {e}"));
                }
            };

            emit(&app, "chunk", TtsChunkPayload {
                voice_id: voice_id_out.clone(),
                index,
                sample_rate,
                channels,
                pcm: pcm.clone(),
            });

            pcm_accum.extend_from_slice(&pcm);
            index += 1;
        }

        // Persist the finished generation (durable copy; the frontend keeps
        // its live in-memory playback). A persistence failure is non-fatal:
        // the audio still played, so only log it.
        let speech_samples = pcm_accum.len() / 2 / channels as usize;
        let speech_sec = speech_samples as f64 / sample_rate as f64;
        let elapsed_sec = t0.elapsed().as_secs_f64();
        if let Err(e) = (|| -> Result<(), String> {
            let history_dir = store.data_dir().join("history");
            std::fs::create_dir_all(&history_dir).map_err(|e| e.to_string())?;
            let id = store.insert_history(&NewHistory {
                name: name.clone(),
                text: text.clone(),
                created_at,
                char_count: Some(char_count),
                chunk_count: Some(index as i64),
                speech_sec: Some(speech_sec),
                elapsed_sec: Some(elapsed_sec),
                sample_rate: Some(sample_rate as i64),
                channels: Some(channels as i64),
                voice_label,
            })?;
            let wav_path = store.history_wav_path(id);
            crate::store::write_wav_file(&wav_path, &pcm_accum, sample_rate, channels)?;
            store.set_history_wav_path(id, &wav_path)?;
            Ok(())
        })() {
            eprintln!("failed to persist history: {e}");
        }

        emit(&app, "done", TtsDonePayload {
            voice_id: voice_id_out,
            total_chunks: index,
            sample_rate,
        });

        Ok(index)
    })
    .await
    .map_err(|e| format!("generation task panicked: {e}"))?
}
```

- [ ] **Step 3: Register the history commands in lib.rs**

In `src-tauri/src/lib.rs`, uncomment the four history entries so the handler is:

```rust
            store::clone_voice,
            store::list_custom_voices,
            store::get_custom_voice,
            store::rename_custom_voice,
            store::delete_custom_voice,
            store::list_history,
            store::get_history,
            store::get_history_audio,
            store::delete_history,
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p warble --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/store.rs src-tauri/src/tts.rs src-tauri/src/lib.rs
git commit -m "feat(tts): persist generation history to SQLite + wav"
```

---

### Task 5: Frontend API + audio helpers

**Files:**
- Create: `src/lib/api.ts`
- Create: `src/lib/audio.ts`

**Interfaces:**
- Produces (used by Tasks 6–8):
  - `VoiceRecord`, `HistoryRecord` TS interfaces (camelCase, mirroring the serde structs).
  - `listCustomVoices()`, `getCustomVoice(id)`, `renameCustomVoice(id, name)`, `deleteCustomVoice(id)`, `cloneVoice(name, wavBytes: Uint8Array, source: "file" | "recording")`, `listHistory()`, `getHistoryAudio(id): Promise<ArrayBuffer>`, `deleteHistory(id)`.
  - `blobToWavBytes(blob): Promise<Uint8Array>`, `fileToWavBytes(path: string): Promise<Uint8Array>`.

- [ ] **Step 1: Create `src/lib/api.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";

export interface VoiceRecord {
  id: number;
  name: string;
  createdAt: number;
  wavPath: string;
  embeddingsPath: string;
  durationSec: number | null;
  sampleRate: number | null;
  source: "file" | "recording";
}

export interface HistoryRecord {
  id: number;
  name: string;
  text: string;
  createdAt: number;
  charCount: number | null;
  chunkCount: number | null;
  speechSec: number | null;
  elapsedSec: number | null;
  sampleRate: number | null;
  channels: number | null;
  wavPath: string;
  voiceLabel: string | null;
}

export function listCustomVoices(): Promise<VoiceRecord[]> {
  return invoke("list_custom_voices");
}

export function getCustomVoice(id: number): Promise<VoiceRecord> {
  return invoke("get_custom_voice", { id });
}

export function renameCustomVoice(id: number, name: string): Promise<void> {
  return invoke("rename_custom_voice", { id, name });
}

export function deleteCustomVoice(id: number): Promise<void> {
  return invoke("delete_custom_voice", { id });
}

export function cloneVoice(
  name: string,
  wavBytes: Uint8Array,
  source: "file" | "recording"
): Promise<VoiceRecord> {
  return invoke("clone_voice", { name, wavBytes, source });
}

export function listHistory(): Promise<HistoryRecord[]> {
  return invoke("list_history");
}

export function getHistoryAudio(id: number): Promise<ArrayBuffer> {
  return invoke("get_history_audio", { id });
}

export function deleteHistory(id: number): Promise<void> {
  return invoke("delete_history", { id });
}
```

- [ ] **Step 2: Create `src/lib/audio.ts`**

```ts
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
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm build`
Expected: PASS (tsc + vite).

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/lib/audio.ts
git commit -m "feat(frontend): typed tauri api + wav conversion helpers"
```

---

### Task 6: Voice clone wizard component

**Files:**
- Create: `src/components/voice-clone-wizard.tsx`

**Interfaces:**
- Consumes: `cloneVoice`, `VoiceRecord` (Task 5), `blobToWavBytes`, `fileToWavBytes` (Task 5), `open()` from `@tauri-apps/plugin-dialog`, shadcn `Dialog`/`Button`/`Input`/`Label`.
- Produces:
  - `VoiceCloneWizard({ open, onOpenChange, onCloned }: { open: boolean; onOpenChange: (open: boolean) => void; onCloned: (voice: VoiceRecord) => void })`
  - Emits `source: "file" | "recording"` to `cloneVoice` based on how the audio was captured.

- [ ] **Step 1: Write the component**

Create `src/components/voice-clone-wizard.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Mic, MicOff, Pause, Play, Upload } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cloneVoice, type VoiceRecord } from "@/lib/api";
import { blobToWavBytes, fileToWavBytes } from "@/lib/audio";

interface VoiceCloneWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: (voice: VoiceRecord) => void;
}

type Tab = "file" | "record";

export function VoiceCloneWizard({ open, onOpenChange, onCloned }: VoiceCloneWizardProps) {
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<Tab>("file");
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [wavBytes, setWavBytes] = useState<Uint8Array | null>(null);
  const [name, setName] = useState("");
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloned, setCloned] = useState<VoiceRecord | null>(null);
  const [recState, setRecState] = useState<"idle" | "recording">("idle");
  const [recTime, setRecTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      setTab("file");
      setSourceName(null);
      setSourceUrl(null);
      setWavBytes(null);
      setName("");
      setError(null);
      setCloned(null);
      setRecTime(0);
    } else {
      stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopRecording() {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
    if (recTimerRef.current !== null) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecState("idle");
  }

  async function pickFile() {
    const path = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "mp4", "ogg", "flac", "aac"] }],
    });
    if (typeof path !== "string") return;
    try {
      const bytes = await fileToWavBytes(path);
      setSourceName(path.split(/[\\/]/).pop() ?? path);
      setSourceUrl(URL.createObjectURL(new Blob([bytes as BlobPart])));
      setWavBytes(bytes);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function toggleRecording() {
    if (recState === "recording") {
      stopRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        try {
          const bytes = await blobToWavBytes(blob);
          setSourceName("Microphone recording");
          setSourceUrl(URL.createObjectURL(new Blob([bytes as BlobPart])));
          setWavBytes(bytes);
          setError(null);
        } catch (err) {
          setError(String(err));
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      rec.start();
      mediaRef.current = rec;
      setRecState("recording");
      setRecTime(0);
      recTimerRef.current = window.setInterval(() => setRecTime((t) => t + 1), 1000);
    } catch (err) {
      setError(`Microphone access denied: ${String(err)}`);
    }
  }

  function togglePreview() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  async function startClone() {
    if (!wavBytes || !name.trim()) return;
    setCloning(true);
    setError(null);
    try {
      const voice = await cloneVoice(
        name.trim(),
        wavBytes,
        sourceName === "Microphone recording" ? "recording" : "file"
      );
      setCloned(voice);
    } catch (err) {
      setError(String(err));
    } finally {
      setCloning(false);
    }
  }

  const hasSource = Boolean(wavBytes);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Clone a voice</DialogTitle>
          <DialogDescription>
            {step === 0 && "Step 1 of 3 — choose your source audio"}
            {step === 1 && "Step 2 of 3 — name this voice"}
            {step === 2 && "Step 3 of 3 — creating your voice clone"}
          </DialogDescription>
        </DialogHeader>

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
          </div>
        ) : step === 0 ? (
          <div className="flex flex-col gap-4">
            <div className="border-border grid grid-cols-2 rounded-lg border p-1">
              {(["file", "record"] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex items-center justify-center gap-2 rounded-md py-2 text-sm ${tab === key ? "bg-accent font-medium" : "text-muted-foreground"}`}
                >
                  {key === "file" ? <Upload className="size-4" /> : <Mic className="size-4" />}
                  {key === "file" ? "Upload file" : "Record"}
                </button>
              ))}
            </div>

            {tab === "file" ? (
              <div className="border-border bg-muted/30 flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8">
                <Button variant="outline" onClick={() => void pickFile()}>
                  <Upload className="size-4" /> Choose audio file
                </Button>
                <p className="text-muted-foreground text-xs">
                  wav · mp3 · m4a · mp4 · ogg — converted to WAV automatically
                </p>
              </div>
            ) : (
              <div className="border-border bg-muted/30 flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8">
                <Button variant={recState === "recording" ? "destructive" : "default"} onClick={() => void toggleRecording()}>
                  {recState === "recording" ? (
                    <>
                      <MicOff className="size-4" /> Stop · {recTime}s
                    </>
                  ) : (
                    <>
                      <Mic className="size-4" /> Start recording
                    </>
                  )}
                </Button>
                <p className="text-muted-foreground text-xs">Speak for a few seconds, then stop</p>
              </div>
            )}

            {sourceName && (
              <div className="flex items-center gap-3">
                <audio ref={audioRef} src={sourceUrl ?? undefined} className="hidden" />
                <Button variant="outline" size="icon" onClick={togglePreview} aria-label="Preview source audio">
                  <Play className="size-4" />
                </Button>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">{sourceName}</span>
                <span className="text-muted-foreground text-xs">
                  {wavBytes ? `${(wavBytes.length / 1024).toFixed(0)} KB` : ""}
                </span>
              </div>
            )}
          </div>
        ) : step === 1 ? (
          <div className="flex flex-col gap-4">
            <Label htmlFor="voice-name">Voice name</Label>
            <Input
              id="voice-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="e.g. My warm voice"
              autoFocus
            />
            {sourceName && (
              <p className="text-muted-foreground text-xs">Source: {sourceName}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <LoaderCircle className="text-primary size-8 animate-spin" />
            <p className="text-sm">Encoding your voice… this can take a moment.</p>
          </div>
        )}

        {error && <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">{error}</p>}

        <DialogFooter>
          <span className="mr-auto text-xs">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`mr-1 inline-block size-2 rounded-full ${i === step ? "bg-primary" : "bg-border"}`}
              />
            ))}
          </span>
          {cloned ? (
            <>
              <Button variant="ghost" onClick={() => setCloned(null)}>
                Clone another
              </Button>
              <Button onClick={() => onCloned(cloned)}>Use this voice</Button>
            </>
          ) : step === 0 ? (
            <Button onClick={() => hasSource && setStep(1)} disabled={!hasSource}>
              Next
            </Button>
          ) : step === 1 ? (
            <>
              <Button variant="ghost" onClick={() => setStep(0)} disabled={cloning}>
                Back
              </Button>
              <Button onClick={() => void startClone()} disabled={!name.trim() || cloning}>
                {cloning ? "Cloning…" : "Clone voice"}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setStep(1)} disabled={cloning}>
              Back
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/voice-clone-wizard.tsx
git commit -m "feat(frontend): voice clone wizard (file or mic, name, clone)"
```

---

### Task 7: Voice library + history panel UI updates

**Files:**
- Modify: `src/components/voice-picker-dialog.tsx`
- Modify: `src/components/history-item.tsx`
- Modify: `src/components/tts-workspace.tsx`

**Interfaces:**
- Consumes: `VoiceRecord`, `HistoryRecord` (Task 5).
- Produces new prop shapes consumed by App.tsx in Task 8:
  - `VoicePickerDialog` adds: `customVoices: VoiceRecord[]`, `selectedCustomVoiceId: number | null`, `onSelectCustom: (id: number) => void`, `onClone: () => void`, `onRenameCustom: (id: number, name: string) => void`, `onDeleteCustom: (id: number) => void`.
  - `HistoryItem` adds: `voiceLabel?: string | null`, `onEdit: () => void`, `onDelete: () => void`.
  - `TtsWorkspaceProps` history-related changes:
    - `history: HistoryRecord[]`
    - `onReplay: (record: HistoryRecord) => void`
    - `onDownload: (record: HistoryRecord) => void`
    - `onEdit: (record: HistoryRecord) => void`
    - `onDeleteHistory: (record: HistoryRecord) => void`
    - `customVoices: VoiceRecord[]`
    - `selectedCustomVoiceId: number | null`
    - `onSelectCustomVoice: (id: number) => void`
    - `onCloneVoice: () => void`
    - `wizardOpen: boolean`
    - `onWizardOpenChange: (open: boolean) => void`
    - `onRenameVoice: (id: number, name: string) => void`
    - `onDeleteVoice: (id: number) => void`
    - `currentVoiceName: string`

- [ ] **Step 1: Update `src/components/voice-picker-dialog.tsx`**

Replace the file with:

```tsx
import { Check, ChevronRight, Mic, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { STOCK_VOICES } from "@/components/voice-data";
import { VoiceOrb } from "@/components/voice-orb";
import type { VoiceRecord } from "@/lib/api";

interface VoicePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string;
  selectedCustomVoiceId: number | null;
  hasVoice: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onLoad: (spec?: string) => void;
  customVoices: VoiceRecord[];
  onSelectCustom: (id: number) => void;
  onClone: () => void;
  onRenameCustom: (id: number, name: string) => void;
  onDeleteCustom: (id: number) => void;
  loading: boolean;
  variant: string;
  currentVoiceName: string;
}

export function VoicePickerDialog({
  open,
  onOpenChange,
  selectedId,
  selectedCustomVoiceId,
  hasVoice,
  search,
  onSearchChange,
  onLoad,
  customVoices,
  onSelectCustom,
  onClone,
  onRenameCustom,
  onDeleteCustom,
  loading,
  variant,
  currentVoiceName,
}: VoicePickerDialogProps) {
  const selected = STOCK_VOICES.find((voice) => voice.id === selectedId) ?? STOCK_VOICES[0];
  const voices = STOCK_VOICES.filter((voice) =>
    `${voice.name} ${voice.description} ${voice.tone}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button className="hover:bg-accent flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors">
          <VoiceOrb active={hasVoice} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{hasVoice ? currentVoiceName : "Choose a voice"}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {hasVoice ? "Custom voice" : "Browse voice library"}
            </span>
          </span>
          <ChevronRight className="text-muted-foreground size-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Voice library</DialogTitle>
          <DialogDescription>Choose a voice and it loads immediately into this session.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="Search voices…"
          />
          <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
            {voices.map((voice) => (
              <button
                key={voice.id}
                onClick={() => onLoad(voice.id)}
                disabled={loading}
                className={`hover:border-primary/60 hover:bg-accent flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${selectedId === voice.id && !selectedCustomVoiceId && hasVoice ? "border-primary/60 bg-accent" : "border-border"}`}
              >
                <VoiceOrb active={selectedId === voice.id && hasVoice} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{voice.name}</span>
                  <span className="text-muted-foreground mt-1 block truncate text-xs">{voice.description}</span>
                </span>
                {selectedId === voice.id && hasVoice && <Check className="text-primary" />}
              </button>
            ))}
          </div>

          <div className="border-border rounded-xl border">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground text-xs tracking-[.14em] uppercase">Custom voices</span>
              <Button size="sm" variant="outline" onClick={onClone}>
                <Mic className="size-4" /> Clone a voice
              </Button>
            </div>
            {customVoices.length === 0 ? (
              <p className="text-muted-foreground border-t border-border px-4 py-4 text-sm">
                No cloned voices yet. Use “Clone a voice” to save your first one.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border border-t">
                {customVoices.map((voice) => (
                  <div
                    key={voice.id}
                    className={`flex items-center gap-3 px-4 py-3 ${selectedCustomVoiceId === voice.id ? "bg-accent" : ""}`}
                  >
                    <button
                      onClick={() => onSelectCustom(voice.id)}
                      disabled={loading}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <VoiceOrb active={selectedCustomVoiceId === voice.id} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{voice.name}</span>
                        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                          {voice.source === "recording" ? "Recording" : "File"} · {(voice.durationSec ?? 0).toFixed(1)}s
                        </span>
                      </span>
                      {selectedCustomVoiceId === voice.id && <Check className="text-primary" />}
                    </button>
                    <button
                      onClick={() => {
                        const next = window.prompt("Rename voice", voice.name);
                        if (next?.trim()) onRenameCustom(voice.id, next.trim());
                      }}
                      className="hover:bg-accent text-muted-foreground hover:text-foreground rounded-md p-2"
                      aria-label={`Rename ${voice.name}`}
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete "${voice.name}"? This removes the saved clone and its audio.`)) {
                          onDeleteCustom(voice.id);
                        }
                      }}
                      className="hover:bg-accent text-muted-foreground hover:text-destructive rounded-md p-2"
                      aria-label={`Delete ${voice.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <span className="text-muted-foreground mr-auto text-xs">Current model · {variant}</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note: the free-text "custom voice source" input is removed per the spec (the wizard + saved list replace it).

- [ ] **Step 2: Update `src/components/history-item.tsx`**

Replace with:

```tsx
import { Download, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HistoryItemProps {
  name: string;
  duration: number;
  voiceLabel?: string | null;
  active: boolean;
  onPlay: () => void;
  onDownload: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}

export function HistoryItem({
  name,
  duration,
  voiceLabel,
  active,
  onPlay,
  onDownload,
  onEdit,
  onDelete,
  disabled,
}: HistoryItemProps) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-md px-3 py-3 ${active ? "bg-accent" : "hover:bg-accent/60"}`}
    >
      <button onClick={onPlay} disabled={disabled} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm">{name}</span>
        <span className="text-muted-foreground mt-1 block text-xs">
          {voiceLabel ? `${voiceLabel} · ` : ""}
          {duration.toFixed(2)} seconds
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onEdit}
        disabled={disabled}
        aria-label={`Edit ${name} text`}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onDownload}
        disabled={disabled}
        aria-label={`Download ${name} as WAV`}
      >
        <Download />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onDelete}
        disabled={disabled}
        aria-label={`Delete ${name}`}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Update `src/components/tts-workspace.tsx`**

1. Update the `TtsWorkspaceProps` interface in `tts-workspace.tsx`. Replace the history-related block and add the new fields. The resulting interface (full replacement):

```tsx
interface TtsWorkspaceProps {
  text: string;
  onTextChange: (value: string) => void;
  modelInfo: ModelInfo | null;
  variant: string;
  loading: boolean;
  generating: boolean;
  status: string;
  progress: number;
  chunkCount: number;
  streamedSec: number;
  elapsedSec: number;
  streamPlaying: boolean;
  onToggleStreamPlayback: () => void;
  voiceId: string | null;
  stockVoice: string;
  voiceOpen: boolean;
  onVoiceOpenChange: (open: boolean) => void;
  voiceSearch: string;
  onVoiceSearchChange: (value: string) => void;
  onLoadVoice: (spec?: string) => void;
  customVoices: VoiceRecord[];
  selectedCustomVoiceId: number | null;
  onSelectCustomVoice: (id: number) => void;
  onCloneVoice: () => void;
  onRenameVoice: (id: number, name: string) => void;
  onDeleteVoice: (id: number) => void;
  wizardOpen: boolean;
  onWizardOpenChange: (open: boolean) => void;
  currentVoiceName: string;
  onGenerate: () => void;
  onStopGeneration: () => void;
  history: HistoryRecord[];
  currentClip: HistoryEntry | null;
  generatedAudioSrc: string | null;
  onReplay: (record: HistoryRecord) => void;
  onDownload: (record: HistoryRecord) => void;
  onEdit: (record: HistoryRecord) => void;
  onDeleteHistory: (record: HistoryRecord) => void;
  generationSettings: GenerationSettings;
  hasPendingSettings: boolean;
  onGenerationSettingsChange: (settings: GenerationSettings) => void;
  onReloadModel: () => void;
  onResetGenerationSettings: () => void;
  onInsertPause: () => void;
}
```

2. Add the `HistoryRecord` import:

```tsx
import type { HistoryRecord, VoiceRecord } from "@/lib/api";
```

3. Replace the top of `TtsWorkspace`:

```tsx
export function TtsWorkspace(props: TtsWorkspaceProps) {
  const [rightTab, setRightTab] = useState<"settings" | "history">("history");
  const selectedVoice = STOCK_VOICES.find((voice) => voice.id === props.stockVoice) ?? STOCK_VOICES[0];
  const showTransport = Boolean(props.currentClip && props.generatedAudioSrc);
```

4. In `SettingsPanel`, update the `VoicePickerDialog` usage to pass the new props:

```tsx
          <VoicePickerDialog
            open={props.voiceOpen}
            onOpenChange={props.onVoiceOpenChange}
            selectedId={props.selectedVoice.id}
            selectedCustomVoiceId={props.selectedCustomVoiceId}
            hasVoice={Boolean(props.voiceId)}
            search={props.voiceSearch}
            onSearchChange={props.onVoiceSearchChange}
            onLoad={props.onLoadVoice}
            customVoices={props.customVoices}
            onSelectCustom={props.onSelectCustomVoice}
            onClone={props.onCloneVoice}
            onRenameCustom={props.onRenameVoice}
            onDeleteCustom={props.onDeleteVoice}
            loading={props.loading}
            variant={props.variant}
            currentVoiceName={props.currentVoiceName}
          />
```

5. In `HistoryPanel`, replace the map block:

```tsx
          {entries.map((entry) => (
            <HistoryItem
              key={entry.id}
              name={entry.name}
              duration={entry.speechSec ?? 0}
              voiceLabel={entry.voiceLabel}
              active={props.currentClip?.id === entry.id}
              onPlay={() => props.onReplay(entry)}
              onDownload={() => props.onDownload(entry)}
              onEdit={() => props.onEdit(entry)}
              onDelete={() => props.onDeleteHistory(entry)}
              disabled={props.generating}
            />
          ))}
```

And update the filter to use `HistoryRecord`:

```tsx
function HistoryPanel(props: TtsWorkspaceProps) {
  const [query, setQuery] = useState("");
  const entries = useMemo(
    () => props.history.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase())),
    [props.history, query]
  );
```

Note: `HistoryPanel` already renders `entry.name` — no other changes needed there.

- [ ] **Step 4: Verify types compile**

Run: `pnpm build`
Expected: PASS (App.tsx still passes the old props — it will fail until Task 8 updates it; if App.tsx errors, that is expected mid-task and resolves in Task 8. If you want a green check here, temporarily pass the new props from App.tsx as undefined-safe defaults; otherwise accept the App.tsx error and fix in Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/components/voice-picker-dialog.tsx src/components/history-item.tsx src/components/tts-workspace.tsx
git commit -m "feat(frontend): custom voice library + history edit/delete actions"
```

---

### Task 8: App.tsx wiring

**Files:**
- Modify: `src/App.tsx`
- (No new files)

**Interfaces:**
- Consumes: `VoiceRecord`, `HistoryRecord`, `listCustomVoices`, `getCustomVoice`, `renameCustomVoice`, `deleteCustomVoice`, `listHistory`, `getHistoryAudio`, `deleteHistory` (Task 5); `VoiceCloneWizard` (Task 6); new `TtsWorkspaceProps` (Task 7).
- Produces: end-to-end behavior — persisted history from DB, custom voice selection, clone flow, edit-text, delete.

- [ ] **Step 1: Update imports and interfaces in App.tsx**

Replace the import block at the top of `src/App.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { TtsWorkspace } from "@/components/tts-workspace";
import { VoiceCloneWizard } from "@/components/voice-clone-wizard";
import { STOCK_VOICES } from "@/components/voice-data";
import { audioBuffersToWavBlob } from "@/lib/pcm";
import { StreamPlayer } from "@/lib/streamPlayer";
import {
  deleteCustomVoice,
  deleteHistory,
  getCustomVoice,
  getHistoryAudio,
  listCustomVoices,
  listHistory,
  renameCustomVoice,
  type HistoryRecord,
  type VoiceRecord,
} from "@/lib/api";
```

Keep the existing `HistoryEntry`, `Phase`, and other interface definitions. Add a `decodeHistoryAudio` helper at module scope (after `titleFromText`):

```tsx
async function decodeHistoryAudio(record: HistoryRecord): Promise<HistoryEntry> {
  const bytes = await getHistoryAudio(record.id);
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(bytes);
  void ctx.close();
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    charCount: record.charCount ?? 0,
    chunkCount: record.chunkCount ?? 0,
    speechSec: record.speechSec ?? 0,
    elapsedSec: record.elapsedSec ?? 0,
    sampleRate: record.sampleRate ?? decoded.sampleRate,
    channels: record.channels ?? decoded.numberOfChannels,
    buffers: [decoded],
  };
}
```

- [ ] **Step 2: Add new state and handlers inside App**

In the `App` component body, add state alongside the existing state:

```tsx
  const [customVoices, setCustomVoices] = useState<VoiceRecord[]>([]);
  const [selectedCustomVoice, setSelectedCustomVoice] = useState<VoiceRecord | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
```

Add helper callbacks (after `getPlayer`):

```tsx
  const refreshVoices = useCallback(async () => {
    try {
      setCustomVoices(await listCustomVoices());
    } catch (error) {
      setStatus(String(error));
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listHistory());
    } catch (error) {
      setStatus(String(error));
    }
  }, []);
```

Add a `useEffect` to load persisted data on mount:

```tsx
  useEffect(() => {
    void refreshVoices();
    void refreshHistory();
  }, [refreshVoices, refreshHistory]);
```

Add voice-loading + clone handlers:

```tsx
  async function loadCustomVoice(id: number) {
    if (!modelInfo) {
      setStatus("The model is still loading.");
      return;
    }
    try {
      const record = await getCustomVoice(id);
      const voiceId = await invoke<string>("get_tts_voice_state", { voiceSpec: record.embeddingsPath });
      setVoiceId(voiceId);
      setSelectedCustomVoice(record);
      setPhase("loaded");
      setStatus(`${record.name} is ready`);
      setVoiceOpen(false);
    } catch (error) {
      setPhase("error");
      setStatus(String(error));
    }
  }

  async function handleCloned(voice: VoiceRecord) {
    setWizardOpen(false);
    await refreshVoices();
    await loadCustomVoice(voice.id);
  }

  async function handleRenameVoice(id: number, name: string) {
    try {
      await renameCustomVoice(id, name);
      await refreshVoices();
      setStatus("Voice renamed");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function handleDeleteVoice(id: number) {
    try {
      await deleteCustomVoice(id);
      if (selectedCustomVoice?.id === id) {
        setSelectedCustomVoice(null);
        setVoiceId(null);
      }
      await refreshVoices();
      setStatus("Voice deleted");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function handleEdit(record: HistoryRecord) {
    setText(record.text);
    setStatus(`Loaded "${record.name}" text into the composer`);
  }

  async function handleDeleteHistory(record: HistoryRecord) {
    try {
      await deleteHistory(record.id);
      if (currentClip?.id === record.id) {
        setCurrentClip(null);
      }
      await refreshHistory();
      setStatus("Generation deleted");
    } catch (error) {
      setStatus(String(error));
    }
  }
```

Add `replay` + `download` overrides (the current ones operate on in-memory entries):

```tsx
  async function replay(record: HistoryRecord) {
    try {
      const entry = await decodeHistoryAudio(record);
      setCurrentClip(entry);
      setStatus(`Loaded ${record.name}`);
    } catch (error) {
      setStatus(`Could not load audio: ${String(error)}`);
    }
  }

  async function download(record: HistoryRecord) {
    try {
      const bytes = await getHistoryAudio(record.id);
      const blob = new Blob([bytes], { type: "audio/wav" });
      const path = await save({
        defaultPath: `warble-${record.id}.wav`,
        filters: [{ name: "WAV audio", extensions: ["wav"] }],
      });
      if (path) {
        await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
        setStatus(`Saved ${path}`);
      }
    } catch (error) {
      setPhase("error");
      setStatus(String(error));
    }
  }
```

- [ ] **Step 3: Update `generate()` to pass name/voiceLabel**

In `generate()`, change the invoke call:

```tsx
      await invoke<number>("generate_tts_stream", {
        text,
        voiceId,
        name: genMetaRef.current?.name ?? "Untitled generation",
        voiceLabel: currentVoiceName,
      });
```

- [ ] **Step 4: Update `handleDone` to refresh persisted history**

In `handleDone`, after `setCurrentClip(entry);` add:

```tsx
      void refreshHistory();
```

And remove the in-memory push line:

```tsx
      setHistory((items) => [entry, ...items].slice(0, 20));
```

(Replace it with the `refreshHistory()` call above.)

- [ ] **Step 5: Add the wizard + update the TtsWorkspace render**

Compute derived values before the return:

```tsx
  const currentVoiceName =
    selectedCustomVoice?.name ?? STOCK_VOICES.find((voice) => voice.id === stockVoice)?.name ?? stockVoice;
```

In the return, update the `<TtsWorkspace … />` props. Replace the existing prop list with:

```tsx
    <TtsWorkspace
      text={text}
      onTextChange={setText}
      modelInfo={modelInfo}
      variant={variant}
      loading={loading}
      generating={generating}
      status={status}
      progress={progress}
      chunkCount={chunkCount}
      streamedSec={streamedSec}
      elapsedSec={elapsedSec}
      streamPlaying={streamPlaying}
      onToggleStreamPlayback={toggleStreamPlayback}
      voiceId={voiceId}
      stockVoice={stockVoice}
      voiceOpen={voiceOpen}
      onVoiceOpenChange={setVoiceOpen}
      voiceSearch={voiceSearch}
      onVoiceSearchChange={setVoiceSearch}
      onLoadVoice={(spec) => void loadVoice(spec)}
      customVoices={customVoices}
      selectedCustomVoiceId={selectedCustomVoice?.id ?? null}
      onSelectCustomVoice={(id) => void loadCustomVoice(id)}
      onCloneVoice={() => setWizardOpen(true)}
      onRenameVoice={(id, name) => void handleRenameVoice(id, name)}
      onDeleteVoice={(id) => void handleDeleteVoice(id)}
      wizardOpen={wizardOpen}
      onWizardOpenChange={setWizardOpen}
      currentVoiceName={currentVoiceName}
      onGenerate={() => void generate()}
      onStopGeneration={stopGeneration}
      history={history}
      currentClip={currentClip}
      generatedAudioSrc={generatedAudioSrc}
      onReplay={(record) => void replay(record)}
      onDownload={(record) => void download(record)}
      onEdit={(record) => void handleEdit(record)}
      onDeleteHistory={(record) => void handleDeleteHistory(record)}
      generationSettings={generationSettings}
      hasPendingSettings={hasPendingSettings}
      onGenerationSettingsChange={setGenerationSettings}
      onReloadModel={() => void loadModel(generationSettings)}
      onResetGenerationSettings={() => setGenerationSettings(DEFAULT_GENERATION_SETTINGS)}
      onInsertPause={() => setText((value) => `${value}${value.endsWith(" ") ? "" : " "}[pause:500ms] `)}
    />
```

Then, inside the same return root element (the fragment/`<main>`), render the wizard:

```tsx
    <VoiceCloneWizard
      open={wizardOpen}
      onOpenChange={setWizardOpen}
      onCloned={(voice) => void handleCloned(voice)}
    />
```

Place it inside the returned JSX tree (e.g., right before the closing tag of the outer element, next to `TtsWorkspace`).

- [ ] **Step 6: Verify types compile**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 7: Verify Rust end-to-end**

Run: `cargo check -p warble --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(frontend): wire clone wizard + persisted history into app"
```

---

### Task 9: End-to-end verification

**Files:** none (manual testing).

- [ ] **Step 1: Run the app**

Run: `pnpm tauri dev`
Expected: window opens, model loads, history panel shows any previously saved generations.

- [ ] **Step 2: Clone from a file**

Open the voice library → “Clone a voice” → Upload file → pick a `.wav`. Preview plays. Next → name it → Clone voice. Success card appears → “Use this voice”. Verify the picker now shows the custom voice selected and the engine generates speech with it.

- [ ] **Step 3: Clone from a non-WAV file**

Repeat with an `.mp3` (or `.m4a`). Verify it decodes and clones successfully (browser decode → WAV).

- [ ] **Step 4: Clone from a recording**

“Clone a voice” → Record → Start/Stop → the source preview shows “Microphone recording” → name + clone. (If `getUserMedia` is denied by the webview, verify the inline “Microphone access denied” message appears and the wizard stays usable.)

- [ ] **Step 5: Restart persistence**

Quit and relaunch `pnpm tauri dev`. Verify the cloned voice(s) are still in the library and selectable. Verify history rows persist and replay.

- [ ] **Step 6: History edit + delete**

From history, press the pencil → the text is loaded into the composer. Generate again → a new row is created. Press the trash on a row → it disappears and the WAV file is removed from `history/`.

- [ ] **Step 7: Voice rename/delete**

Rename a custom voice in the library → the name updates. Delete it → removed from the list and `voices/<id>/` is removed from disk.

- [ ] **Step 8: Final build gates**

Run: `pnpm build` and `cargo check -p warble --manifest-path src-tauri/Cargo.toml`
Expected: both PASS.
