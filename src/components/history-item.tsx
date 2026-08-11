import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

interface HistoryItemProps { name: string; duration: number; active: boolean; onPlay: () => void; onDownload: () => void; disabled: boolean }

export function HistoryItem({ name, duration, active, onPlay, onDownload, disabled }: HistoryItemProps) {
  return <div className={`group flex items-center gap-2 rounded-md px-3 py-3 ${active ? "bg-accent" : "hover:bg-accent/60"}`}><button onClick={onPlay} disabled={disabled} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm">{name}</span><span className="mt-1 block text-xs text-muted-foreground">Local voice · {duration.toFixed(2)} seconds</span></button><Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={onDownload} disabled={disabled} aria-label={`Download ${name} as WAV`}><Download /></Button></div>
}
