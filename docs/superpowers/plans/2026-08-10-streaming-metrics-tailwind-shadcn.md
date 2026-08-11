# Streaming Playback + Metrics + Tailwind v4/shadcn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Warble TTS harness talk while it generates, show char count + timing metrics, and rebuild its UI on Tailwind CSS v4 + shadcn/ui.

**Architecture:** Frontend-only change. A `StreamPlayer` schedules each streamed PCM chunk (from existing `tts://chunk` events) back-to-back on the Web Audio clock for gapless playback, starting once ~250 ms of audio has buffered. The UI is rebuilt on stock shadcn primitives over Tailwind v4. No Rust changes.

**Tech Stack:** Vite 7, React 19, TypeScript, Tauri 2, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (neutral base), Web Audio API.

## Global Constraints

- No git repository — **do not run `git` commands**; each task ends with verification, not a commit.
- `pnpm` is the package manager.
- Vite is configured with `server.port = 1420` (fixed, Tauri dev) — do not change.
- No new dependencies beyond: `tailwindcss`, `@tailwindcss/vite`, shadcn's transitive set (`clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, Radix packages pulled by the CLI).
- The Rust side stays untouched: commands `load_tts_model`, `get_tts_voice_state`, `generate_tts_stream`; events `tts://chunk`, `tts://done`, `tts://error`.
- `tts://chunk` payload: `{ voiceId, index, sampleRate, channels, pcm }`, `pcm` is a little-endian i16 number array, ~1920 samples (~80 ms @ 24 kHz). `tts://done` gives `{ voiceId, totalChunks, sampleRate }`.
- Final verification command for every task: `pnpm build` (runs `tsc && vite build`) must exit 0. Manual QA runs under `pnpm tauri dev --release`.

---

### Task 1: Tailwind v4 wiring

**Files:**
- Modify: `package.json` (via `pnpm add`)
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`
- Create: `src/index.css`
- Modify: `src/main.tsx`
- Delete: `src/App.css`

**Interfaces:**
- Produces: `src/index.css` (Tailwind v4 entry, imports via `@import "tailwindcss"`), `@/*` alias resolving to `./src/*` in both Vite and TypeScript.

- [ ] **Step 1: Install Tailwind v4**

Run: `pnpm add tailwindcss @tailwindcss/vite`
Expected: installs `tailwindcss` and `@tailwindcss/vite` into `package.json` dependencies.

- [ ] **Step 2: Add the Vite plugin + `@` alias**

Replace the full contents of `vite.config.ts` with:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": "/src",
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

- [ ] **Step 3: Add the `@/*` path alias to TypeScript**

In `tsconfig.json`, inside `compilerOptions`, add:

```jsonc
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
```

- [ ] **Step 4: Create the Tailwind entry CSS**

Create `src/index.css` with exactly:

```css
@import "tailwindcss";
```

(shadcn/tailwind will extend this file in Task 2.)

- [ ] **Step 5: Swap the stylesheet import in `main.tsx`**

Replace the contents of `src/main.tsx` with:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Delete the old stylesheet**

Run: `Remove-Item src\App.css`
(Styles are fully replaced by Tailwind + shadcn in Task 4.)

- [ ] **Step 7: Verify**

Run: `pnpm build`
Expected: `tsc` typechecks clean and `vite build` succeeds (Tailwind v4 scans source automatically; no `content` config needed).

---

### Task 2: Install and initialize shadcn/ui

**Files:**
- Create: `components.json` (CLI-generated)
- Create: `src/lib/utils.ts` (CLI-generated)
- Modify: `src/index.css` (CLI adds theme variables + `@theme inline` mapping)
- Create: `src/components/ui/{button,card,input,label,select,textarea,badge,progress}.tsx` (CLI-generated)
- Modify: `package.json` (CLI adds `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, Radix deps)

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` in `src/lib/utils.ts`; shadcn primitives in `src/components/ui/*` exported under named components (`Button`, `CardHeader`, `Progress`, `SelectItem`, etc.), all importing `@/lib/utils`.

- [ ] **Step 1: Initialize shadcn**

Run: `pnpm dlx shadcn@latest init --yes --base-color neutral`
Expected: writes `components.json`, `src/lib/utils.ts`, sets CSS variables in `src/index.css`, and adds shadcn deps to `package.json`.

- [ ] **Step 2: Install the primitives used by the app**

Run: `pnpm dlx shadcn@latest add button card input label select textarea badge progress`
Expected: `src/components/ui/button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `textarea.tsx`, `badge.tsx`, `progress.tsx` created.

- [ ] **Step 3: Confirm `components.json` resolves the alias**

Read `components.json`; verify it contains `"aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", ... }` and `"css": "src/index.css"`. If the CLI ran without issue, it is correct by default.

> **Fallback (only if Steps 1–2 cannot run non-interactively):** do it by hand —
> 1. `pnpm add clsx tailwind-merge class-variance-authority lucide-react`
> 2. Create `src/lib/utils.ts` with the `cn` helper (see Interface above — canonical two-liner using `clsx` + `twMerge(clsx(inputs))`).
> 3. Create `components.json` manually (`"$schema": "https://ui.shadcn.com/schema.json", "style": "new-york", "rsc": false, "tsx": true, "tailwind": { "config": "", "css": "src/index.css", "baseColor": "neutral", "cssVariables": true }, "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" }`).
> 4. Copy the canonical shadcn "neutral" theme (CSS variables + `@theme inline` block) into `src/index.css` and install the 8 primitives from https://ui.shadcn.com/docs/components — do not hand-write them.

- [ ] **Step 4: Verify**

Run: `pnpm build`
Expected: still exits 0 with the new UI files present (they are currently unused by `src/App.tsx`, which type-checks independently).

---

### Task 3: PCM decode helper + streaming player

**Files:**
- Create: `src/lib/pcm.ts`
- Create: `src/lib/streamPlayer.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure TS).
- Produces:
  - `i16BytesToFloat32(pcm: number[]): Float32Array` in `src/lib/pcm.ts` — takes a little-endian i16 sample array, returns normalized `[-1, 1]` f32 samples.
  - `STREAM_START_MILLIS: number` (constant `250`) in `src/lib/streamPlayer.ts`.
  - `class StreamPlayer` in `src/lib/streamPlayer.ts` with:
    - `decodeChunk(pcm: number[], sampleRate: number, channels: number): AudioBuffer`
    - `enqueue(audioBuffer: AudioBuffer): number` (returns seconds added)
    - `finish(): void`
    - `stop(): void`
    - `dispose(): void`
    - `get streamedSeconds(): number`
    - `get playing(): boolean`

- [ ] **Step 1: Create the PCM decoder**

Create `src/lib/pcm.ts`:

```ts
/** Decode a little-endian i16 PCM sample array into normalized f32 samples. */
export function i16BytesToFloat32(pcm: number[]): Float32Array {
  const out = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < out.length; i++) {
    const u16 = (pcm[i * 2] ?? 0) | (((pcm[i * 2 + 1] ?? 0) & 0xff) << 8);
    const signed = u16 >= 32768 ? u16 - 65536 : u16;
    out[i] = signed / 32768;
  }
  return out;
}
```

- [ ] **Step 2: Create the streaming player**

Create `src/lib/streamPlayer.ts`:

```ts
import { i16BytesToFloat32 } from "./pcm";

/** Headroom of buffered audio before playback starts, to absorb IPC jitter. */
export const STREAM_START_MILLIS = 250;

/**
 * Gapless streaming playback: AudioBuffers are enqueued as chunks arrive and
 * scheduled back-to-back on the Web Audio clock. Playback begins once
 * STREAM_START_MILLIS of audio has accumulated, or immediately when `finish()`
 * is called (the stream is complete and nothing more will arrive).
 */
export class StreamPlayer {
  private ctx: AudioContext | null = null;
  private queued: AudioBuffer[] = [];
  private queuedDuration = 0;
  private nextTime = 0;
  private started = false;
  private lastArrived = false;
  private stopped = false;
  private totalSeconds = 0;
  private active = new Set<AudioBufferSourceNode>();

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  decodeChunk(pcm: number[], sampleRate: number, channels: number): AudioBuffer {
    const ctx = this.ensureCtx();
    const float = i16BytesToFloat32(pcm);
    const frames = Math.floor(float.length / channels);
    const buffer = ctx.createBuffer(channels, frames, sampleRate);
    for (let c = 0; c < channels; c++) {
      const channel = new Float32Array(frames);
      for (let i = 0; i < frames; i++) channel[i] = float[i * channels + c];
      buffer.copyToChannel(channel, c);
    }
    return buffer;
  }

  /** Queue one decoded chunk. Returns its duration in seconds. */
  enqueue(audioBuffer: AudioBuffer): number {
    if (this.stopped) return 0;
    this.queued.push(audioBuffer);
    this.queuedDuration += audioBuffer.duration;
    this.totalSeconds += audioBuffer.duration;
    this.drain();
    return audioBuffer.duration;
  }

  /** Signals the protocol `done` event: nothing more will arrive. */
  finish(): void {
    if (this.stopped) return;
    this.lastArrived = true;
    this.drain();
  }

  private drain(): void {
    if (this.stopped) return;
    const ready =
      this.lastArrived || this.queuedDuration >= STREAM_START_MILLIS / 1000;
    if (!ready || this.queued.length === 0) return;
    if (!this.started) {
      if (this.ctx!.state === "suspended") void this.ctx!.resume();
      this.nextTime = this.ctx!.currentTime + 0.05;
      this.started = true;
    }
    while (this.queued.length > 0) {
      const buf = this.queued.shift()!;
      this.queuedDuration -= buf.duration;
      this.schedule(buf);
    }
  }

  private schedule(buf: AudioBuffer): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => this.active.delete(src);
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this.active.add(src);
  }

  /** Total seconds of audio handed to `enqueue` since the last `stop`. */
  get streamedSeconds(): number {
    return this.totalSeconds;
  }

  get playing(): boolean {
    return this.started && this.active.size > 0;
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    }
    this.active.clear();
    this.queued = [];
    this.queuedDuration = 0;
    this.totalSeconds = 0;
    this.nextTime = 0;
    this.started = false;
    this.lastArrived = false;
  }

  dispose(): void {
    this.stop();
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
```

- [ ] **Step 3: Verify**

Run: `pnpm build`
Expected: typechecks clean; the two modules compile (unused by `App.tsx` yet).

---

### Task 4: Rebuild `App.tsx` — streaming playback, metrics, shadcn UI

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `StreamPlayer`/`STREAM_START_MILLIS` (Task 3), `i16BytesToFloat32` (indirectly via player), shadcn primitives (Task 2), Tauri `invoke` + `listen`.
- Produces: the full harness UI.

- [ ] **Step 1: Replace `src/App.tsx` entirely**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StreamPlayer } from "@/lib/streamPlayer";

interface TtsLoadResult {
  variant: string;
  sampleRate: number;
  channels: number;
  quantized: boolean;
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

const STOCK_VOICES = [
  "alba",
  "marius",
  "javert",
  "jean",
  "fantine",
  "cosette",
  "eponine",
  "azelma",
];

type Phase = "idle" | "loading" | "loaded" | "generating" | "done" | "error";

export default function App() {
  const [variant, setVariant] = useState("b6369a24");
  const [modelInfo, setModelInfo] = useState<TtsLoadResult | null>(null);
  const [stockVoice, setStockVoice] = useState("alba");
  const [voiceSpec, setVoiceSpec] = useState("");
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [text, setText] = useState(
    "Hello! This is a test of the built in text to speech engine.",
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [chunkCount, setChunkCount] = useState(0);
  const [streamedSec, setStreamedSec] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [totalSec, setTotalSec] = useState<number | null>(null);
  const [status, setStatus] = useState("");

  const playerRef = useRef<StreamPlayer | null>(null);
  const t0Ref = useRef(0);
  const ttfaRef = useRef<number | null>(null);
  const streamIdRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const getPlayer = useCallback((): StreamPlayer => {
    if (!playerRef.current) playerRef.current = new StreamPlayer();
    return playerRef.current;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleChunk = useCallback(
    (payload: TtsChunkPayload) => {
      if (ttfaRef.current === null) ttfaRef.current = performance.now() - t0Ref.current;
      const player = getPlayer();
      const buffer = player.decodeChunk(
        payload.pcm,
        payload.sampleRate,
        payload.channels,
      );
      const dur = player.enqueue(buffer);
      setStreamedSec((s) => s + dur);
      setChunkCount(payload.index + 1);
    },
    [getPlayer],
  );

  const handleDone = useCallback(
    (payload: TtsDonePayload) => {
      const player = getPlayer();
      player.finish();
      clearTimer();
      const total = player.streamedSeconds;
      const elapsed = (performance.now() - t0Ref.current) / 1000;
      setElapsedSec(elapsed);
      setTotalSec(total);
      setPhase("done");
      const ttfa = ttfaRef.current;
      const ttfaPart =
        ttfa !== null ? `${(ttfa / 1000).toFixed(2)} s to first audio · ` : "";
      setStatus(
        `${ttfaPart}${payload.totalChunks} chunks · ${total.toFixed(2)} s speech · done in ${elapsed.toFixed(2)} s`,
      );
    },
    [clearTimer, getPlayer],
  );

  const handleError = useCallback((payload: TtsErrorPayload) => {
    setPhase("error");
    setStatus(payload.message);
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen<TtsChunkPayload>("tts://chunk", (e) => {
          if (active) handleChunk(e.payload);
        }),
      );
      unlisteners.push(
        await listen<TtsDonePayload>("tts://done", (e) => {
          if (active) handleDone(e.payload);
        }),
      );
      unlisteners.push(
        await listen<TtsErrorPayload>("tts://error", (e) => {
          if (active) handleError(e.payload);
        }),
      );
    })();
    return () => {
      active = false;
      unlisteners.forEach((un) => un());
    };
  }, [handleChunk, handleDone, handleError]);

  async function handleLoadModel() {
    setPhase("loading");
    setStatus(
      "Loading model — first run downloads weights from Hugging Face (set HF_TOKEN for the gated repo)…",
    );
    try {
      const info = await invoke<TtsLoadResult>("load_tts_model", { variant });
      setModelInfo(info);
      setPhase("loaded");
      setStatus(
        `Model loaded · ${info.variant} · ${info.sampleRate} Hz · ${info.channels} ch${info.quantized ? " · int8" : ""}`,
      );
    } catch (e) {
      setPhase("error");
      setStatus(String(e));
    }
  }

  async function handleCreateVoice() {
    if (!modelInfo) {
      setStatus("Load the model first.");
      return;
    }
    const spec = voiceSpec.trim() || stockVoice;
    setStatus(
      spec.startsWith("hf://") || spec.includes("\\") || spec.includes("/")
        ? `Encoding voice ${spec}…`
        : `Loading stock voice "${spec}"…`,
    );
    try {
      const id = await invoke<string>("get_tts_voice_state", { voiceSpec: spec });
      setVoiceId(id);
      setStatus(`Voice ready · ${spec} · id ${id}`);
    } catch (e) {
      setPhase("error");
      setStatus(String(e));
    }
  }

  async function handleGenerate() {
    if (!voiceId) {
      setStatus("Create a voice state first.");
      return;
    }
    streamIdRef.current += 1;
    t0Ref.current = performance.now();
    ttfaRef.current = null;
    setPhase("generating");
    setChunkCount(0);
    setStreamedSec(0);
    setTotalSec(null);
    setElapsedSec(0);
    setStatus("Generating…");
    clearTimer();
    timerRef.current = window.setInterval(() => {
      setElapsedSec((performance.now() - t0Ref.current) / 1000);
    }, 250);
    try {
      await invoke<number>("generate_tts_stream", { text, voiceId });
    } catch (e) {
      clearTimer();
      setPhase("error");
      setStatus(String(e));
    }
  }

  function handleStop() {
    streamIdRef.current += 1;
    getPlayer().stop();
    clearTimer();
    setPhase("idle");
    setChunkCount(0);
    setStreamedSec(0);
    setStatus("Stopped");
  }

  const chars = text.length;
  const estTotalSec = Math.max(0.5, chars / 15);
  const progressPct =
    phase === "done"
      ? 100
      : phase === "generating"
        ? Math.min(99, (streamedSec / estTotalSec) * 100)
        : 0;

  const isGenerating = phase === "generating";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Local TTS · Test Harness</h1>
        {phase === "generating" && (
          <Badge variant="secondary" className="animate-pulse">Generating…</Badge>
        )}
        {phase === "done" && <Badge>Done</Badge>}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1 · Model</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="variant">Variant</Label>
              <Input
                id="variant"
                value={variant}
                onChange={(e) => setVariant(e.currentTarget.value)}
                placeholder="b6369a24"
              />
            </div>
            <Button onClick={handleLoadModel} disabled={phase === "loading" || isGenerating}>
              {phase === "loading" ? "Loading…" : modelInfo ? "Reload" : "Load model"}
            </Button>
          </div>
          {modelInfo && (
            <p className="text-sm text-muted-foreground">
              {modelInfo.variant} · {modelInfo.sampleRate} Hz · {modelInfo.channels} channel
              {modelInfo.quantized ? " · int8" : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2 · Voice</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <div className="grid gap-1.5">
              <Label>Stock voice</Label>
              <Select value={stockVoice} onValueChange={setStockVoice}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_VOICES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="voice-spec">Custom spec (optional)</Label>
              <Input
                id="voice-spec"
                value={voiceSpec}
                onChange={(e) => setVoiceSpec(e.currentTarget.value)}
                placeholder="path to .wav / .safetensors or hf://… (blank = stock)"
              />
            </div>
            <Button onClick={handleCreateVoice} disabled={!modelInfo || isGenerating}>
              Create voice state
            </Button>
          </div>
          {voiceId && <p className="text-sm text-muted-foreground">voice id: {voiceId}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3 · Generate</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="text">Text</Label>
            <Textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              rows={3}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Badge variant="outline">{chars} chars</Badge>
            <div className="flex gap-2">
              <Button onClick={handleGenerate} disabled={!voiceId || isGenerating}>
                {isGenerating ? "Generating…" : "Generate & stream"}
              </Button>
              {isGenerating && (
                <Button variant="destructive" onClick={handleStop}>
                  Stop
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Progress value={progressPct} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {phase === "generating" && "streaming… "}
              {chunkCount > 0 && `${chunkCount} chunks · `}
              {(streamedSec > 0 || isGenerating) && `${streamedSec.toFixed(2)} s audio · `}
              {`${elapsedSec.toFixed(2)} s elapsed`}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap break-words text-sm">{status || "—"}</pre>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm build`
Expected: exits 0. If a shadcn component import name differs in the generated files (e.g. `Select` not offered by the installed version), fix the import to match the generated `src/components/ui/select.tsx` exports.

- [ ] **Step 3: Manual QA under Tauri**

Run: `pnpm tauri dev --release`
Then in the app:
1. Load model → Create voice state (alba).
2. Generate the default sentence with the default longer text.
   - **Expected:** first audible audio starts within ~0.35 s of generation start; speech plays continuously while `chunks`/`s audio` count up; no stutter between chunks; the "Generating…" pulse badge shows; at `done` the badge flips to "Done" and the status shows `N chunks · M.NN s speech · done in K.KK s` plus time-to-first-audio.
3. Char count badge updates live as you edit `text`.
4. Press **Stop** mid-generation → audio halts immediately, status "Stopped", buttons re-enable.
5. Generate again after stop → works from a clean state.

---

### Task 5: Cleanup and final sweep

**Files:**
- Audit: `src/App.css` (must be absent from Task 1 onward), stale references to `App.css`, any leftover unused imports (`STREAM_START_MILLIS`, `i16BytesToFloat32` are intentionally not imported — adjust per Task 4 final code if `tsc` flags `noUnusedLocals`).

**Interfaces:** none (housekeeping).

- [ ] **Step 1: Grep for leftovers**

Run: `rg -n "App\.css|STREAM_START_MILLIS\|i16BytesToFloat32" src`
Expected: no matches.

- [ ] **Step 2: Final build**

Run: `pnpm build`
Expected: exits 0.

- [ ] **Step 3: Final manual smoke**

Run: `pnpm tauri dev --release`; rerun steps 2–4 from Task 4 once. Confirm no console errors in DevTools and audio output is stable.

---

## Self-Review Notes

- **Spec coverage:** A (streaming) → Tasks 3–4; B (metrics) → Task 4 (`chars`, `elapsedSec`, `ttfa`, `totalSec`); C (Tailwind v4 + shadcn) → Tasks 1–2. Autoplay-checkbox removal, Stop button, 250 ms start threshold all implemented.
- **Type consistency:** `StreamPlayer` API surfaces in Task 3 match every call site in Task 4 (`decodeChunk`, `enqueue`, `finish`, `stop`, `streamedSeconds`). `cn` name from Task 2 matches shadcn-generated imports (the generated files self-define it; the plan only relies on those files existing).
- **No placeholders:** every code/file/command is spelled out above; the only conditional is the documented CLI fallback.