import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Mic, MicOff, Play, Upload } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cloneVoice, type VoiceRecord } from "@/lib/api";
import { blobToWavBytes, fileToWavBytes } from "@/lib/audio";

interface VoiceCloneWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: (voice: VoiceRecord) => void;
}

type Tab = "file" | "record";

export function VoiceCloneWizard({ open, onOpenChange, onCloned }: VoiceCloneWizardProps) {
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<Tab>("file");
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [wavBytes, setWavBytes] = useState<Uint8Array | null>(null);
  const [name, setName] = useState("");
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloned, setCloned] = useState<VoiceRecord | null>(null);
  const [recState, setRecState] = useState<"idle" | "recording">("idle");
  const [recTime, setRecTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      setTab("file");
      setSourceName(null);
      setSourceUrl(null);
      setWavBytes(null);
      setName("");
      setError(null);
      setCloned(null);
      setRecTime(0);
    } else {
      stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopRecording() {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
    if (recTimerRef.current !== null) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecState("idle");
  }

  async function pickFile() {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "mp4", "ogg", "flac", "aac"] }],
    });
    if (typeof path !== "string") return;
    try {
      const bytes = await fileToWavBytes(path);
      setSourceName(path.split(/[\\/]/).pop() ?? path);
      setSourceUrl(URL.createObjectURL(new Blob([bytes as BlobPart])));
      setWavBytes(bytes);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function toggleRecording() {
    if (recState === "recording") {
      stopRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        try {
          const bytes = await blobToWavBytes(blob);
          setSourceName("Microphone recording");
          setSourceUrl(URL.createObjectURL(new Blob([bytes as BlobPart])));
          setWavBytes(bytes);
          setError(null);
        } catch (err) {
          setError(String(err));
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      rec.start();
      mediaRef.current = rec;
      setRecState("recording");
      setRecTime(0);
      recTimerRef.current = window.setInterval(() => setRecTime((t) => t + 1), 1000);
    } catch (err) {
      setError(`Microphone access denied: ${String(err)}`);
    }
  }

  function togglePreview() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  async function startClone() {
    if (!wavBytes || !name.trim()) return;
    setCloning(true);
    setError(null);
    try {
      const voice = await cloneVoice(
        name.trim(),
        wavBytes,
        sourceName === "Microphone recording" ? "recording" : "file"
      );
      setCloned(voice);
    } catch (err) {
      setError(String(err));
    } finally {
      setCloning(false);
    }
  }

  const hasSource = Boolean(wavBytes);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Clone a voice</DialogTitle>
          <DialogDescription>
            {step === 0 && "Step 1 of 3 — choose your source audio"}
            {step === 1 && "Step 2 of 3 — name this voice"}
            {step === 2 && "Step 3 of 3 — creating your voice clone"}
          </DialogDescription>
        </DialogHeader>

        {cloned ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
              <Check className="size-6" />
            </span>
            <div>
              <p className="font-medium">{cloned.name}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Voice saved · {(cloned.durationSec ?? 0).toFixed(1)}s source audio
              </p>
            </div>
          </div>
        ) : step === 0 ? (
          <div className="flex flex-col gap-4">
            <div className="border-border grid grid-cols-2 rounded-lg border p-1">
              {(["file", "record"] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex items-center justify-center gap-2 rounded-md py-2 text-sm ${tab === key ? "bg-accent font-medium" : "text-muted-foreground"}`}
                >
                  {key === "file" ? <Upload className="size-4" /> : <Mic className="size-4" />}
                  {key === "file" ? "Upload file" : "Record"}
                </button>
              ))}
            </div>

            {tab === "file" ? (
              <div className="border-border bg-muted/30 flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8">
                <Button variant="outline" onClick={() => void pickFile()}>
                  <Upload className="size-4" /> Choose audio file
                </Button>
                <p className="text-muted-foreground text-xs">
                  wav · mp3 · m4a · mp4 · ogg — converted to WAV automatically
                </p>
              </div>
            ) : (
              <div className="border-border bg-muted/30 flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8">
                <Button variant={recState === "recording" ? "destructive" : "default"} onClick={() => void toggleRecording()}>
                  {recState === "recording" ? (
                    <>
                      <MicOff className="size-4" /> Stop · {recTime}s
                    </>
                  ) : (
                    <>
                      <Mic className="size-4" /> Start recording
                    </>
                  )}
                </Button>
                <p className="text-muted-foreground text-xs">Speak for a few seconds, then stop</p>
              </div>
            )}

            {sourceName && (
              <div className="flex items-center gap-3">
                <audio ref={audioRef} src={sourceUrl ?? undefined} className="hidden" />
                <Button variant="outline" size="icon" onClick={togglePreview} aria-label="Preview source audio">
                  <Play className="size-4" />
                </Button>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">{sourceName}</span>
                <span className="text-muted-foreground text-xs">
                  {wavBytes ? `${(wavBytes.length / 1024).toFixed(0)} KB` : ""}
                </span>
              </div>
            )}
          </div>
        ) : step === 1 ? (
          <div className="flex flex-col gap-4">
            <Label htmlFor="voice-name">Voice name</Label>
            <Input
              id="voice-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="e.g. My warm voice"
              autoFocus
            />
            {sourceName && (
              <p className="text-muted-foreground text-xs">Source: {sourceName}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <LoaderCircle className="text-primary size-8 animate-spin" />
            <p className="text-sm">Encoding your voice… this can take a moment.</p>
          </div>
        )}

        {error && <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">{error}</p>}

        <DialogFooter>
          <span className="mr-auto text-xs">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`mr-1 inline-block size-2 rounded-full ${i === step ? "bg-primary" : "bg-border"}`}
              />
            ))}
          </span>
          {cloned ? (
            <>
              <Button variant="ghost" onClick={() => setCloned(null)}>
                Clone another
              </Button>
              <Button onClick={() => onCloned(cloned)}>Use this voice</Button>
            </>
          ) : step === 0 ? (
            <Button onClick={() => hasSource && setStep(1)} disabled={!hasSource}>
              Next
            </Button>
          ) : step === 1 ? (
            <>
              <Button variant="ghost" onClick={() => setStep(0)} disabled={cloning}>
                Back
              </Button>
              <Button onClick={() => void startClone()} disabled={!name.trim() || cloning}>
                {cloning ? "Cloning…" : "Clone voice"}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setStep(1)} disabled={cloning}>
              Back
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
