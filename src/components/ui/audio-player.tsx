"use client"

import { ComponentProps, createContext, HTMLProps, ReactNode, RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { Check, PauseIcon, PlayIcon, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

function formatTime(seconds: number) { const hrs = Math.floor(seconds / 3600); const mins = Math.floor((seconds % 3600) / 60); const secs = Math.floor(seconds % 60); const mm = mins < 10 ? `0${mins}` : mins; const ss = secs < 10 ? `0${secs}` : secs; return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mins}:${ss}` }
export interface AudioPlayerItem<TData = unknown> { id: string | number; src: string; data?: TData }
interface AudioPlayerApi<TData = unknown> { ref: RefObject<HTMLAudioElement | null>; activeItem: AudioPlayerItem<TData> | null; duration: number | undefined; error: MediaError | null; isPlaying: boolean; isBuffering: boolean; playbackRate: number; isItemActive: (id: string | number | null) => boolean; setActiveItem: (item: AudioPlayerItem<TData> | null) => Promise<void>; play: (item?: AudioPlayerItem<TData> | null) => Promise<void>; pause: () => void; seek: (time: number) => void; setPlaybackRate: (rate: number) => void }
const AudioPlayerContext = createContext<AudioPlayerApi<unknown> | null>(null)
export function useAudioPlayer<TData = unknown>() { const api = useContext(AudioPlayerContext) as AudioPlayerApi<TData> | null; if (!api) throw new Error("useAudioPlayer cannot be called outside of AudioPlayerProvider"); return api }
const AudioPlayerTimeContext = createContext<number | null>(null)
export function useAudioPlayerTime() { const time = useContext(AudioPlayerTimeContext); if (time === null) throw new Error("useAudioPlayerTime cannot be called outside of AudioPlayerProvider"); return time }

export function AudioPlayerProvider<TData = unknown>({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLAudioElement>(null); const itemRef = useRef<AudioPlayerItem<TData> | null>(null); const promiseRef = useRef<Promise<void> | null>(null)
  const [activeItem, setActive] = useState<AudioPlayerItem<TData> | null>(null); const [time, setTime] = useState(0); const [duration, setDuration] = useState<number>(); const [error, setError] = useState<MediaError | null>(null); const [paused, setPaused] = useState(true); const [buffering, setBuffering] = useState(false); const [rate, setRate] = useState(1)
  const setActiveItem = useCallback(async (item: AudioPlayerItem<TData> | null) => { if (!ref.current || item?.id === itemRef.current?.id) return; itemRef.current = item; ref.current.pause(); ref.current.currentTime = 0; if (item) ref.current.src = item.src; else ref.current.removeAttribute("src"); ref.current.load(); ref.current.playbackRate = rate; setActive(item) }, [rate])
  const play = useCallback(async (item?: AudioPlayerItem<TData> | null) => { if (!ref.current) return; if (promiseRef.current) await promiseRef.current.catch(() => undefined); if (item !== undefined && item?.id !== itemRef.current?.id) await setActiveItem(item); const p = ref.current.play(); promiseRef.current = p; return p }, [setActiveItem])
  const pause = useCallback(() => { ref.current?.pause(); promiseRef.current = null }, [])
  const seek = useCallback((value: number) => { if (ref.current) ref.current.currentTime = value }, [])
  const setPlaybackRate = useCallback((value: number) => { if (ref.current) ref.current.playbackRate = value; setRate(value) }, [])
  useEffect(() => { let frame = 0; const tick = () => { const audio = ref.current; if (audio) { setActive(itemRef.current); setTime(audio.currentTime); setDuration(Number.isFinite(audio.duration) ? audio.duration : undefined); setPaused(audio.paused); setError(audio.error); setBuffering(audio.readyState < 3 && audio.networkState === 2); setRate(audio.playbackRate) }; frame = requestAnimationFrame(tick) }; frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame) }, [])
  const api = useMemo(() => ({ ref, activeItem, duration, error, isPlaying: !paused, isBuffering: buffering, playbackRate: rate, isItemActive: (id: string | number | null) => activeItem?.id === id, setActiveItem, play, pause, seek, setPlaybackRate }), [activeItem, duration, error, paused, buffering, rate, setActiveItem, play, pause, seek, setPlaybackRate])
  return <AudioPlayerContext.Provider value={api as AudioPlayerApi<unknown>}><AudioPlayerTimeContext.Provider value={time}><audio ref={ref} className="hidden" crossOrigin="anonymous" />{children}</AudioPlayerTimeContext.Provider></AudioPlayerContext.Provider>
}

export function AudioPlayerProgress(props: Omit<ComponentProps<typeof SliderPrimitive.Root>, "min" | "max" | "value">) { const player = useAudioPlayer(); const time = useAudioPlayerTime(); return <SliderPrimitive.Root {...props} value={[time]} min={0} max={player.duration ?? 0} step={props.step ?? 0.25} onValueChange={(v) => { player.seek(v[0]); props.onValueChange?.(v) }} className={cn("group/player relative flex h-4 touch-none items-center select-none", props.className)} disabled={!player.duration || !Number.isFinite(player.duration)}><SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted"><SliderPrimitive.Range className="absolute h-full bg-primary" /></SliderPrimitive.Track><SliderPrimitive.Thumb className="size-3 rounded-full bg-foreground opacity-0 group-hover/player:opacity-100 focus-visible:opacity-100" /></SliderPrimitive.Root> }
export function AudioPlayerTime({ className, ...props }: HTMLProps<HTMLSpanElement>) { return <span {...props} className={cn("text-xs tabular-nums text-muted-foreground", className)}>{formatTime(useAudioPlayerTime())}</span> }
export function AudioPlayerDuration({ className, ...props }: HTMLProps<HTMLSpanElement>) { const duration = useAudioPlayer().duration; return <span {...props} className={cn("text-xs tabular-nums text-muted-foreground", className)}>{duration === undefined ? "--:--" : formatTime(duration)}</span> }
export interface AudioPlayerButtonProps<TData = unknown> extends ComponentProps<typeof Button> { item?: AudioPlayerItem<TData> }
export function AudioPlayerButton<TData = unknown>({ item, ...props }: AudioPlayerButtonProps<TData>) { const player = useAudioPlayer<TData>(); const active = item ? player.isItemActive(item.id) : true; return <Button {...props} type="button" aria-label={active && player.isPlaying ? "Pause" : "Play"} onClick={() => { if (active && player.isPlaying) player.pause(); else void player.play(item) }}>{active && player.isPlaying ? <PauseIcon /> : <PlayIcon />}</Button> }
const SPEEDS = [0.5, 1, 1.5, 2] as const
export interface AudioPlayerSpeedProps extends ComponentProps<typeof Button> { speeds?: readonly number[] }
export function AudioPlayerSpeed({ speeds = SPEEDS, variant = "ghost", size = "icon", ...props }: AudioPlayerSpeedProps) { const player = useAudioPlayer(); return <DropdownMenu><DropdownMenuTrigger asChild><Button {...props} variant={variant} size={size} aria-label="Playback speed"><Settings /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{speeds.map((speed) => <DropdownMenuItem key={speed} onClick={() => player.setPlaybackRate(speed)} className="flex items-center justify-between"><span>{speed}x</span>{player.playbackRate === speed && <Check />}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu> }
