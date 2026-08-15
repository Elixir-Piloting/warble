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
                No cloned voices yet. Use "Clone a voice" to save your first one.
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
