import { useMemo, useState } from "react";
import { Download, FileAudio, Gauge, History, LoaderCircle, Pause, Play, Search, Sparkles, Square } from "lucide-react";
import {
  AudioPlayerButton,
  AudioPlayerDuration,
  AudioPlayerProgress,
  AudioPlayerProvider,
  AudioPlayerSpeed,
  AudioPlayerTime,
} from "@/components/ui/audio-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { GenerationSettings, GenerationSettingsPanel } from "@/components/generation-settings";
import { HistoryItem } from "@/components/history-item";
import { STOCK_VOICES } from "@/components/voice-data";
import { VoicePickerDialog } from "@/components/voice-picker-dialog";
import type { HistoryRecord, VoiceRecord } from "@/lib/api";

interface ModelInfo {
  variant: string;
  sampleRate: number;
  channels: number;
  quantized: boolean;
}
interface HistoryEntry {
  id: number;
  name: string;
  createdAt: number;
  charCount: number;
  chunkCount: number;
  speechSec: number;
  elapsedSec: number;
  buffers: AudioBuffer[];
  sampleRate: number;
  channels: number;
}
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

function historyRecordFromEntry(entry: HistoryEntry): HistoryRecord {
  return {
    id: entry.id,
    name: entry.name,
    text: "",
    createdAt: entry.createdAt,
    charCount: entry.charCount,
    chunkCount: entry.chunkCount,
    speechSec: entry.speechSec,
    elapsedSec: entry.elapsedSec,
    sampleRate: entry.sampleRate,
    channels: entry.channels,
    wavPath: "",
    voiceLabel: null,
  };
}

export function TtsWorkspace(props: TtsWorkspaceProps) {
  const [rightTab, setRightTab] = useState<"settings" | "history">("history");
  const selectedVoice = STOCK_VOICES.find((voice) => voice.id === props.stockVoice) ?? STOCK_VOICES[0];
  const showTransport = Boolean(props.currentClip && props.generatedAudioSrc);

  return (
    <TooltipProvider>
      <div className="bg-background text-foreground h-screen overflow-hidden">
        <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_460px]">
          <main className="border-border grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] border-r">
            <section className="min-h-0 overflow-y-auto">
              <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-8 py-16 lg:px-16">
                <Textarea
                  value={props.text}
                  onChange={(event) => props.onTextChange(event.currentTarget.value)}
                  className="field-sizing-fixed min-h-[420px] flex-1 resize-none overflow-y-auto border-0 bg-transparent p-0 text-lg leading-8 shadow-none focus-visible:ring-0 md:text-xl"
                  placeholder="Write something to say…"
                />
                {props.generating && (
                  <LiveStreamBar
                    streamPlaying={props.streamPlaying}
                    elapsedSec={props.elapsedSec}
                    progress={props.progress}
                    onToggleStreamPlayback={props.onToggleStreamPlayback}
                  />
                )}
                <div className="mt-8 flex shrink-0 flex-wrap items-center justify-between gap-3">
                  <Button variant="ghost" size="sm" onClick={props.onInsertPause}>
                    Insert pause
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button onClick={props.onGenerate} disabled={props.generating || props.loading}>
                      {props.generating ? (
                        <>
                          <LoaderCircle className="animate-spin" /> Generating
                        </>
                      ) : (
                        <>
                          <Sparkles /> Generate speech
                        </>
                      )}
                    </Button>
                    {props.generating && (
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={props.onStopGeneration}
                        aria-label="Stop generation"
                      >
                        <Square />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </section>
            {showTransport && (
              <GeneratedAudioPlayer
                clip={props.currentClip!}
                src={props.generatedAudioSrc!}
                onDownload={(entry) => props.onDownload(historyRecordFromEntry(entry))}
              />
            )}
          </main>
          <aside className="min-h-0 overflow-hidden">
            {" "}
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-border flex shrink-0 gap-5 border-b px-5 pt-4">
                <TabButton active={rightTab === "settings"} onClick={() => setRightTab("settings")}>
                  Settings
                </TabButton>
                <TabButton active={rightTab === "history"} onClick={() => setRightTab("history")}>
                  History
                </TabButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {rightTab === "settings" ? (
                  <SettingsPanel {...props} selectedVoice={selectedVoice} />
                ) : (
                  <HistoryPanel {...props} />
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </TooltipProvider>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 pb-3 text-sm ${active ? "border-foreground font-medium" : "text-muted-foreground border-transparent"}`}
    >
      {children}
    </button>
  );
}

function GeneratedAudioPlayer({
  clip,
  src,
  onDownload,
}: {
  clip: HistoryEntry;
  src: string;
  onDownload: (entry: HistoryEntry) => void;
}) {
  const item = { id: clip.id, src };
  return (
    <AudioPlayerProvider>
      <footer className="border-border bg-background flex min-h-20 shrink-0 items-center gap-5 border-t px-5 py-3">
        <div className="min-w-0 flex-1 basis-0">
          <p className="truncate text-sm font-medium">{clip.name}</p>
          <p className="text-muted-foreground mt-1 text-xs">Local voice · {clip.speechSec.toFixed(2)} seconds</p>
        </div>
        <div className="flex w-full max-w-xl items-center gap-3">
          <AudioPlayerButton item={item} size="icon-lg" className="rounded-full" />
          <AudioPlayerTime />
          <AudioPlayerProgress className="min-w-20 flex-1" />
          <AudioPlayerDuration />
          <AudioPlayerSpeed size="icon-sm" />
        </div>
        <div className="flex flex-1 basis-0 justify-end">
          <Button variant="ghost" size="icon-sm" onClick={() => onDownload(clip)} aria-label="Download WAV">
            <Download />
          </Button>
        </div>
      </footer>
    </AudioPlayerProvider>
  );
}

function LiveStreamBar({
  streamPlaying,
  elapsedSec,
  progress,
  onToggleStreamPlayback,
}: {
  streamPlaying: boolean;
  elapsedSec: number;
  progress: number;
  onToggleStreamPlayback: () => void;
}) {
  return (
    <div className="border-border bg-card mt-8 flex shrink-0 items-center gap-4 rounded-xl border px-4 py-3">
      <Button
        size="icon"
        variant="outline"
        onClick={onToggleStreamPlayback}
        aria-label={streamPlaying ? "Pause live stream" : "Resume live stream"}
      >
        {streamPlaying ? <Pause /> : <Play />}
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-muted-foreground truncate text-xs font-medium">
            Live stream · {streamPlaying ? "playing" : "paused"}
          </p>
          <span className="text-muted-foreground text-xs tabular-nums">{elapsedSec.toFixed(1)}s</span>
        </div>
        <Progress value={progress} className="mt-2 h-1.5" />
      </div>
    </div>
  );
}

function SettingsPanel({ ...props }: TtsWorkspaceProps & { selectedVoice: (typeof STOCK_VOICES)[number] }) {
  return (
    <div className="flex flex-col gap-7 p-5">
      <section>
        <h2 className="text-sm font-medium">Voice</h2>
        <div className="border-border mt-3 rounded-lg border">
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
        </div>
      </section>
      <section>
        <h2 className="text-sm font-medium">Model</h2>
        <div className="border-border mt-3 rounded-lg border px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                LOCAL
              </Badge>
              {props.variant}
            </span>
            <span className="text-muted-foreground text-xs">{props.modelInfo ? "Ready" : "Loading"}</span>
          </div>
          {props.modelInfo && (
            <p className="text-muted-foreground mt-2 text-xs">
              {props.modelInfo.sampleRate} Hz · {props.modelInfo.channels} channel
              {props.modelInfo.quantized ? " · quantized" : ""}
            </p>
          )}
        </div>
      </section>
      <GenerationSettingsPanel
        settings={props.generationSettings}
        onChange={props.onGenerationSettingsChange}
        onReload={props.onReloadModel}
        onReset={props.onResetGenerationSettings}
        hasChanges={props.hasPendingSettings}
        loading={props.loading}
        generating={props.generating}
      />
      <section>
        <h2 className="text-sm font-medium">Output</h2>
        <div className="border-border mt-3 divide-y rounded-lg border">
          <div className="flex items-center justify-between px-3 py-3 text-sm">
            <span className="flex items-center gap-2">
              <FileAudio className="text-muted-foreground size-4" /> WAV audio
            </span>
            <span className="text-muted-foreground text-xs">44.1 kHz</span>
          </div>
          <div className="flex items-center justify-between px-3 py-3 text-sm">
            <span className="flex items-center gap-2">
              <Gauge className="text-muted-foreground size-4" /> Stream playback
            </span>
            <span className="text-primary text-xs">On</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function HistoryPanel(props: TtsWorkspaceProps) {
  const [query, setQuery] = useState("");
  const entries = useMemo(
    () => props.history.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase())),
    [props.history, query]
  );
  return (
    <div className="p-5">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search history…"
          className="pl-9"
        />
      </div>
      {entries.length === 0 ? (
        <div className="text-muted-foreground py-14 text-center text-sm">
          <History className="mx-auto size-5" />
          <p className="mt-3">{props.history.length ? "No matching generations" : "No generations yet"}</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-1">
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
        </div>
      )}
    </div>
  );
}
