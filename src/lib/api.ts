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
