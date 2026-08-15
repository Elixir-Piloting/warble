# Full-Width Audio Footer + Voice Picker & Voice Memory

Date: 2026-08-15
Status: Approved (design)

## Summary

Three related changes to the Warble frontend:

1. Make the generated-audio player footer at the bottom of the screen span the
   full window width, including underneath the Settings/History sidebar.
2. Replace the stock-voice portion of the voice selector with the new
   ElevenLabs `VoicePicker` component, surfacing the currently active voice
   clearly. Keep the existing `VoicePickerDialog` for custom-voice management
   (clone / rename / delete).
3. Persist the last-loaded voice in `localStorage` and auto-load it on launch
   once the model is ready, so the user does not have to re-choose a voice
   every session.

## Background

- `src/components/tts-workspace.tsx` renders the shell:
  - outer: `grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_460px]`
  - `<main>` = editor (textarea + controls) + `GeneratedAudioPlayer` footer
    in a nested `grid-rows-[minmax(0,1fr)_auto]`
  - `<aside>` = Settings / History tabs (460px)
- The `GeneratedAudioPlayer` footer currently sits *inside* `<main>`, so it
  spans only the left column — it does not extend under the sidebar.
- Voice selection today uses `VoicePickerDialog` (trigger button + dialog with
  stock voices grid and custom-voice management).
- The new `VoicePicker` component lives at
  `src/components/ui/voice-picker.tsx` and takes `ElevenLabs.Voice[]` with
  `voiceId`, `name`, `labels`, optional `previewUrl`. It uses `AudioPlayerProvider`,
  `Command`, `Popover`, `Orb` — all already installed.
- App state lives in `src/App.tsx`. Voices load via `loadVoice(stockSpec)`
  (stock) and `loadCustomVoice(id)` (custom). `STOCK_VOICES` from
  `src/components/voice-data.ts` has `{ id, name, description, tone }`.
- No storage layer exists yet in the app (no `localStorage` usage found).

## 1. Full-Width Footer

Restructure the shell in `tts-workspace.tsx`:

```
<div class="bg-background text-foreground h-screen overflow-hidden">
  <div class="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
    <div class="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_460px]">
      <main>...editor only...</main>
      <aside>...tabs...</aside>
    </div>
    {showTransport && <GeneratedAudioPlayer ... />}
  </div>
</div>
```

- The 2-column grid (editor | sidebar) becomes the top row.
- `GeneratedAudioPlayer` moves from inside `<main>` to be the second row of
  the outer grid, spanning the full window width.
- `<main>` loses its `grid-rows-[minmax(0,1fr)_auto]` wrapper; it becomes a
  plain `min-h-0 min-w-0` grid cell containing only the scrollable editor
  section.
- Footer visibility unchanged: only rendered when `currentClip && generatedAudioSrc`.
- No change to `GeneratedAudioPlayer` internals or the `AudioPlayerProvider`.

## 2. Voice Picker

In the Settings panel (`SettingsPanel`):

- Replace the `VoicePickerDialog` trigger with the new `VoicePicker` for stock
  voices.
  - Map `STOCK_VOICES` → `ElevenLabs.Voice` shape:
    `{ voiceId: id, name, labels: { description, tone }, previewUrl: undefined }`.
    With no `previewUrl`, the component skips the preview orb button (it
    already guards on `voice.previewUrl`).
  - `value` = active stock voice id; `onValueChange` → `onLoadVoice(id)`.
  - Selected item is marked with a visible `Check` (component computes
    `isSelected`); the trigger shows the orb + active voice name so the current
    voice is obvious without opening the picker.
- Below the `VoicePicker`, add a secondary "Custom voices" entry (button) that
  opens the existing `VoicePickerDialog` for custom-voice management
  (clone / rename / delete). The dialog's stock-voice grid is removed from it —
  custom voices only. Reuse the dialog component but drop the stock grid, since
  custom management is its only remaining job.
- `selectedId` for the picker should reflect the active stock voice. When a
  custom voice is active, the picker shows no selected stock item but the
  trigger/orb reflects "custom voice active" via existing `currentVoiceName`
  flow.

## 3. Voice Memory (localStorage)

- Key: `warble:last-voice`
- Shape: `{ kind: "stock" | "custom", spec: string }` where `spec` is the stock
  voice id (`"alba"`, ...) or the custom voice record id (`number` serialized
  as string).
- Written whenever a voice loads successfully:
  - `loadVoice(spec)` → store `{ kind: "stock", spec }`
  - `loadCustomVoice(id)` → store `{ kind: "custom", spec: String(id) }`
- Cleared when the active custom voice is deleted (`handleDeleteVoice`).
- On launch:
  - After the model finishes loading (`modelInfo` becomes non-null in the
    `loadModel` effect), read `warble:last-voice`.
  - If `kind === "stock"` → call `loadVoice(spec)`.
  - If `kind === "custom"` → call `loadCustomVoice(Number(spec))`; if the
    record no longer exists (throws), fall back to the default stock voice
    (`loadVoice("alba")`) and rewrite storage.
  - If no stored voice → no auto-load (current behavior).
- Guard against double-load / races with the model-load effect; auto-load must
  run once and only after the model is ready. A small state flag or effect
  dependency on `modelInfo` handles this.

## Files Touched

- `src/components/tts-workspace.tsx` — shell restructure; Settings panel picker
  wiring; custom-voices button.
- `src/App.tsx` — `warble:last-voice` read/write/clear; auto-load-on-launch
  effect.
- `src/components/voice-picker-dialog.tsx` — remove the stock-voice grid so it
  serves custom-voice management only.

## Out of Scope

- Persisting composer text (rejected — user chose voice-only memory).
- Server/cloud voice sync.
- Replacing the custom-voice dialog with the new picker entirely.
- Changing the Rust side (no new Tauri commands).

## Testing / Verification

- `pnpm exec tsc --noEmit` and `pnpm build` pass.
- Manual: generate a clip → footer spans full width under the sidebar.
- Manual: select a voice, restart app → same voice auto-loads after model ready.
- Manual: delete the stored custom voice → launch falls back to `alba`.
