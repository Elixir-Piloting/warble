//! Tauri commands wrapping the vendored `pocket-tts` engine.
//!
//! Heavy work (model load, voice encoding, generation) runs on the Tauri
//! async runtime via `spawn_blocking` so the IPC/main thread never blocks.
//!
//! Audio is streamed to the frontend as events:
//!
//! | Event             | Payload                                |
//! |-------------------|----------------------------------------|
//! | `tts://chunk`     | `TtsChunkPayload` (PCM i16 LE bytes)   |
//! | `tts://done`      | `TtsDonePayload`                       |
//! | `tts://error`     | `TtsErrorPayload`                      |
//!
//! Events use a `tts://` prefix matching the `tauri://` style used elsewhere
//! in the app for streamed / progress notifications.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use pocket_tts::{ModelState, TTSModel};
use candle_core::Device;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::store::{NewHistory, Store};

/// Namespace for all TTS events emitted to the frontend.
const EVENT_PREFIX: &str = "tts://";

/// Shared engine state managed by Tauri.
#[derive(Default)]
pub struct TtsState {
    pub(crate) model: Mutex<Option<TTSModel>>,
    voices: Mutex<HashMap<String, ModelState>>,
    /// Set to true to cancel the currently-running generation before it
    /// persists a history row.
    cancel: Arc<AtomicBool>,
}

/// Monotonic id source for voice handles.
static NEXT_VOICE_ID: AtomicU64 = AtomicU64::new(0);

/// Stock voices from `kyutai/pocket-tts-without-voice-cloning`, resolved as
/// pre-computed embeddings (`.safetensors`) — public repo, no HF_TOKEN needed.
const PREDEFINED_VOICES: &[&str] = &[
    "alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma",
];
const STOCK_VOICE_REPO: &str = "kyutai/pocket-tts-without-voice-cloning";

/// Result of a successful model load.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsLoadResult {
    pub variant: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub quantized: bool,
    pub parameters: TtsGenerationSettings,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsGenerationSettings {
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_lsd_decode_steps")]
    pub lsd_decode_steps: usize,
    #[serde(default = "default_eos_threshold")]
    pub eos_threshold: f32,
    #[serde(default)]
    pub noise_clamp: Option<f32>,
    #[serde(default)]
    pub voice_prompt_chunk_frames: Option<usize>,
}

fn default_temperature() -> f32 { 0.7 }
fn default_lsd_decode_steps() -> usize { 1 }
fn default_eos_threshold() -> f32 { -4.0 }

impl Default for TtsGenerationSettings {
    fn default() -> Self {
        Self {
            temperature: default_temperature(),
            lsd_decode_steps: default_lsd_decode_steps(),
            eos_threshold: default_eos_threshold(),
            noise_clamp: None,
            voice_prompt_chunk_frames: None,
        }
    }
}

/// One streamed chunk of generated audio.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsChunkPayload {
    pub voice_id: String,
    pub index: u32,
    pub sample_rate: u32,
    pub channels: u16,
    /// Little-endian i16 PCM samples (channel-interleaved).
    pub pcm: Vec<u8>,
}

/// Emitted once generation for a request completes.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsDonePayload {
    pub voice_id: String,
    pub total_chunks: u32,
    pub sample_rate: u32,
}

/// Emitted when a running generation fails partway through.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsErrorPayload {
    pub voice_id: String,
    pub message: String,
}

fn emit<E: Serialize + Clone>(app: &AppHandle, event: &str, payload: E) {
    let _ = app.emit(&format!("{EVENT_PREFIX}{event}"), payload);
}

/// Append an actionable hint when Hugging Face rejects the download (gated repo).
fn hf_auth_hint(msg: &str) -> String {
    if msg.contains("401") || msg.contains("403") {
        format!(
            "{msg}\n\nHugging Face denied access (401/403). kyutai/pocket-tts is \
             gated: accept its terms at https://huggingface.co/kyutai/pocket-tts, \
             create a Read token, then set HF_TOKEN in the shell that launches \
             `pnpm tauri dev` and retry."
        )
    } else {
        msg.to_string()
    }
}

/// Load the model for `variant` (e.g. `b6369a24`) and cache it in state.
///
/// Weights are fetched from Hugging Face Hub via hf-hub on first load
/// (`crates/pocket-tts/src/weights.rs` / `download_if_necessary`); hf-hub
/// caches them under `~/.cache/huggingface`. The `kyutai/pocket-tts` repo is
/// gated, so set `HF_TOKEN` if the requested variant requires it.
///
/// TODO(backend): hook a "download on first launch" UX here. A good place is
/// to call `crate::weights::download_if_necessary` on the config's
/// `weights_path` + `tokenizer_path` ahead of `TTSModel::load*` and emit a
/// `tts://downloading` progress event from this command.
#[tauri::command]
pub async fn load_tts_model(
    app: AppHandle,
    state: State<'_, TtsState>,
    variant: String,
    settings: TtsGenerationSettings,
) -> Result<TtsLoadResult, String> {
    let variant = if variant.trim().is_empty() {
        "b6369a24".to_string()
    } else {
        variant
    };

    let tts_variant = variant.clone();
    let settings = TtsGenerationSettings {
        temperature: settings.temperature.clamp(0.05, 2.0),
        lsd_decode_steps: settings.lsd_decode_steps.clamp(1, 8),
        eos_threshold: settings.eos_threshold.clamp(-12.0, 0.0),
        noise_clamp: settings.noise_clamp.map(|value| value.max(0.0)),
        voice_prompt_chunk_frames: settings.voice_prompt_chunk_frames.filter(|value| *value > 0),
    };
    let settings_for_model = settings.clone();
    let model = tauri::async_runtime::spawn_blocking(move || -> Result<TTSModel, String> {
        // int8-equivalent quantization (enabled via the "quantized" feature).
        let mut model = TTSModel::load_quantized_with_params_device(
            &tts_variant,
            settings_for_model.temperature,
            settings_for_model.lsd_decode_steps,
            settings_for_model.eos_threshold,
            settings_for_model.noise_clamp,
            &Device::Cpu,
        ).map_err(|e| hf_auth_hint(&format!("pocket-tts load failed: {e}")))?;
        model.voice_prompt_chunk_frames = settings_for_model.voice_prompt_chunk_frames;
        Ok(model)
    })
    .await
    .map_err(|e| format!("load task panicked: {e}"))??;

    let result = TtsLoadResult {
        variant: variant.clone(),
        sample_rate: model.sample_rate as u32,
        channels: model.mimi.channels as u16,
        quantized: model.is_quantized(),
        parameters: settings,
    };

    let mut guard = state
        .model
        .lock()
        .map_err(|_| "model lock poisoned".to_string())?;
    *guard = Some(model);

    emit(&app, "model-loaded", result.clone());
    Ok(result)
}

/// Resolve a voice spec to a voice state, mirroring the upstream CLI's
/// `voice.rs` logic.
///
/// Supported specs:
/// - Predefined name: `alba`, `marius`, `javert`, `jean`, `fantine`,
///   `cosette`, `eponine`, `azelma` (stock voices, downloaded from HF)
/// - HF URL: `hf://owner/repo/file.wav` (or `.safetensors`)
/// - Local path: a `.wav` (encoded through Mimi) or pre-computed
///   `.safetensors` embeddings
fn resolve_voice_state(model: &TTSModel, spec: &str) -> Result<ModelState, String> {
    let spec = spec.trim();

    if PREDEFINED_VOICES.contains(&spec) {
        let url = format!("hf://{STOCK_VOICE_REPO}/embeddings/{spec}.safetensors");
        let path = pocket_tts::weights::download_if_necessary(&url)
            .map_err(|e| format!("failed to download stock voice '{spec}': {e}"))?;
        return model
            .get_voice_state_from_prompt_file(&path)
            .map_err(|e| format!("failed to load stock voice '{spec}': {e}"));
    }

    let path = if spec.starts_with("hf://") {
        pocket_tts::weights::download_if_necessary(spec)
            .map_err(|e| format!("failed to download voice from '{spec}': {e}"))?
    } else {
        std::path::PathBuf::from(spec)
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "safetensors" => model
            .get_voice_state_from_prompt_file(path)
            .map_err(|e| format!("failed to load voice embeddings '{spec}': {e}")),
        "wav" | "wave" => model
            .get_voice_state(path)
            .map_err(|e| format!("failed to process voice audio '{spec}': {e}")),
        _ => Err(format!(
            "voice '{spec}' not recognized. Use a stock name ({}), an hf:// URL, \
             or a local .wav / .safetensors path",
            PREDEFINED_VOICES.join(", ")
        )),
    }
}

/// Encode a voice spec into a voice state and return its handle.
///
/// The handle is passed back to `generate_tts_stream` as `voice_id`.
/// See [`resolve_voice_state`] for the accepted spec formats.
#[tauri::command]
pub async fn get_tts_voice_state(
    state: State<'_, TtsState>,
    voice_spec: String,
) -> Result<String, String> {
    let model = state
        .model
        .lock()
        .map_err(|_| "model lock poisoned".to_string())?
        .as_ref()
        .ok_or("no model loaded; call load_tts_model first")?
        .clone();

    let spec_out = voice_spec.clone();
    let voice_state =
        tauri::async_runtime::spawn_blocking(move || -> Result<ModelState, String> {
            resolve_voice_state(&model, &spec_out)
        })
        .await
        .map_err(|e| format!("voice task panicked: {e}"))??;

    let voice_id = NEXT_VOICE_ID.fetch_add(1, Ordering::Relaxed);
    let voice_id = format!("voice-{voice_id}");

    let mut voices = state
        .voices
        .lock()
        .map_err(|_| "voices lock poisoned".to_string())?;
    voices.insert(voice_id.clone(), voice_state);

    Ok(voice_id)
}

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

    state.cancel.store(false, Ordering::Relaxed);
    let cancel = state.cancel.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut index: u32 = 0;
        let mut pcm_accum: Vec<u8> = Vec::new();

        let mut cancelled = false;
        for chunk in model.generate_stream(&text, &voice_state) {
            if cancel.load(Ordering::Relaxed) {
                cancelled = true;
                break;
            }
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

        if cancelled {
            return Ok(index);
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

/// Signal the running generation (if any) to stop; it will not persist a
/// history row.
#[tauri::command]
pub fn cancel_generation(state: State<'_, TtsState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::Relaxed);
    Ok(())
}
