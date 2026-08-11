import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { TtsWorkspace } from "@/components/tts-workspace";
import { audioBuffersToWavBlob } from "@/lib/pcm";
import { StreamPlayer } from "@/lib/streamPlayer";

interface TtsLoadResult { variant: string; sampleRate: number; channels: number; quantized: boolean }
interface GenerationSettings { temperature: number; lsdDecodeSteps: number; eosThreshold: number; noiseClamp: number | null; voicePromptChunkFrames: number | null }
interface TtsChunkPayload { voiceId: string; index: number; sampleRate: number; channels: number; pcm: number[] }
interface TtsDonePayload { voiceId: string; totalChunks: number; sampleRate: number }
interface TtsErrorPayload { voiceId: string; message: string }
interface HistoryEntry { id: number; name: string; createdAt: number; charCount: number; chunkCount: number; speechSec: number; elapsedSec: number; sampleRate: number; channels: number; buffers: AudioBuffer[] }
type Phase = "idle" | "loading" | "loaded" | "generating" | "done" | "error";
const DEFAULT_GENERATION_SETTINGS: GenerationSettings = { temperature: 0.7, lsdDecodeSteps: 1, eosThreshold: -4, noiseClamp: null, voicePromptChunkFrames: null };

export default function App() {
  const variant = "b6369a24";
  const [modelInfo, setModelInfo] = useState<TtsLoadResult | null>(null);
  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS);
  const [appliedGenerationSettings, setAppliedGenerationSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS);
  const [stockVoice, setStockVoice] = useState("alba");
  const [voiceSpec, setVoiceSpec] = useState("");
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [text, setText] = useState("Hello! This is a test of the built in text to speech engine.");
  const [phase, setPhase] = useState<Phase>("idle");
  const [chunkCount, setChunkCount] = useState(0);
  const [streamedSec, setStreamedSec] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
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
  const historyIdRef = useRef(0);
  const lastMetaRef = useRef<Pick<HistoryEntry, "sampleRate" | "channels"> | null>(null);
  const getPlayer = useCallback(() => playerRef.current ?? (playerRef.current = new StreamPlayer()), []);
  const clearTimer = useCallback(() => { if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; } }, []);

  const handleChunk = useCallback((payload: TtsChunkPayload) => {
    if (streamIdRef.current !== activeGenRef.current) return;
    const player = getPlayer();
    const buffer = player.decodeChunk(payload.pcm, payload.sampleRate, payload.channels);
    buffersRef.current.push(buffer);
    lastMetaRef.current = { sampleRate: payload.sampleRate, channels: payload.channels };
    setStreamedSec((seconds) => seconds + player.enqueue(buffer));
    setChunkCount(payload.index + 1);
    setStreamPlaying(player.playing);
  }, [getPlayer]);

  const handleDone = useCallback((payload: TtsDonePayload) => {
    if (streamIdRef.current !== activeGenRef.current) return;
    const live = getPlayer();
    const total = live.streamedSeconds;
    live.stop();
    clearTimer();
    const elapsed = (performance.now() - t0Ref.current) / 1000;
    const meta = lastMetaRef.current ?? { sampleRate: payload.sampleRate, channels: 1 };
    const entry: HistoryEntry = { id: ++historyIdRef.current, name: genMetaRef.current?.name ?? "Untitled generation", createdAt: Date.now(), charCount: genMetaRef.current?.charCount ?? 0, chunkCount: payload.totalChunks, speechSec: total, elapsedSec: elapsed, sampleRate: meta.sampleRate, channels: meta.channels, buffers: buffersRef.current };
    setHistory((items) => [entry, ...items].slice(0, 20));
    setElapsedSec(elapsed);
    setPhase("done");
    setStatus("Generation complete");
    setCurrentClip(entry);
    setStreamPlaying(false);
  }, [clearTimer, getPlayer]);

  const handleError = useCallback((payload: TtsErrorPayload) => {
    if (streamIdRef.current === activeGenRef.current) { setPhase("error"); setStatus(payload.message); }
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(await listen<TtsChunkPayload>("tts://chunk", (event) => active && handleChunk(event.payload)));
      unlisteners.push(await listen<TtsDonePayload>("tts://done", (event) => active && handleDone(event.payload)));
      unlisteners.push(await listen<TtsErrorPayload>("tts://error", (event) => active && handleError(event.payload)));
    })();
    return () => { active = false; unlisteners.forEach((unlisten) => unlisten()); };
  }, [handleChunk, handleDone, handleError]);

  const loadModel = useCallback(async (settings: GenerationSettings = DEFAULT_GENERATION_SETTINGS) => {
    setPhase("loading");
    setStatus("Loading the local model…");
    try { const info = await invoke<TtsLoadResult>("load_tts_model", { variant, settings }); setModelInfo(info); setAppliedGenerationSettings(settings); setPhase("loaded"); setStatus("Model ready"); }
    catch (error) { setPhase("error"); setStatus(String(error)); }
  }, []);
  useEffect(() => { void loadModel(DEFAULT_GENERATION_SETTINGS); }, [loadModel]);

  async function loadVoice(spec = voiceSpec.trim() || stockVoice) {
    if (!modelInfo) { setStatus("The model is still loading."); return; }
    setPhase("loading");
    setStatus(`Loading ${spec}…`);
    try { const id = await invoke<string>("get_tts_voice_state", { voiceSpec: spec }); setVoiceId(id); setStockVoice(spec); setPhase("loaded"); setStatus(`${spec} is ready`); setVoiceOpen(false); }
    catch (error) { setPhase("error"); setStatus(String(error)); }
  }

  async function generate() {
    if (!voiceId) { setVoiceOpen(true); setStatus("Choose a voice to continue."); return; }
    getPlayer().begin();
    buffersRef.current = [];
    genMetaRef.current = { charCount: text.length, name: titleFromText(text) };
    lastMetaRef.current = null;
    activeGenRef.current = ++streamIdRef.current;
    t0Ref.current = performance.now();
    setPhase("generating"); setChunkCount(0); setStreamedSec(0); setElapsedSec(0); setStreamPlaying(false); setStatus("Generating audio…");
    clearTimer();
    timerRef.current = window.setInterval(() => setElapsedSec((performance.now() - t0Ref.current) / 1000), 250);
    try { await invoke<number>("generate_tts_stream", { text, voiceId }); }
    catch (error) { clearTimer(); setPhase("error"); setStatus(String(error)); }
  }

  function stopGeneration() { streamIdRef.current += 1; getPlayer().stop(); buffersRef.current = []; clearTimer(); setPhase("idle"); setChunkCount(0); setStreamedSec(0); setStreamPlaying(false); setStatus("Generation stopped"); }
  function toggleStreamPlayback() { const player = getPlayer(); if (player.playing) { player.pause(); setStreamPlaying(false); } else { player.resume(); setStreamPlaying(player.playing); } }
  function replay(entry: HistoryEntry) { setCurrentClip(entry); setStatus(`Loaded ${entry.name}`); }
  async function download(entry: HistoryEntry) { try { const blob = audioBuffersToWavBlob(entry.buffers, entry.sampleRate, entry.channels); const path = await save({ defaultPath: `warble-${entry.id}.wav`, filters: [{ name: "WAV audio", extensions: ["wav"] }] }); if (path) { await writeFile(path, new Uint8Array(await blob.arrayBuffer())); setStatus(`Saved ${path}`); } } catch (error) { setPhase("error"); setStatus(String(error)); } }
  useEffect(() => {
    if (!currentClip) { setGeneratedAudioSrc(null); return; }
    const url = URL.createObjectURL(audioBuffersToWavBlob(currentClip.buffers, currentClip.sampleRate, currentClip.channels));
    setGeneratedAudioSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [currentClip]);

  const generating = phase === "generating";
  const loading = phase === "loading";
  const progress = generating ? Math.min(99, (streamedSec / Math.max(0.5, text.length / 15)) * 100) : phase === "done" ? 100 : 0;
  const hasPendingSettings = JSON.stringify(generationSettings) !== JSON.stringify(appliedGenerationSettings);

  return <TtsWorkspace text={text} onTextChange={setText} modelInfo={modelInfo} variant={variant} loading={loading} generating={generating} status={status} progress={progress} chunkCount={chunkCount} streamedSec={streamedSec} elapsedSec={elapsedSec} streamPlaying={streamPlaying} onToggleStreamPlayback={toggleStreamPlayback} voiceId={voiceId} stockVoice={stockVoice} voiceOpen={voiceOpen} onVoiceOpenChange={setVoiceOpen} voiceSearch={voiceSearch} onVoiceSearchChange={setVoiceSearch} voiceSpec={voiceSpec} onVoiceSpecChange={setVoiceSpec} onLoadVoice={(spec) => void loadVoice(spec)} onGenerate={() => void generate()} onStopGeneration={stopGeneration} history={history} currentClip={currentClip} generatedAudioSrc={generatedAudioSrc} onReplay={replay} onDownload={(entry) => void download(entry)} generationSettings={generationSettings} hasPendingSettings={hasPendingSettings} onGenerationSettingsChange={setGenerationSettings} onReloadModel={() => void loadModel(generationSettings)} onResetGenerationSettings={() => setGenerationSettings(DEFAULT_GENERATION_SETTINGS)} onInsertPause={() => setText((value) => `${value}${value.endsWith(" ") ? "" : " "}[pause:500ms] `)} />; /*
    <header className="flex items-center justify-between border-b border-border pb-5"><div className="flex items-center gap-3"><div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Waves className="size-4" /></div><span className="text-lg font-semibold tracking-[-0.04em]">warble</span><span className="hidden text-xs text-muted-foreground md:inline">LOCAL VOICE STUDIO</span></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`size-1.5 rounded-full ${modelInfo ? "bg-primary" : "bg-muted-foreground"}`} />{loading ? "Preparing model" : modelInfo ? "Model online" : "Connecting"}</div></header>
    <div className="grid flex-1 gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_330px]"><section className="min-w-0"><div className="mb-9"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Text to speech</p><h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-[-0.06em] md:text-6xl">Give your words<br /><span className="text-muted-foreground">a point of view.</span></h1></div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[.16em] text-muted-foreground"><Activity /> Writing canvas</div><span className="text-xs tabular-nums text-muted-foreground">{text.length} characters</span></div><Textarea value={text} onChange={(event) => setText(event.currentTarget.value)} className="min-h-[280px] resize-none rounded-none border-0 bg-transparent px-5 py-6 text-xl leading-relaxed shadow-none focus-visible:ring-0 md:min-h-[340px] md:text-2xl" placeholder="Start writing…" /><div className="flex flex-col gap-4 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><VoicePickerDialog open={voiceOpen} onOpenChange={setVoiceOpen} selectedId={selectedVoice.id} hasVoice={Boolean(voiceId)} search={voiceSearch} onSearchChange={setVoiceSearch} onLoad={(spec) => void loadVoice(spec)} customVoice={voiceSpec} onCustomVoiceChange={setVoiceSpec} loading={loading} variant={variant} /><div className="flex items-center gap-2"><Badge variant="outline" className="hidden sm:inline-flex">⌘ ↵</Badge><Button onClick={() => void generate()} disabled={generating || loading}>{generating ? <><LoaderCircle className="animate-spin" /> Generating</> : <><Sparkles /> Generate</> }</Button>{generating && <Button variant="outline" size="icon" onClick={stopGeneration}><Square /></Button>}</div></div></div>
      <div className="mt-6 rounded-2xl border border-border bg-card p-5"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[.16em] text-muted-foreground"><AudioLines /> Output</div><span className="text-xs text-muted-foreground">{status}</span></div><OutputWaveform active={generating} progress={progress} /><div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{chunkCount ? `${chunkCount} chunks · ${streamedSec.toFixed(2)}s audio` : "Your generated audio will appear here"}</span><span>{elapsedSec.toFixed(2)}s</span></div></div><div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><Radio className="text-primary" /> Streaming locally · {modelInfo ? `${modelInfo.sampleRate} Hz · ${modelInfo.channels} channel` : "initializing model"}</div>
    </section><aside className="flex flex-col gap-6 lg:border-l lg:border-border lg:pl-8"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Workspace</p><h2 className="mt-2 text-xl font-medium tracking-[-.03em]">Recent generations</h2></div>{history.length === 0 ? <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center"><Clock3 className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">Nothing here yet</p><p className="mt-1 text-xs text-muted-foreground">Generate a clip to build your history.</p></div> : <div className="flex flex-col gap-2">{history.map((entry) => <HistoryItem key={entry.id} id={entry.id} chars={entry.charCount} duration={entry.speechSec} active={currentClip?.id === entry.id} onPlay={() => replay(entry)} onDownload={() => void download(entry)} disabled={generating} />)}</div>}<div className="mt-auto hidden items-center gap-2 pt-8 text-xs text-muted-foreground lg:flex"><Volume2 /> Local playback engine</div></aside></div>
    {currentClip && <AudioDock entry={currentClip} time={clipTime} playing={clipPlaying} onToggle={togglePlayback} onStop={stopPlayback} onSeek={seek} onClose={() => setCurrentClip(null)} />}
  </div></main>; */
}

function titleFromText(value: string) {
  const words = value.replace(/\[pause:[^\]]+\]/gi, "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return words.length ? words.join(" ") : "Untitled generation";
}
