import { Check, Mic, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VoiceRecord } from "@/lib/api";

interface VoicePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customVoices: VoiceRecord[];
  selectedCustomVoiceId: number | null;
  onSelectCustom: (id: number) => void;
  onClone: () => void;
  onRenameCustom: (id: number, name: string) => void;
  onDeleteCustom: (id: number) => void;
  loading: boolean;
  variant: string;
}

export function VoicePickerDialog({
  open,
  onOpenChange,
  customVoices,
  selectedCustomVoiceId,
  onSelectCustom,
  onClone,
  onRenameCustom,
  onDeleteCustom,
  loading,
  variant,
}: VoicePickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Custom voices</DialogTitle>
          <DialogDescription>Manage your cloned voices.</DialogDescription>
        </DialogHeader>
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
        <DialogFooter>
          <span className="text-muted-foreground mr-auto text-xs">Current model · {variant}</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
