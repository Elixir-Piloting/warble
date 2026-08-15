# Full-Width Footer + Voice Picker & Voice Memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated-audio footer span the full window width, wire the new ElevenLabs `VoicePicker` for stock voices, and persist/auto-restore the last-used voice.

**Architecture:** Three independent edits. (1) Restructure the shell grid in `tts-workspace.tsx` so the audio footer becomes the second row of an outer `grid-rows-[content_auto]` container, spanning under the sidebar. (2) In the Settings panel, swap the stock-voice selector to the installed `VoicePicker` (with the active voice shown in the trigger + checkmark on the selected item) and keep `VoicePickerDialog` for custom voices only. (3) Persist the last voice to `localStorage` (`warble:last-voice`) in `App.tsx` and auto-load it once the model is ready, falling back to `alba` for deleted custom voices.

**Tech Stack:** React 19, Vite 7, Tailwind v4, shadcn/ui (new-york), Radix, lucide-react, `@elevenlabs/elevenlabs-js`, Tauri v2 shell.

## Global Constraints

- TypeScript `strict`, `noUnusedLocals`, `noUnusedParameters` — remove now-unused imports/props or the build fails.
- Prettier config: `semi: true`, `trailingComma: "es5"`, `printWidth: 120`, `singleQuote: false`, `tabWidth: 2`, tailwind plugin. Follow existing file style (the app's own components use trailing semicolons; the vendored `ui/*` files from ElevenLabs do not — match the file you're editing).
- No test runner exists in this project. Verification = `pnpm exec tsc --noEmit` (exit 0) + `pnpm build` (exit 0) + manual UI checks listed per task.
- `@/` alias → `src/`. Components live in `src/components/ui/`.
- `STOCK_VOICES` (in `src/components/voice-data.ts`) items are `{ id, name, description, tone }` with `id` = `"alba"` etc.
- `ElevenLabs.Voice` type (`@elevenlabs/elevenlabs-js`): `voiceId: string` (required), `name?`, `labels?: Record<string,string>`, `previewUrl?`.
- The spec this plan implements: `docs/superpowers/specs/2026-08-15-full-width-footer-and-voice-memory-design.md`.

---

### Task 1: Full-Width Audio Footer

**Files:**
- Modify: `src/components/tts-workspace.tsx:92-175` (the `TtsWorkspace` return block)

**Interfaces:**
- Consumes: existing `GeneratedAudioPlayer` component + its props (`clip`, `src`, `onDownload`) — unchanged.
- Produces: new shell structure where `GeneratedAudioPlayer` renders as a sibling below the editor/sidebar grid. Later tasks rely on this structure being present.

- [ ] **Step 1: Restructure the shell**

Replace the entire `return` block of `TtsWorkspace` (currently lines 92-175, from `return (` after `const showTransport = ...` through the closing `);` before the `}` of the function). The footer must move out of `<main>` into a second row of a new outer grid.

Current structure (lines 92-175):

```tsx
  return (
    <TooltipProvider>
      <div className="bg-background text-foreground h-screen overflow-hidden">
        <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_460px]">
          <main className="border-border grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] border-r">
            <section className="min-h-0 overflow-y-auto">
              <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-8 py-16 lg:px-16">
                <Textarea ... />
                {props.generating && <LiveStreamBar ... />}
                <div className="mt-8 flex shrink-0 flex-wrap items-center justify-between gap-3">
                  ... (Insert pause + Generate buttons) ...
                </div>
              </div>
            </section>
            {showTransport && (
              <GeneratedAudioPlayer clip={...} src={...} onDownload={...} />
            )}
          </main>
          <aside className="min-h-0 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col">
              ... tabs + panels ...
            </div>
          </aside>
        </div>
      </div>
    </TooltipProvider>
  );
```

New structure:

```tsx
  return (
    <TooltipProvider>
      <div className="bg-background text-foreground h-screen overflow-hidden">
        <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
          <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_460px]">
            <main className="border-border min-h-0 min-w-0 overflow-hidden border-r">
              <section className="h-full min-h-0 overflow-y-auto">
                <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-8 py-16 lg:px-16">
                  <Textarea ... />
                  {props.generating && <LiveStreamBar ... />}
                  <div className="mt-8 flex shrink-0 flex-wrap items-center justify-between gap-3">
                    ... (Insert pause + Generate buttons — unchanged) ...
                  </div>
                </div>
              </section>
            </main>
            <aside className="min-h-0 overflow-hidden">
              <div className="flex h-full min-h-0 flex-col">
                ... tabs + panels (unchanged) ...
              </div>
            </aside>
          </div>
          {showTransport && (
            <GeneratedAudioPlayer clip={props.currentClip!} src={props.generatedAudioSrc!} onDownload={props.onDownloadClip} />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
```

Key changes:
- Outer wrapper becomes `grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]`.
- A new inner `<div>` holds the previous `lg:grid-cols-[minmax(0,1fr)_460px]` grid (`<main>` + `<aside>`) as row 1.
- `GeneratedAudioPlayer` moved to be a direct child of the outer grid = row 2, full width.
- `<main>` drops its `grid` + `grid-rows-[minmax(0,1fr)_auto]` classes; it becomes a plain grid cell. Its inner `<section>` gains `h-full` so it still fills the available height.

Copy the existing `Textarea`, `LiveStreamBar`, button row, and the `<aside>` content verbatim into the new structure — only the wrapper/section class changes and the footer relocation happen.

- [ ] **Step 2: Verify typecheck + build**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0, no output.

Run: `pnpm build`
Expected: exit 0, "built in" line in output.

- [ ] **Step 3: Manual check**

Run `pnpm dev` (or the fast dev-mode script from recent commits), generate a clip, and confirm the audio player footer stretches across the full window width, including underneath the Settings/History sidebar (460px).

- [ ] **Step 4: Commit**

```bash
git add src/components/tts-workspace.tsx
git commit -m "feat(frontend): span generated-audio footer across full window width"
```

---

### Task 2: Wire ElevenLabs VoicePicker for Stock Voices

**Files:**
- Modify: `src/components/tts-workspace.tsx` (imports + `SettingsPanel`)
- Modify: `src/components/ui/voice-picker.tsx:88-91` (close popover on select)
- Modify: `src/components/voice-picker-dialog.tsx` (trim to custom-voices only)
- Modify: `src/App.tsx` (remove `voiceSearch`/`onVoiceSearchChange` plumbing)

**Interfaces:**
- Consumes: `VoicePicker` from `@/components/ui/voice-picker` (props `voices: ElevenLabs.Voice[]`, `value?: string`, `onValueChange?: (value: string) => void`, `placeholder?: string`, `className?`, `open?: boolean`, `onOpenChange?: (open: boolean) => void`); existing `VoicePickerDialog` props minus `selectedId`/`search`/`onSearchChange`/`onLoad`; existing `TtsWorkspaceProps` (minus `voiceSearch`/`onVoiceSearchChange`).
- Produces: Settings panel stock-voice picker that shows the active voice; a "Custom voices" button opening the trimmed dialog; `VoicePickerDialog` used for custom-voice management only. Task 3 relies on `onLoadVoice` being reachable from the picker.

- [ ] **Step 1: Close the VoicePicker popover on select**

In `src/components/ui/voice-picker.tsx`, change the `CommandItem` `onSelect` callback (currently ~lines 88-91):

```tsx
                  <VoicePickerItem
                    key={voice.voiceId}
                    voice={voice}
                    isSelected={value === voice.voiceId}
                    onSelect={() => {
                      onValueChange?.(voice.voiceId!)
                    }}
                  />
```

to:

```tsx
                  <VoicePickerItem
                    key={voice.voiceId}
                    voice={voice}
                    isSelected={value === voice.voiceId}
                    onSelect={() => {
                      onValueChange?.(voice.voiceId!)
                      setIsOpen(false)
                    }}
                  />
```

(`setIsOpen` is already defined above as `isControlled ? onOpenChange : setInternalOpen`, so this closes the popover in both controlled and uncontrolled modes.)

- [ ] **Step 2: Add imports to `tts-workspace.tsx`**

Add to the lucide import (line 2) the `Mic` icon:

```tsx
import { Download, FileAudio, Gauge, History, LoaderCircle, Mic, Pause, Play, Search, Sparkles, Square } from "lucide-react";
```

Add after the `AudioPlayerProvider` import block (after line 10):

```tsx
import { VoicePicker } from "@/components/ui/voice-picker";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
```

- [ ] **Step 3: Rewrite `SettingsPanel`'s Voice section**

`SettingsPanel` currently renders (lines 258-281):

```tsx
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
```

Replace the whole `SettingsPanel` function body's Voice section with:

```tsx
  const stockVoices = useMemo<ElevenLabs.Voice[]>(
    () =>
      STOCK_VOICES.map((voice) => ({
        voiceId: voice.id,
        name: voice.name,
        labels: { description: voice.description, tone: voice.tone },
      })),
    []
  );
  const hasActiveStockVoice =
    props.selectedCustomVoiceId == null &&
    Boolean(props.voiceId) &&
    STOCK_VOICES.some((voice) => voice.id === props.stockVoice);

  return (
    <div className="flex flex-col gap-7 p-5">
      <section>
        <h2 className="text-sm font-medium">Voice</h2>
        <div className="mt-3 flex flex-col gap-2">
          <VoicePicker
            voices={stockVoices}
            value={hasActiveStockVoice ? props.stockVoice : undefined}
            onValueChange={(id) => props.onLoadVoice(id)}
            placeholder={props.voiceId ? props.currentVoiceName : "Select a voice..."}
          />
          <Button variant="outline" className="w-full justify-start" onClick={() => props.onVoiceOpenChange(true)}>
            <Mic className="size-4" /> Custom voices
          </Button>
          <VoicePickerDialog
            open={props.voiceOpen}
            onOpenChange={props.onVoiceOpenChange}
            selectedCustomVoiceId={props.selectedCustomVoiceId}
            customVoices={props.customVoices}
            onSelectCustom={props.onSelectCustomVoice}
            onClone={props.onCloneVoice}
            onRenameCustom={props.onRenameVoice}
            onDeleteCustom={props.onDeleteVoice}
            loading={props.loading}
            variant={props.variant}
          />
        </div>
      </section>
```

Note:
- `useMemo` must be imported in `tts-workspace.tsx` — it already is (line 1: `import { useMemo, useState } from "react";`).
- `STOCK_VOICES` and `Button` are already imported.
- The stock-voice mapping puts `description`/`tone` into `labels`, and omits `previewUrl`, so the preview button is skipped by `VoicePicker`'s existing `preview ?` guard.
- The `selectedVoice` variable computed at the top of `TtsWorkspace` (line 89) is no longer used by `SettingsPanel` — remove it (see Step 5).
- `VoicePickerDialog`'s now-removed props (`selectedId`, `hasVoice`, `search`, `onSearchChange`, `onLoad`, `currentVoiceName`) must be dropped from `TtsWorkspaceProps`/`App` (Steps 4-5).

- [ ] **Step 4: Trim `VoicePickerDialog` to custom voices only**

Rewrite `src/components/voice-picker-dialog.tsx`:

- Remove the `VoiceOrb` import (no longer used after removing the trigger orb + stock grid) and the `STOCK_VOICES` import.
- Replace the props interface:

```tsx
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
```

- Destructure only those props (drop `selectedId`, `hasVoice`, `search`, `onSearchChange`, `onLoad`, `currentVoiceName`).
- Remove the `voices` filter memo, the `selectedStock` lookup, and the `DialogTrigger` (the trigger is now the external "Custom voices" button in `SettingsPanel`). The dialog is fully controlled via `open`/`onOpenChange`.
- Remove the search `Input` and the stock-voices grid (the `{voices.map(...)}` block).
- Keep the `DialogContent` header, the custom-voices section (clone button + list + rename/delete), and the `DialogFooter`.

The trimmed body:

```tsx
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
```

Keep the imports: `Check, ChevronRight, Mic, Pencil, Trash2` — `ChevronRight` is no longer used, so remove it; keep `Mic` (clone button), `Check` (selection), `Pencil`, `Trash2`. Remove `VoiceOrb` and `STOCK_VOICES` imports. Final import line becomes:

```tsx
import { Check, Mic, Pencil, Trash2 } from "lucide-react";
```

(No `ChevronRight`, no `VoiceOrb`, no `STOCK_VOICES`.)

- [ ] **Step 5: Remove dead voice-search plumbing**

In `src/components/tts-workspace.tsx`:
- Delete line 89: `const selectedVoice = STOCK_VOICES.find((voice) => voice.id === props.stockVoice) ?? STOCK_VOICES[0];` (no longer used).
- Remove `voiceSearch: string;` and `onVoiceSearchChange: (value: string) => void;` from the `TtsWorkspaceProps` interface.
- `SettingsPanel` signature stays `({ ...props }: TtsWorkspaceProps & { selectedVoice: (typeof STOCK_VOICES)[number] })` — but since `selectedVoice` is now unused everywhere, change it to `function SettingsPanel(props: TtsWorkspaceProps) {` (drop the `& { selectedVoice: ... }` type and the `{ ...props }` destructure; use `props.` as already done).
- Update the `SettingsPanel` call site in `TtsWorkspace` (line 164): `<SettingsPanel {...props} selectedVoice={selectedVoice} />` becomes `<SettingsPanel {...props} />`.

In `src/App.tsx`:
- Remove `const [voiceSearch, setVoiceSearch] = useState("");` (around line 82).
- Remove `voiceSearch={voiceSearch}` and `onVoiceSearchChange={setVoiceSearch}` from the `<TtsWorkspace ... />` props (around lines 456-457).

- [ ] **Step 6: Verify typecheck + build**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0, no output. (If unused-import errors appear, remove the flagged import.)

Run: `pnpm build`
Expected: exit 0, "built in" line in output.

- [ ] **Step 7: Manual check**

Run `pnpm dev`. In Settings → Voice: the stock picker shows the active voice name (or "Select a voice..." when none loaded), selecting a voice loads it and the popover closes, the selected stock voice shows a checkmark, and "Custom voices" opens the dialog listing only cloned voices with clone/rename/delete.

- [ ] **Step 8: Commit**

```bash
git add src/components/tts-workspace.tsx src/components/ui/voice-picker.tsx src/components/voice-picker-dialog.tsx src/App.tsx
git commit -m "feat(frontend): use ElevenLabs voice picker for stock voices; dialog for custom voices"
```

---

### Task 3: Persist Last Voice + Auto-Load on Launch

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: existing `loadVoice(spec)` and `loadCustomVoice(id)` (already defined in `App.tsx`), `getCustomVoice(id)` from `@/lib/api`, the `modelInfo` state that becomes non-null when the model finishes loading.
- Produces: `warble:last-voice` in localStorage (`{ kind: "stock" | "custom", spec: string }`); auto-load once after model ready; storage cleared when the active custom voice is deleted. No other task consumes this.

- [ ] **Step 1: Add localStorage helpers at module scope**

Add these near `titleFromText` at the bottom of `src/App.tsx`:

```ts
interface LastVoice {
  kind: "stock" | "custom";
  spec: string;
}
const LAST_VOICE_KEY = "warble:last-voice";

function readLastVoice(): LastVoice | null {
  try {
    const raw = localStorage.getItem(LAST_VOICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastVoice;
    if (parsed.kind !== "stock" && parsed.kind !== "custom") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLastVoice(voice: LastVoice) {
  try {
    localStorage.setItem(LAST_VOICE_KEY, JSON.stringify(voice));
  } catch {
    // storage unavailable — non-fatal
  }
}

function clearLastVoice() {
  try {
    localStorage.removeItem(LAST_VOICE_KEY);
  } catch {
    // storage unavailable — non-fatal
  }
}
```

- [ ] **Step 2: Save voice on successful load**

In `loadVoice`, after `setStatus(\`${spec} is ready\`);` (line 232), add:

```ts
      saveLastVoice({ kind: "stock", spec });
```

In `loadCustomVoice`, after `setStatus(\`${record.name} is ready\`);` (line 251), add:

```ts
      saveLastVoice({ kind: "custom", spec: String(id) });
```

- [ ] **Step 3: Clear storage when active custom voice is deleted**

In `handleDeleteVoice` (lines 276-288), inside the `if (selectedCustomVoice?.id === id)` block, add:

```ts
        clearLastVoice();
```

so the block becomes:

```ts
      if (selectedCustomVoice?.id === id) {
        setSelectedCustomVoice(null);
        setVoiceId(null);
        clearLastVoice();
      }
```

- [ ] **Step 4: Auto-load last voice after model ready**

Add a ref near the other refs (after `const lastMetaRef = ...` at line 105):

```ts
  const autoLoadedVoiceRef = useRef(false);
```

Add an effect after the `loadModel` effect (after line 217):

```ts
  useEffect(() => {
    if (!modelInfo || autoLoadedVoiceRef.current) return;
    autoLoadedVoiceRef.current = true;
    const last = readLastVoice();
    if (!last) return;
    if (last.kind === "stock") {
      void loadVoice(last.spec);
    } else {
      const id = Number(last.spec);
      void getCustomVoice(id)
        .then(() => loadCustomVoice(id))
        .catch(() => {
          clearLastVoice();
          void loadVoice("alba");
        });
    }
  }, [modelInfo]);
```

Notes:
- `modelInfo` guards "run once, after the model is ready" — `loadVoice`/`loadCustomVoice` themselves guard `if (!modelInfo)`.
- `autoLoadedVoiceRef` prevents re-triggering when `modelInfo` is replaced on a settings reload.
- `getCustomVoice` failure (record deleted) → clear storage + fall back to the default stock voice `alba`.
- `loadVoice`/`loadCustomVoice`/`getCustomVoice` are in scope (function declarations in the same component).

- [ ] **Step 5: Verify typecheck + build**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0, no output.

Run: `pnpm build`
Expected: exit 0, "built in" line in output.

- [ ] **Step 6: Manual checks**

Run `pnpm dev`.
1. Select a stock voice (e.g. "Marius"), fully restart the app, confirm it auto-loads "Marius" after the model becomes ready (status shows "Marius is ready").
2. Select a cloned custom voice, restart, confirm it auto-loads.
3. Delete the active custom voice, restart — app falls back to "Alba" and the stored key is cleared.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(frontend): remember and auto-load last-used voice on launch"
```

---

## Self-Review Notes

**Spec coverage:**
- Full-width footer → Task 1.
- VoicePicker for stock + dialog for custom + active-voice visibility (trigger name + checkmark) → Task 2.
- localStorage persistence + auto-load + deleted-custom fallback to `alba` + clear-on-delete → Task 3.
- Out-of-scope items (composer text, cloud sync, Rust changes) intentionally omitted.

**Type consistency:** `ElevenLabs.Voice` mapping uses `voiceId` (required string) + `name` + `labels`; `VoicePicker` `value`/`onValueChange` are `string`-typed, matching `props.stockVoice` (string) and `onLoadVoice(id)` (`id` is string). `LastVoice.kind` union matches the read/save/clear helpers. `getCustomVoice(id)` returns a promise rejecting on missing record.
