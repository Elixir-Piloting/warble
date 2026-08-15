import { useMemo, useState } from "react";
import { ArrowLeft, Check, Mic, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STOCK_VOICES } from "@/components/voice-data";
import { VoiceOrb } from "@/components/voice-orb";
import type { VoiceRecord } from "@/lib/api";

interface VoiceBrowserProps {
  voiceId: string | null;
  stockVoice: string;
  onLoadVoice: (spec?: string) => void;
  customVoices: VoiceRecord[];
  selectedCustomVoiceId: number | null;
  onSelectCustomVoice: (id: number) => void;
  onCloneVoice: () => void;
  onRenameVoice: (id: number, name: string) => void;
  onDeleteVoice: (id: number) => void;
  loading: boolean;
  variant: string;
  onBack: () => void;
}

function BrowserTab({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 pb-3 text-sm ${active ? "border-foreground font-medium" : "text-muted-foreground border-transparent"}`}
    >
      {children}
    </button>
  );
}

export function VoiceBrowser({
  voiceId,
  stockVoice,
  onLoadVoice,
  customVoices,
  selectedCustomVoiceId,
  onSelectCustomVoice,
  onCloneVoice,
  onRenameVoice,
  onDeleteVoice,
  loading,
  variant,
  onBack,
}: VoiceBrowserProps) {
  const [tab, setTab] = useState<"prebuilt" | "mine">("prebuilt");
  const [query, setQuery] = useState("");

  const voices = useMemo(
    () =>
      STOCK_VOICES.filter((voice) =>
        `${voice.name} ${voice.description} ${voice.tone}`.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [query]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to settings">
          <ArrowLeft />
        </Button>
        <span className="text-sm font-medium">Voice</span>
      </div>
      <div className="border-border flex shrink-0 gap-5 border-b px-5 pt-3">
        <BrowserTab active={tab === "prebuilt"} onClick={() => setTab("prebuilt")}>
          Pre-built
        </BrowserTab>
        <BrowserTab active={tab === "mine"} onClick={() => setTab("mine")}>
          My voices
        </BrowserTab>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "prebuilt" ? (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search voices…"
                className="pl-9"
              />
            </div>
            {voices.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">No matching voices</p>
            ) : (
              <div className="flex flex-col gap-2">
                {voices.map((voice) => {
                  const active = voiceId != null && selectedCustomVoiceId == null && stockVoice === voice.id;
                  return (
                    <button
                      key={voice.id}
                      onClick={() => onLoadVoice(voice.id)}
                      disabled={loading}
                      className={`hover:border-primary/60 hover:bg-accent flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${active ? "border-primary/60 bg-accent" : "border-border"}`}
                    >
                      <VoiceOrb active={active} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{voice.name}</span>
                        <span className="text-muted-foreground mt-0.5 block truncate text-xs">{voice.description}</span>
                      </span>
                      {active && <Check className="text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Button size="sm" variant="outline" className="self-start" onClick={onCloneVoice}>
              <Mic className="size-4" /> Clone a voice
            </Button>
            {customVoices.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                No cloned voices yet. Use "Clone a voice" to save your first one.
              </p>
            ) : (
              <div className="border-border flex flex-col divide-y divide-border rounded-xl border">
                {customVoices.map((voice) => {
                  const active = selectedCustomVoiceId === voice.id;
                  return (
                    <div key={voice.id} className={`flex items-center gap-3 px-4 py-3 ${active ? "bg-accent" : ""}`}>
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
                        {active && <Check className="text-primary" />}
                      </button>
                      <button
                        onClick={() => {
                          const next = window.prompt("Rename voice", voice.name);
                          if (next?.trim()) onRenameVoice(voice.id, next.trim());
                        }}
                        className="hover:bg-accent text-muted-foreground hover:text-foreground rounded-md p-2"
                        aria-label={`Rename ${voice.name}`}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete "${voice.name}"? This removes the saved clone and its audio.`)) {
                            onDeleteVoice(voice.id);
                          }
                        }}
                        className="hover:bg-accent text-muted-foreground hover:text-destructive rounded-md p-2"
                        aria-label={`Delete ${voice.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-muted-foreground text-xs">Current model · {variant}</p>
          </div>
        )}
      </div>
    </div>
  );
}
