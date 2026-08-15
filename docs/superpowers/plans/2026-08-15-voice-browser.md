# In-Panel Voice Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the combobox + dialog voice selector with a voice button that opens an in-panel Voice Browser (Pre-built / My voices tabs) in the Settings sidebar.

**Architecture:** Two changes. (1) A new self-contained `VoiceBrowser` component (`src/components/voice-browser.tsx`) renders two tabs — Pre-built stock voices (search + list) and My voices (clone/select/rename/delete) — with a Back button and a `Current model · {variant}` footer. (2) `SettingsPanel` gets a local `browserOpen` state: when closed it shows the normal settings sections with a single voice button (orb + name + subtitle + chevron) in the Voice section; when open it renders `VoiceBrowser` in place of the sections. `voiceOpen`/`onVoiceOpenChange` plumbing is removed from `App.tsx` and `TtsWorkspaceProps`, and the old `VoicePicker`/`VoicePickerDialog` files are deleted.

**Tech Stack:** React 19, Vite 7, Tailwind v4, shadcn/ui, lucide-react, Radix, Tauri v2 shell.

## Global Constraints

- TypeScript `strict` with `noUnusedLocals`/`noUnusedParameters` — the build fails on unused imports/props. Removing the old components requires cleaning their imports in the same commit.
- No test runner exists. Verification = `pnpm exec tsc --noEmit` (exit 0, no output) + `pnpm build` (exit 0).
- Prettier: `semi: true`, `trailingComma: "es5"`, `printWidth: 120`, `singleQuote: false`, `tabWidth: 2`, tailwind plugin. The app's own components use trailing semicolons.
- `@/` alias → `src/`. `STOCK_VOICES` (`src/components/voice-data.ts`) items are `{ id, name, description, tone }`. `VoiceOrb` (`src/components/voice-orb.tsx`) renders `{ active?: boolean }`.
- `TtsWorkspaceProps` lives in `src/components/tts-workspace.tsx`; `App.tsx` is the state owner.
- The spec: `docs/superpowers/specs/2026-08-15-voice-browser-design.md`.

---

### Task 1: Create the VoiceBrowser Component

**Files:**
- Create: `src/components/voice-browser.tsx`

**Interfaces:**
- Consumes: `STOCK_VOICES`, `VoiceOrb`, `Button`, `Input` from `@/components/ui/*`, `VoiceRecord` type from `@/lib/api`, lucide icons.
- Produces: `export function VoiceBrowser(props: VoiceBrowserProps)` where
  `VoiceBrowserProps` is exactly:
  ```ts
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
  ```
  Task 2 consumes this exact signature.

- [ ] **Step 1: Write the component**

Create `src/components/voice-browser.tsx` with this full content:

```tsx
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
```

- [ ] **Step 2: Verify typecheck + build**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0, no output. (The file is not imported anywhere yet, so `noUnusedLocals` does not flag it.)

Run: `pnpm build`
Expected: exit 0, "built in" line.

- [ ] **Step 3: Commit**

```bash
git add src/components/voice-browser.tsx
git commit -m "feat(frontend): add in-panel voice browser component"
```

---

### Task 2: Wire Voice Button + Browser, Remove Old Flow

**Files:**
- Modify: `src/components/tts-workspace.tsx`
- Modify: `src/App.tsx`
- Delete: `src/components/voice-picker-dialog.tsx`
- Delete: `src/components/ui/voice-picker.tsx`

**Interfaces:**
- Consumes: `VoiceBrowser` from `@/components/voice-browser` (Task 1 signature), `VoiceOrb` from `@/components/voice-orb`, existing `TtsWorkspaceProps` minus `voiceOpen`/`onVoiceOpenChange`.
- Produces: `TtsWorkspaceProps` without `voiceOpen`/`onVoiceOpenChange`; `SettingsPanel` with local `browserOpen` state; `App.tsx` without `voiceOpen` state. `voiceSearch`/`onVoiceSearchChange` are NOT reintroduced (the browser owns its search locally).

- [ ] **Step 1: Update imports in `tts-workspace.tsx`**

Remove:
```tsx
import { VoicePicker } from "@/components/ui/voice-picker";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { VoicePickerDialog } from "@/components/voice-picker-dialog";
```

Add (keep imports grouped with the other component imports):
```tsx
import { VoiceBrowser } from "@/components/voice-browser";
import { VoiceOrb } from "@/components/voice-orb";
```

Update the lucide import (line 2) to drop `Mic` and add `ChevronRight`:
```tsx
import { ChevronRight, Download, FileAudio, Gauge, History, LoaderCircle, Pause, Play, Search, Sparkles, Square } from "lucide-react";
```

- [ ] **Step 2: Remove `voiceOpen`/`onVoiceOpenChange` from `TtsWorkspaceProps`**

Delete these two lines from the interface (currently lines 59-60):
```tsx
  voiceOpen: boolean;
  onVoiceOpenChange: (open: boolean) => void;
```

- [ ] **Step 3: Rewrite `SettingsPanel`**

Replace the whole `SettingsPanel` function (currently lines 257-348). It currently starts:

```tsx
function SettingsPanel(props: TtsWorkspaceProps) {
  const stockVoices = useMemo<ElevenLabs.Voice[]>(() => ..., []);
  const hasActiveStockVoice = ...;

  return (
    <div className="flex flex-col gap-7 p-5">
      <section>
        <h2 className="text-sm font-medium">Voice</h2>
        <div className="mt-3 flex flex-col gap-2">
          <VoicePicker ... />
          <Button ... onClick={() => props.onVoiceOpenChange(true)}>... Custom voices</Button>
          <VoicePickerDialog ... />
        </div>
      </section>
      ... Model, GenerationSettingsPanel, Output sections ...
    </div>
  );
}
```

New version — note `useMemo` is no longer used here but IS still used in `HistoryPanel` (keep the `useMemo` import):

```tsx
function SettingsPanel(props: TtsWorkspaceProps) {
  const [browserOpen, setBrowserOpen] = useState(false);

  if (browserOpen) {
    return (
      <VoiceBrowser
        voiceId={props.voiceId}
        stockVoice={props.stockVoice}
        onLoadVoice={(id) => {
          props.onLoadVoice(id);
          setBrowserOpen(false);
        }}
        customVoices={props.customVoices}
        selectedCustomVoiceId={props.selectedCustomVoiceId}
        onSelectCustomVoice={(id) => {
          props.onSelectCustomVoice(id);
          setBrowserOpen(false);
        }}
        onCloneVoice={props.onCloneVoice}
        onRenameVoice={props.onRenameVoice}
        onDeleteVoice={props.onDeleteVoice}
        loading={props.loading}
        variant={props.variant}
        onBack={() => setBrowserOpen(false)}
      />
    );
  }

  const stockDescription = STOCK_VOICES.find((voice) => voice.id === props.stockVoice)?.description ?? "Stock voice";

  return (
    <div className="flex flex-col gap-7 p-5">
      <section>
        <h2 className="text-sm font-medium">Voice</h2>
        <button
          onClick={() => setBrowserOpen(true)}
          className="hover:bg-accent mt-3 flex min-h-12 w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors"
        >
          <VoiceOrb active={Boolean(props.voiceId)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {props.voiceId ? props.currentVoiceName : "Select a voice..."}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {props.voiceId
                ? props.selectedCustomVoiceId != null
                  ? "Custom voice"
                  : stockDescription
                : "Browse voice library"}
            </span>
          </span>
          <ChevronRight className="text-muted-foreground size-4" />
        </button>
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
```

- [ ] **Step 4: Remove `voiceOpen` plumbing in `App.tsx`**

Delete line 81 (`const [voiceOpen, setVoiceOpen] = useState(false);`).

Remove these two props from the `<TtsWorkspace ... />` call (currently lines 482-483):
```tsx
        voiceOpen={voiceOpen}
        onVoiceOpenChange={setVoiceOpen}
```

- [ ] **Step 5: Delete the old components**

```bash
git rm src/components/voice-picker-dialog.tsx
git rm src/components/ui/voice-picker.tsx
```

- [ ] **Step 6: Verify typecheck + build**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0, no output. If unused-import errors appear, remove the flagged import.

Run: `pnpm build`
Expected: exit 0, "built in" line.

- [ ] **Step 7: Manual checks**

Run `pnpm dev`:
1. Settings → Voice shows the current-voice button (orb + name + subtitle).
2. Click it → panel swaps to the browser with Pre-built / My voices tabs; Settings/History tab strip stays visible.
3. Pre-built: search filters stock voices; selecting one loads it, shows checkmark briefly, and auto-returns to Settings.
4. My voices: "Clone a voice" opens the clone wizard; selecting a clone auto-returns; rename/delete work inline.
5. Back button returns to Settings without changing the voice.
6. Voice memory still auto-loads the last voice on launch.

- [ ] **Step 8: Commit**

```bash
git add src/components/tts-workspace.tsx src/App.tsx src/components/voice-picker-dialog.tsx src/components/ui/voice-picker.tsx
git commit -m "feat(frontend): replace voice picker with in-panel voice browser"
```

---

## Self-Review Notes

**Spec coverage:** voice button (Task 2 Step 3), browser with two tabs + Back + footer (Task 1), auto-return on select (Task 2 Step 3 wrappers), My voices management actions (Task 1), component deletions + `voiceOpen` removal (Task 2 Steps 2/4/5), `voiceSearch` not reintroduced (Global Constraints + Task 2 Interfaces).

**Type consistency:** `VoiceBrowserProps` in Task 1 matches the props passed in Task 2 Step 3 exactly (names and types). `VoiceRecord`/`VoiceOrb`/`STOCK_VOICES` usages match their definitions. `useMemo` remains imported (used by `HistoryPanel`).

**Placeholder scan:** All steps contain complete code or exact commands; no TBD/TODO.
