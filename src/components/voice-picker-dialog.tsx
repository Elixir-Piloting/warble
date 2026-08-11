import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STOCK_VOICES } from "@/components/voice-data";
import { VoiceOrb } from "@/components/voice-orb";

interface VoicePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string;
  hasVoice: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onLoad: (spec?: string) => void;
  customVoice: string;
  onCustomVoiceChange: (value: string) => void;
  loading: boolean;
  variant: string;
}

export function VoicePickerDialog({ open, onOpenChange, selectedId, hasVoice, search, onSearchChange, onLoad, customVoice, onCustomVoiceChange, loading, variant }: VoicePickerDialogProps) {
  const selected = STOCK_VOICES.find((voice) => voice.id === selectedId) ?? STOCK_VOICES[0];
  const voices = STOCK_VOICES.filter((voice) => `${voice.name} ${voice.description} ${voice.tone}`.toLowerCase().includes(search.toLowerCase()));

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogTrigger asChild><button className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent"><VoiceOrb active={hasVoice} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{hasVoice ? selected.name : "Choose a voice"}</span><span className="block truncate text-xs text-muted-foreground">{hasVoice ? selected.description : "Browse voice library"}</span></span><ChevronRight className="size-4 text-muted-foreground" /></button></DialogTrigger>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>Voice library</DialogTitle><DialogDescription>Choose a voice and it loads immediately into this session.</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-4"><Input value={search} onChange={(event) => onSearchChange(event.currentTarget.value)} placeholder="Search voices…" /><div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">{voices.map((voice) => <button key={voice.id} onClick={() => onLoad(voice.id)} disabled={loading} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/60 hover:bg-accent ${selectedId === voice.id && hasVoice ? "border-primary/60 bg-accent" : "border-border"}`}><VoiceOrb active={selectedId === voice.id && hasVoice} /><span className="min-w-0 flex-1"><span className="block font-medium">{voice.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{voice.description}</span></span>{selectedId === voice.id && hasVoice && <Check className="text-primary" />}</button>)}</div><div className="rounded-xl border border-dashed border-border bg-muted/30 p-4"><Label htmlFor="custom-voice" className="text-xs uppercase tracking-[.14em] text-muted-foreground">Custom voice source</Label><div className="mt-3 flex gap-2"><Input id="custom-voice" value={customVoice} onChange={(event) => onCustomVoiceChange(event.currentTarget.value)} placeholder="hf://… or path to a voice file" /><Button onClick={() => onLoad()} disabled={!customVoice.trim() || loading}>Load</Button></div></div></div>
      <DialogFooter><span className="mr-auto text-xs text-muted-foreground">Current model · {variant}</span></DialogFooter>
    </DialogContent>
  </Dialog>;
}
