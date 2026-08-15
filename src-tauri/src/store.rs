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
use tauri::State;

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
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
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
    let store_for_task = store.clone();

    let id = tauri::async_runtime::spawn_blocking(move || -> Result<i64, String> {
        let store = store_for_task;
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
