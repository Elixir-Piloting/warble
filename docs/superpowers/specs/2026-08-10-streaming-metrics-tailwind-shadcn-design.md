# Warble Harness: Streaming Playback, Metrics, Tailwind v4 + shadcn

Date: 2026-08-10
Status: Approved design (user: "sure")

## Goal

Improve the local-TTS test harness UI in three areas:

1. **Talk while generating** — play audio incrementally as chunks stream from
   the Rust engine instead of waiting for the full generation to finish.
2. **Metrics** — show live character count of the input text and elapsed
   generation timing (total and time-to-first-audio).
3. **Tailwind CSS v4 + shadcn/ui** — install both and rebuild the harness UI
   on stock shadcn primitives (no custom design language; neutral base).

## Current State

- Tauri v2 app, Vite 7 + React 19, TypeScript. Frontend in `src/App.tsx` with
  hand-rolled CSS in `src/App.css`, imported via `src/main.tsx`.
- Rust commands (`src-tauri/src/tts.rs`, exposed in `src-tauri/src/lib.rs`):
  - `load_tts_model(variant)` — loads weights (variant defaults `b6369a24`).
  - `get_tts_voice_state(voiceSpec)` — creates a voice state, returns an id.
  - `generate_tts_stream(text, voiceId)` — kicks off async generation.
- Generation emits Tauri events:
  - `tts://chunk` `{ voiceId, index, sampleRate, channels, pcm }` where
    `pcm` is a **little-endian i16** sample array (JSON number list), ~1920
    samples (~80 ms at 24 kHz, 1 channel).
  - `tts://done` `{ voiceId, totalChunks, sampleRate }`.
  - `tts://error` `{ voiceId, message }`.
- Chunks arrive in order; no gaps between consecutive chunks (Mimi frames are
  contiguous).

## Design

### A. Streaming playback (frontend only)

Replace buffer-then-play semantics with a streaming player owned by a
`useRef`-backed queue.

**Chunk ingestion:**
- On `tts://chunk`: decode `pcm` (i16 LE) → `Float32Array` → `AudioBuffer`
  via the existing `pcmBytesToFloat32` helper; push `{ buffer, duration }`
  onto a FIFO queue; update chunk count and live elapsed metrics.

**Scheduling (gapless):**
- Maintain one shared `AudioContext` (created lazily, resumed on first play).
- Keep `nextPlayTime` = `ctx.currentTime` while idle. Each enqueued buffer is
  scheduled for `start(nextPlayTime)` with a `BufferSource` connected to
  `destination`; after scheduling, `nextPlayTime += buffer.duration`.
- **Start threshold:** do not begin until the buffered headroom reaches
  `STREAM_START_MILLIS = 250` ms of audio (`nextPlayTime - ctx.currentTime`),
  or `done` arrives first (then play immediately). This absorbs IPC jitter so
  playback does not stutter, without a long dead-silence delay.
- Sources chained back-to-back on the audio clock give gapless playback.

**Stop:**
- A **Stop** button clears the queue, stops all scheduled sources (keep refs in
  a `Set`), resets `nextPlayTime` and metrics. Generation itself continues in
  Rust unless the user cancels; the UI simply ignores post-stop chunks (guard
  on an incrementing `streamId`).

**Autoplay checkbox** is removed; streaming playback makes it redundant
(playing while generating is the new default).

### B. Metrics

- **Character count:** derived from `text.length`, shown live beside the
  textarea (e.g., a badge `145 chars`).
- **Generation timing:** measured on the frontend from `generate_tts_stream`
  invocation:
  - `t0` = invoke start
  - `ttfa` = first chunk arrival (ms from `t0`)
  - `tEnd` = `tts://done` arrival (ms from `t0`)
  - Status line after done: `145 chars · done in 2.41 s · first audio 0.31 s`.
  - During generation, a live readout of elapsed + streamed duration updates on
    each chunk.

### C. Tailwind v4 + shadcn/ui

Install and wire (no custom theme work):

1. `pnpm add tailwindcss @tailwindcss/vite`
2. `vite.config.ts`: add `tailwindcss()` plugin.
3. `src/index.ts`? — no; create `src/styles.css` (or reuse a new `index.css`)
   with `@import "tailwindcss";`; import it from `src/main.tsx`, replacing the
   `App.css` import. Delete `src/App.css`.
4. Path alias `@/*` → `./src/*` in `vite.config.ts` and `tsconfig.json`
   (`baseUrl` + `paths`) plus `tsconfig.node.json` if needed.
5. `pnpm dlx shadcn@latest init` — neutral base color, defaults; generates
   `components.json`, `src/lib/utils.ts`, theme CSS variables (light default).
6. `pnpm dlx shadcn@latest add button card input label select textarea badge
   progress`
7. Rebuild `App.tsx`: shadcn `Card` per section (Model / Voice / Generate),
   `Button`, `Input`, `Select` (stock voices), `Textarea`, `Label`, `Badge`,
   `Progress` (stream progress = streamed audio ms / total expected ms).
   Layout with Tailwind utilities; no component beyond shadcn primitives.

**Expected components:** Model card, Voice card, Generate card (textarea +
stop/generate buttons + metrics), Status card (status `<pre>` upgraded to a
styled readout + progress badge).

## Error Handling

- Rust errors already surface via `tts://error` and rejected `invoke` promises;
  both map to the error phase / status text (unchanged behavior).
- Playback source errors (rare) are swallowed; a `try/onerror` on
  `AudioBufferSourceNode` logs to console only.
- Stop during generation: ignored chunks guarded by `streamId`.

## Testing

- Manual: generate with autoplay (default) — first audible audio within
  ~0.3 s of first chunk; full utterance plays without stutter while `Progress`
  advances; Stop halts audio; metrics show char count + `done in N.NNs`.
- `pnpm tauri dev --release` to iterate (release build + MKL already wired).
- `pnpm build` (tsc + vite) must pass; no Rust changes are planned, so no
  Rust-side verification beyond the existing build.

## Out of Scope

- No Rust changes (streaming already works end-to-end).
- No voice cloning UI changes, no model-switching rework.
- No custom design system work beyond shadcn defaults.