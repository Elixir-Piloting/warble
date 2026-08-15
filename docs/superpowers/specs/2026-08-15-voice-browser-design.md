# Voice Browser (In-Panel Voice Selector) — Design

Date: 2026-08-15
Status: Approved (design)

## Summary

Rework the voice selector in the Settings sidebar. Replace the current
`VoicePicker` combobox (stock voices) + "Custom voices" button + `VoicePickerDialog`
flow with a single **voice button** that, when clicked, swaps the Settings panel
content for a **voice browser** with two tabs: **Pre-built** (stock voices) and
**My voices** (cloned voices with management actions). Selecting a voice
auto-returns to the Settings panel; a Back button returns without changing.

## Background

- `src/components/tts-workspace.tsx` renders the app shell. The Settings sidebar
  panel (`SettingsPanel`, ~lines 257-348) currently contains:
  - a Voice section: `VoicePicker` (ElevenLabs combobox for stock voices) +
    a "Custom voices" `Button` that opens `VoicePickerDialog` (controlled via
    `props.voiceOpen`/`props.onVoiceOpenChange`),
  - Model section, GenerationSettingsPanel, Output section.
- `src/components/ui/voice-picker.tsx` — the ElevenLabs `VoicePicker` combobox
  (uses `AudioPlayerProvider`, `Command`, `Popover`, `Orb`). To be replaced.
- `src/components/voice-picker-dialog.tsx` — custom-voices-only dialog with
  clone/rename/delete. To be replaced by the My voices tab content.
- `src/components/voice-orb.tsx` — `VoiceOrb` component (orb graphic, pulsing
  when `active`). Reused.
- `STOCK_VOICES` (`src/components/voice-data.ts`): `{ id, name, description, tone }`.
- `TtsWorkspaceProps` carries: `voiceId`, `stockVoice`, `voiceOpen`, `onVoiceOpenChange`,
  `voiceSearch`, `onVoiceSearchChange`, `onLoadVoice`, `customVoices`,
  `selectedCustomVoiceId`, `onSelectCustomVoice`, `onCloneVoice`, `onRenameVoice`,
  `onDeleteVoice`, `currentVoiceName`, `loading`, `variant`.
- `VoiceRecord` (`src/lib/api.ts`): `{ id, name, source, durationSec, ... }`.

## Design

### 1. Voice button (replaces combobox + Custom voices button)

In `SettingsPanel`, the Voice section becomes a single full-width button:

- Shows the current voice:
  - orb (`VoiceOrb`, active when a voice is loaded) + voice name + subtitle
    (`Custom voice` when a custom voice is active; the stock voice `description`
    when a stock voice is active; `Select a voice...` + "Browse voice library"
    hint when none is loaded) + a chevron.
- Clicking it opens the voice browser (sets a local `browserOpen` state).
- This replaces the `VoicePicker` import usage and the `VoicePickerDialog`
  usage in `SettingsPanel`.

### 2. Voice browser component

New component `VoiceBrowser` (new file `src/components/voice-browser.tsx`)
rendered **in place of the Settings panel content** when `browserOpen` is true.
It does NOT replace the sidebar tab strip — the Settings/History tabs stay
visible; only the panel content area swaps.

Structure:
- Header: a Back button (arrow-left icon) + "Voice" title.
- Two tabs, matching the existing `TabButton` style used for Settings/History:
  - **Pre-built** — a search input + a list of `STOCK_VOICES`. Each row:
    `VoiceOrb` (active when this is the loaded stock voice), name + description,
    checkmark on active. Selecting calls `onLoadVoice(voice.id)` and auto-returns.
    The search filter uses local state inside `VoiceBrowser` (the old
    `voiceSearch`/`onVoiceSearchChange` plumbing was removed in the prior
    feature — do not reintroduce it).
  - **My voices** — "Clone a voice" button, then the custom-voice list from the
    current `VoicePickerDialog`: each row has select (name + source/duration,
    checkmark on active) plus inline rename/delete. Selecting calls
    `onSelectCustomVoice(voice.id)` and auto-returns.
- Footer: `Current model · {variant}` (moved from the dialog footer).

Props (all already available via `TtsWorkspaceProps`):
```
voiceId: string | null
stockVoice: string
onLoadVoice: (spec?: string) => void
customVoices: VoiceRecord[]
selectedCustomVoiceId: number | null
onSelectCustomVoice: (id: number) => void
onCloneVoice: () => void
onRenameVoice: (id: number, name: string) => void
onDeleteVoice: (id: number) => void
loading: boolean
variant: string
onBack: () => void
```

### 3. State flow

- `SettingsPanel` gains a local `browserOpen` state (`useState(false)`).
- When `browserOpen` is false → render the normal settings sections (with the
  voice button in the Voice section).
- When `browserOpen` is true → render `VoiceBrowser` instead of the sections.
- Auto-return: the handlers passed to `VoiceBrowser` for stock select and
  custom select wrap the existing props handlers and then set `browserOpen` false.
- Back button sets `browserOpen` false.

### 4. Component removal

- `src/components/ui/voice-picker.tsx` — no longer used by `tts-workspace.tsx`;
  delete the file (and, if no other consumer, its now-unused imports elsewhere).
  Check consumers before deleting.
- `src/components/voice-picker-dialog.tsx` — replaced by `VoiceBrowser`; delete.
- `voiceOpen`/`onVoiceOpenChange` become unused by the new flow. `App.tsx`
  currently holds `voiceOpen`/`setVoiceOpen` state used only to control the old
  dialog. Remove that state and the `voiceOpen`/`onVoiceOpenChange` props from
  `TtsWorkspaceProps`.
- `App.tsx` `handleDeleteVoice` still clears the stored voice (voice memory from
  the prior feature) — unchanged.

## Files Touched

- Modify: `src/components/tts-workspace.tsx` — Voice section → button; render
  `VoiceBrowser` when open; remove `VoicePicker`/`VoicePickerDialog` usage and
  `voiceOpen`/`onVoiceOpenChange` props.
- Create: `src/components/voice-browser.tsx` — the new component.
- Delete: `src/components/voice-picker-dialog.tsx`.
- Delete: `src/components/ui/voice-picker.tsx` (verify no other consumers).
- Modify: `src/App.tsx` — remove `voiceOpen` state and its props; keep voice
  memory and all voice handlers.

## Out of Scope

- Changing voice memory behavior (last-voice auto-load) — unchanged.
- Previews/audio in the voice lists (no `previewUrl` for stock voices; cloned
  voice audio previews are not wired in this app).
- Reintroducing the ElevenLabs `Orb`/combobox UI.

## Testing / Verification

- `pnpm exec tsc --noEmit` and `pnpm build` pass (no test runner exists).
- Manual: Settings → Voice shows current voice button; clicking swaps panel to
  browser with Pre-built + My voices tabs; selecting a stock voice loads + auto
  returns; selecting a cloned voice loads + auto returns; rename/delete work in
  My voices; Back returns without change; voice memory still auto-loads.
