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

interface TtsLoadResult {
  variant: string;
  sampleRate: number;
  channels: number;
  quantized: boolean;
}
interface GenerationSettings {
  temperature: number;
  lsdDecodeSteps: number;
  eosThreshold: number;
  noiseClamp: number | null;
  voicePromptChunkFrames: number | null;
}
interface TtsChunkPayload {
  voiceId: string;
  index: number;
  sampleRate: number;
  channels: number;
  pcm: number[];
}
interface TtsDonePayload {
  voiceId: string;
  totalChunks: number;
  sampleRate: number;
}
interface TtsErrorPayload {
  voiceId: string;
  message: string;
}
interface HistoryEntry {
  id: number;
  name: string;
  createdAt: number;
  charCount: number;
  chunkCount: number;
  speechSec: number;
  elapsedSec: number;
  sampleRate: number;
  channels: number;
  buffers: AudioBuffer[];
}
type Phase = "idle" | "loading" | "loaded" | "generating" | "stopping" | "done" | "error";
const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  temperature: 0.7,
  lsdDecodeSteps: 1,
  eosThreshold: -4,
  noiseClamp: null,
  voicePromptChunkFrames: null,
};

export default function App() {
  const variant = "b6369a24";
  const [modelInfo, setModelInfo] = useState<TtsLoadResult | null>(null);
  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS);
  const [appliedGenerationSettings, setAppliedGenerationSettings] =
    useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS);
  const [stockVoice, setStockVoice] = useState("alba");
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [text, setText] = useState("Hello! This is a test of the built in text to speech engine.");
  const [phase, setPhase] = useState<Phase>("idle");
  const [chunkCount, setChunkCount] = useState(0);
  const [streamedSec, setStreamedSec] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [customVoices, setCustomVoices] = useState<VoiceRecord[]>([]);
  const [selectedCustomVoice, setSelectedCustomVoice] = useState<VoiceRecord | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [status, setStatus] = useState("Ready to create");
  const [currentClip, setCurrentClip] = useState<HistoryEntry | null>(null);
  const [generatedAudioSrc, setGeneratedAudioSrc] = useState<string | null>(null);
  const [streamPlaying, setStreamPlaying] = useState(false);
  const playerRef = useRef<StreamPlayer | null>(null);
  const buffersRef = useRef<AudioBuffer[]>([]);
  const genMetaRef = useRef<{ charCount: number; name: string } | null>(null);
  const t0Ref = useRef(0);
  const streamIdRef = useRef(0);
  const activeGenRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const wasStoppingRef = useRef(false);
  const historyIdRef = useRef(0);
  const lastMetaRef = useRef<Pick<HistoryEntry, "sampleRate" | "channels"> | null>(null);
  const getPlayer = useCallback(() => playerRef.current ?? (playerRef.current = new StreamPlayer()), []);
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

  useEffect(() => {
    void refreshVoices();
    void refreshHistory();
  }, [refreshVoices, refreshHistory]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleChunk = useCallback(
    (payload: TtsChunkPayload) => {
      if (streamIdRef.current !== activeGenRef.current) return;
      const player = getPlayer();
      const buffer = player.decodeChunk(payload.pcm, payload.sampleRate, payload.channels);
      buffersRef.current.push(buffer);
      lastMetaRef.current = { sampleRate: payload.sampleRate, channels: payload.channels };
      setStreamedSec((seconds) => seconds + player.enqueue(buffer));
      setChunkCount(payload.index + 1);
      setStreamPlaying(player.playing);
    },
    [getPlayer, refreshHistory]
  );

  const handleDone = useCallback(
    (payload: TtsDonePayload) => {
      if (streamIdRef.current !== activeGenRef.current) return;
      const live = getPlayer();
      const total = live.streamedSeconds;
      live.stop();
      clearTimer();
      const elapsed = (performance.now() - t0Ref.current) / 1000;
      const meta = lastMetaRef.current ?? { sampleRate: payload.sampleRate, channels: 1 };
      const entry: HistoryEntry = {
        id: ++historyIdRef.current,
        name: genMetaRef.current?.name ?? "Untitled generation",
        createdAt: Date.now(),
        charCount: genMetaRef.current?.charCount ?? 0,
        chunkCount: payload.totalChunks,
        speechSec: total,
        elapsedSec: elapsed,
        sampleRate: meta.sampleRate,
        channels: meta.channels,
        buffers: buffersRef.current,
      };
      void refreshHistory();
      setElapsedSec(elapsed);
      setPhase("done");
      setStatus("Generation complete");
      setCurrentClip(entry);
      setStreamPlaying(false);
    },
    [clearTimer, getPlayer, refreshHistory]
  );

  const handleError = useCallback((payload: TtsErrorPayload) => {
    if (streamIdRef.current === activeGenRef.current) {
      setPhase("error");
      setStatus(payload.message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(await listen<TtsChunkPayload>("tts://chunk", (event) => active && handleChunk(event.payload)));
      unlisteners.push(await listen<TtsDonePayload>("tts://done", (event) => active && handleDone(event.payload)));
      unlisteners.push(await listen<TtsErrorPayload>("tts://error", (event) => active && handleError(event.payload)));
    })();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [handleChunk, handleDone, handleError]);

  const loadModel = useCallback(async (settings: GenerationSettings = DEFAULT_GENERATION_SETTINGS) => {
    setPhase("loading");
    setStatus("Loading the local model…");
    try {
      const info = await invoke<TtsLoadResult>("load_tts_model", { variant, settings });
      setModelInfo(info);
      setAppliedGenerationSettings(settings);
      setPhase("loaded");
      setStatus("Model ready");
    } catch (error) {
      setPhase("error");
      setStatus(String(error));
    }
  }, []);
  useEffect(() => {
    void loadModel(DEFAULT_GENERATION_SETTINGS);
  }, [loadModel]);

  async function loadVoice(spec = stockVoice) {
    if (!modelInfo) {
      setStatus("The model is still loading.");
      return;
    }
    setPhase("loading");
    setStatus(`Loading ${spec}…`);
    try {
      const id = await invoke<string>("get_tts_voice_state", { voiceSpec: spec });
      setVoiceId(id);
      setSelectedCustomVoice(null);
      setStockVoice(spec);
      setPhase("loaded");
      setStatus(`${spec} is ready`);
      setVoiceOpen(false);
    } catch (error) {
      setPhase("error");
      setStatus(String(error));
    }
  }

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
      setSelectedCustomVoice((v) => (v && v.id === id ? { ...v, name } : v));
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

  async function generate() {
    if (!voiceId) {
      setVoiceOpen(true);
      setStatus("Choose a voice to continue.");
      return;
    }
    getPlayer().begin();
    buffersRef.current = [];
    genMetaRef.current = { charCount: text.length, name: titleFromText(text) };
    lastMetaRef.current = null;
    activeGenRef.current = ++streamIdRef.current;
    t0Ref.current = performance.now();
    setPhase("generating");
    setChunkCount(0);
    setStreamedSec(0);
    setElapsedSec(0);
    setStreamPlaying(false);
    setStatus("Generating audio…");
    clearTimer();
    timerRef.current = window.setInterval(() => setElapsedSec((performance.now() - t0Ref.current) / 1000), 250);
    try {
      await invoke<number>("generate_tts_stream", {
        text,
        voiceId,
        name: genMetaRef.current?.name ?? "Untitled generation",
        voiceLabel: currentVoiceName,
      });
    } catch (error) {
      clearTimer();
      setPhase("error");
      setStatus(String(error));
    } finally {
      if (wasStoppingRef.current) {
        wasStoppingRef.current = false;
        setPhase("idle");
        setStatus("Generation stopped");
      }
    }
  }

  function stopGeneration() {
    streamIdRef.current += 1;
    getPlayer().stop();
    buffersRef.current = [];
    clearTimer();
    wasStoppingRef.current = true;
    setPhase("stopping");
    setChunkCount(0);
    setStreamedSec(0);
    setStreamPlaying(false);
    setStatus("Stopping generation…");
    void invoke("cancel_generation");
  }
  function toggleStreamPlayback() {
    const player = getPlayer();
    if (player.playing) {
      player.pause();
      setStreamPlaying(false);
    } else {
      player.resume();
      setStreamPlaying(player.playing);
    }
  }
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
  async function downloadClip(entry: HistoryEntry) {
    try {
      const blob = audioBuffersToWavBlob(entry.buffers, entry.sampleRate, entry.channels);
      const path = await save({
        defaultPath: `warble-${entry.id}.wav`,
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
  useEffect(() => {
    if (!currentClip) {
      setGeneratedAudioSrc(null);
      return;
    }
    const url = URL.createObjectURL(
      audioBuffersToWavBlob(currentClip.buffers, currentClip.sampleRate, currentClip.channels)
    );
    setGeneratedAudioSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [currentClip]);

  const generating = phase === "generating" || phase === "stopping";
  const loading = phase === "loading";
  const progress = generating
    ? Math.min(99, (streamedSec / Math.max(0.5, text.length / 15)) * 100)
    : phase === "done"
      ? 100
      : 0;
  const hasPendingSettings = JSON.stringify(generationSettings) !== JSON.stringify(appliedGenerationSettings);
  const currentVoiceName =
    selectedCustomVoice?.name ?? STOCK_VOICES.find((voice) => voice.id === stockVoice)?.name ?? stockVoice;

  return (
    <>
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
        currentVoiceName={currentVoiceName}
        onGenerate={() => void generate()}
        onStopGeneration={stopGeneration}
        history={history}
        currentClip={currentClip}
        generatedAudioSrc={generatedAudioSrc}
        onReplay={(record) => void replay(record)}
        onDownload={(record) => void download(record)}
        onDownloadClip={(entry) => void downloadClip(entry)}
        onEdit={(record) => void handleEdit(record)}
        onDeleteHistory={(record) => void handleDeleteHistory(record)}
        generationSettings={generationSettings}
        hasPendingSettings={hasPendingSettings}
        onGenerationSettingsChange={setGenerationSettings}
        onReloadModel={() => void loadModel(generationSettings)}
        onResetGenerationSettings={() => setGenerationSettings(DEFAULT_GENERATION_SETTINGS)}
        onInsertPause={() => setText((value) => `${value}${value.endsWith(" ") ? "" : " "}[pause:500ms] `)}
      />
      <VoiceCloneWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCloned={(voice) => void handleCloned(voice)}
      />
    </>
  );
}

function titleFromText(value: string) {
  const words = value
    .replace(/\[pause:[^\]]+\]/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return words.length ? words.join(" ") : "Untitled generation";
}

async function decodeHistoryAudio(record: HistoryRecord): Promise<HistoryEntry> {
  const bytes = await getHistoryAudio(record.id);
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(bytes);
  await ctx.close().catch(() => {});
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    charCount: record.charCount ?? 0,
    chunkCount: record.chunkCount ?? 0,
    speechSec: record.speechSec ?? 0,
    elapsedSec: record.elapsedSec ?? 0,
    sampleRate: decoded.sampleRate,
    channels: decoded.numberOfChannels,
    buffers: [decoded],
  };
}
