You are given a task to integrate an existing React component in the codebase

The codebase should support:

- shadcn project structure  

- Tailwind CSS

- Typescript

If it doesn't, provide instructions on how to setup project via shadcn CLI, install Tailwind or Typescript.

Determine the default path for components and styles. 

If default path for components is not /components/ui, provide instructions on why it's important to create this folder

Copy-paste this component to /components/ui folder:

```tsx

audio-player.tsx

"use client"

import {

  ComponentProps,

  createContext,

  HTMLProps,

  ReactNode,

  RefObject,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useRef,

  useState,

} from "react"

import * as SliderPrimitive from "@radix-ui/react-slider"

import { Check, PauseIcon, PlayIcon, Settings } from "lucide-react"

import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"

import {

  DropdownMenu,

  DropdownMenuContent,

  DropdownMenuItem,

  DropdownMenuTrigger,

} from "@/components/ui/dropdown-menu"

enum ReadyState {

  HAVE_NOTHING = 0,

  HAVE_METADATA = 1,

  HAVE_CURRENT_DATA = 2,

  HAVE_FUTURE_DATA = 3,

  HAVE_ENOUGH_DATA = 4,

}

enum NetworkState {

  NETWORK_EMPTY = 0,

  NETWORK_IDLE = 1,

  NETWORK_LOADING = 2,

  NETWORK_NO_SOURCE = 3,

}

function formatTime(seconds: number) {

  const hrs = Math.floor(seconds / 3600)

  const mins = Math.floor((seconds % 3600) / 60)

  const secs = Math.floor(seconds % 60)

  const formattedMins = mins &lt; 10 ? `0${mins}` : mins

  const formattedSecs = secs &lt; 10 ? `0${secs}` : secs

  return hrs &gt; 0

    ? `${hrs}:${formattedMins}:${formattedSecs}`

    : `${mins}:${formattedSecs}`

}

interface AudioPlayerItem&lt;TData = unknown&gt; {

  id: string | number

  src: string

  data?: TData

}

interface AudioPlayerApi&lt;TData = unknown&gt; {

  ref: RefObject&lt;HTMLAudioElement | null&gt;

  activeItem: AudioPlayerItem&lt;TData&gt; | null

  duration: number | undefined

  error: MediaError | null

  isPlaying: boolean

  isBuffering: boolean

  playbackRate: number

  isItemActive: (id: string | number | null) =&gt; boolean

  setActiveItem: (item: AudioPlayerItem&lt;TData&gt; | null) =&gt; Promise&lt;void&gt;

  play: (item?: AudioPlayerItem&lt;TData&gt; | null) =&gt; Promise&lt;void&gt;

  pause: () =&gt; void

  seek: (time: number) =&gt; void

  setPlaybackRate: (rate: number) =&gt; void

}

const AudioPlayerContext = createContext&lt;AudioPlayerApi&lt;unknown&gt; | null&gt;(null)

export function useAudioPlayer&lt;TData = unknown&gt;(): AudioPlayerApi&lt;TData&gt; {

  const api = useContext(AudioPlayerContext) as AudioPlayerApi&lt;TData&gt; | null

  if (!api) {

    throw new Error(

      "useAudioPlayer cannot be called outside of AudioPlayerProvider"

    )

  }

  return api

}

const AudioPlayerTimeContext = createContext&lt;number | null&gt;(null)

export const useAudioPlayerTime = () =&gt; {

  const time = useContext(AudioPlayerTimeContext)

  if (time === null) {

    throw new Error(

      "useAudioPlayerTime cannot be called outside of AudioPlayerProvider"

    )

  }

  return time

}

export function AudioPlayerProvider&lt;TData = unknown&gt;({

  children,

}: {

  children: ReactNode

}) {

  const audioRef = useRef&lt;HTMLAudioElement&gt;(null)

  const itemRef = useRef&lt;AudioPlayerItem&lt;TData&gt; | null&gt;(null)

  const playPromiseRef = useRef&lt;Promise&lt;void&gt; | null&gt;(null)

  const [readyState, setReadyState] = useState&lt;number&gt;(0)

  const [networkState, setNetworkState] = useState&lt;number&gt;(0)

  const [time, setTime] = useState&lt;number&gt;(0)

  const [duration, setDuration] = useState&lt;number | undefined&gt;(undefined)

  const [error, setError] = useState&lt;MediaError | null&gt;(null)

  const [activeItem, _setActiveItem] = useState&lt;AudioPlayerItem&lt;TData&gt; | null&gt;(

    null

  )

  const [paused, setPaused] = useState(true)

  const [playbackRate, setPlaybackRateState] = useState&lt;number&gt;(1)

  const setActiveItem = useCallback(

    async (item: AudioPlayerItem&lt;TData&gt; | null) =&gt; {

      if (!audioRef.current) return

      if (item?.id === itemRef.current?.id) {

        return

      }

      itemRef.current = item

      const currentRate = audioRef.current.playbackRate

      audioRef.current.pause()

      audioRef.current.currentTime = 0

      if (item === null) {

        audioRef.current.removeAttribute("src")

      } else {

        audioRef.current.src = item.src

      }

      audioRef.current.load()

      audioRef.current.playbackRate = currentRate

    },

    []

  )

  const play = useCallback(

    async (item?: AudioPlayerItem&lt;TData&gt; | null) =&gt; {

      if (!audioRef.current) return

      if (playPromiseRef.current) {

        try {

          await playPromiseRef.current

        } catch (error) {

          console.error("Play promise error:", error)

        }

      }

      if (item === undefined) {

        const playPromise = [audioRef.current.play](http://audioRef.current.play)()

        playPromiseRef.current = playPromise

        return playPromise

      }

      if (item?.id === activeItem?.id) {

        const playPromise = [audioRef.current.play](http://audioRef.current.play)()

        playPromiseRef.current = playPromise

        return playPromise

      }

      itemRef.current = item

      const currentRate = audioRef.current.playbackRate

      if (!audioRef.current.paused) {

        audioRef.current.pause()

      }

      audioRef.current.currentTime = 0

      if (item === null) {

        audioRef.current.removeAttribute("src")

      } else {

        audioRef.current.src = item.src

      }

      audioRef.current.load()

      audioRef.current.playbackRate = currentRate

      const playPromise = [audioRef.current.play](http://audioRef.current.play)()

      playPromiseRef.current = playPromise

      return playPromise

    },

    [activeItem]

  )

  const pause = useCallback(async () =&gt; {

    if (!audioRef.current) return

    if (playPromiseRef.current) {

      try {

        await playPromiseRef.current

      } catch (e) {

        console.error(e)

      }

    }

    audioRef.current.pause()

    playPromiseRef.current = null

  }, [])

  const seek = useCallback((time: number) =&gt; {

    if (!audioRef.current) return

    audioRef.current.currentTime = time

  }, [])

  const setPlaybackRate = useCallback((rate: number) =&gt; {

    if (!audioRef.current) return

    audioRef.current.playbackRate = rate

    setPlaybackRateState(rate)

  }, [])

  const isItemActive = useCallback(

    (id: string | number | null) =&gt; {

      return activeItem?.id === id

    },

    [activeItem]

  )

  useAnimationFrame(() =&gt; {

    if (audioRef.current) {

      _setActiveItem(itemRef.current)

      setReadyState(audioRef.current.readyState)

      setNetworkState(audioRef.current.networkState)

      setTime(audioRef.current.currentTime)

      setDuration(audioRef.current.duration)

      setPaused(audioRef.current.paused)

      setError(audioRef.current.error)

      setPlaybackRateState(audioRef.current.playbackRate)

    }

  })

  const isPlaying = !paused

  const isBuffering =

    readyState &lt; ReadyState.HAVE_FUTURE_DATA &amp;&amp;

    networkState === [NetworkState.NETWORK](http://NetworkState.NETWORK)_LOADING

  const api = useMemo&lt;AudioPlayerApi&lt;TData&gt;&gt;(

    () =&gt; ({

      ref: audioRef,

      duration,

      error,

      isPlaying,

      isBuffering,

      activeItem,

      playbackRate,

      isItemActive,

      setActiveItem,

      play,

      pause,

      seek,

      setPlaybackRate,

    }),

    [

      audioRef,

      duration,

      error,

      isPlaying,

      isBuffering,

      activeItem,

      playbackRate,

      isItemActive,

      setActiveItem,

      play,

      pause,

      seek,

      setPlaybackRate,

    ]

  )

  return (

    &lt;AudioPlayerContext.Provider value={api as AudioPlayerApi&lt;unknown&gt;}&gt;

      &lt;AudioPlayerTimeContext.Provider value={time}&gt;

        &lt;audio ref={audioRef} className="hidden" crossOrigin="anonymous" /&gt;

        {children}

      &lt;/AudioPlayerTimeContext.Provider&gt;

    &lt;/AudioPlayerContext.Provider&gt;

  )

}

export const AudioPlayerProgress = ({

  ...otherProps

}: Omit&lt;

  ComponentProps&lt;typeof SliderPrimitive.Root&gt;,

  "min" | "max" | "value"

&gt;) =&gt; {

  const player = useAudioPlayer()

  const time = useAudioPlayerTime()

  const wasPlayingRef = useRef(false)

  return (

    &lt;SliderPrimitive.Root

      {...otherProps}

      value={[time]}

      onValueChange={(vals) =&gt; {

        [player.seek](http://player.seek)(vals[0])

        otherProps.onValueChange?.(vals)

      }}

      min={0}

      max={player.duration ?? 0}

      step={otherProps.step || 0.25}

      onPointerDown={(e) =&gt; {

        wasPlayingRef.current = player.isPlaying

        player.pause()

        otherProps.onPointerDown?.(e)

      }}

      onPointerUp={(e) =&gt; {

        if (wasPlayingRef.current) {

          [player.play](http://player.play)()

        }

        otherProps.onPointerUp?.(e)

      }}

      className={cn(

        "group/player relative flex h-4 touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",

        otherProps.className

      )}

      onKeyDown={(e) =&gt; {

        if (e.key === " ") {

          e.preventDefault()

          if (!player.isPlaying) {

            [player.play](http://player.play)()

          } else {

            player.pause()

          }

        }

        otherProps.onKeyDown?.(e)

      }}

      disabled={

        player.duration === undefined ||

        !Number.isFinite(player.duration) ||

        Number.isNaN(player.duration)

      }

    &gt;

      &lt;SliderPrimitive.Track className="bg-muted relative h-[4px] w-full grow overflow-hidden rounded-full"&gt;

        &lt;SliderPrimitive.Range className="bg-primary absolute h-full" /&gt;

      &lt;/SliderPrimitive.Track&gt;

      &lt;SliderPrimitive.Thumb

        className="relative flex h-0 w-0 items-center justify-center opacity-0 group-hover/player:opacity-100 focus-visible:opacity-100 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"

        data-slot="slider-thumb"

      &gt;

        &lt;div className="bg-foreground absolute size-3 rounded-full" /&gt;

      &lt;/SliderPrimitive.Thumb&gt;

    &lt;/SliderPrimitive.Root&gt;

  )

}

export const AudioPlayerTime = ({

  className,

  ...otherProps

}: HTMLProps&lt;HTMLSpanElement&gt;) =&gt; {

  const time = useAudioPlayerTime()

  return (

    &lt;span

      {...otherProps}

      className={cn("text-muted-foreground text-sm tabular-nums", className)}

    &gt;

      {formatTime(time)}

    &lt;/span&gt;

  )

}

export const AudioPlayerDuration = ({

  className,

  ...otherProps

}: HTMLProps&lt;HTMLSpanElement&gt;) =&gt; {

  const player = useAudioPlayer()

  return (

    &lt;span

      {...otherProps}

      className={cn("text-muted-foreground text-sm tabular-nums", className)}

    &gt;

      {player.duration !== null &amp;&amp;

      player.duration !== undefined &amp;&amp;

      !Number.isNaN(player.duration)

        ? formatTime(player.duration)

        : "--:--"}

    &lt;/span&gt;

  )

}

interface SpinnerProps {

  className?: string

}

function Spinner({ className }: SpinnerProps) {

  return (

    &lt;div

      className={cn(

        "border-muted border-t-foreground size-3.5 animate-spin rounded-full border-2",

        className

      )}

      role="status"

      aria-label="Loading"

    &gt;

      &lt;span className="sr-only"&gt;Loading...&lt;/span&gt;

    &lt;/div&gt;

  )

}

interface PlayButtonProps extends React.ComponentProps&lt;typeof Button&gt; {

  playing: boolean

  onPlayingChange: (playing: boolean) =&gt; void

  loading?: boolean

}

const PlayButton = ({

  playing,

  onPlayingChange,

  className,

  onClick,

  loading,

  ...otherProps

}: PlayButtonProps) =&gt; {

  return (

    &lt;Button

      {...otherProps}

      onClick={(e) =&gt; {

        onPlayingChange(!playing)

        onClick?.(e)

      }}

      className={cn("relative", className)}

      aria-label={playing ? "Pause" : "Play"}

      type="button"

    &gt;

      {playing ? (

        &lt;PauseIcon

          className={cn("size-4", loading &amp;&amp; "opacity-0")}

          aria-hidden="true"

        /&gt;

      ) : (

        &lt;PlayIcon

          className={cn("size-4", loading &amp;&amp; "opacity-0")}

          aria-hidden="true"

        /&gt;

      )}

      {loading &amp;&amp; (

        &lt;div className="absolute inset-0 flex items-center justify-center rounded-[inherit] backdrop-blur-xs"&gt;

          &lt;Spinner /&gt;

        &lt;/div&gt;

      )}

    &lt;/Button&gt;

  )

}

export interface AudioPlayerButtonProps&lt;TData = unknown&gt;

  extends React.ComponentProps&lt;typeof Button&gt; {

  item?: AudioPlayerItem&lt;TData&gt;

}

export function AudioPlayerButton&lt;TData = unknown&gt;({

  item,

  ...otherProps

}: AudioPlayerButtonProps&lt;TData&gt;) {

  const player = useAudioPlayer&lt;TData&gt;()

  if (!item) {

    return (

      &lt;PlayButton

        {...otherProps}

        playing={player.isPlaying}

        onPlayingChange={(shouldPlay) =&gt; {

          if (shouldPlay) {

            [player.play](http://player.play)()

          } else {

            player.pause()

          }

        }}

        loading={player.isBuffering &amp;&amp; player.isPlaying}

      /&gt;

    )

  }

  return (

    &lt;PlayButton

      {...otherProps}

      playing={player.isItemActive([item.id](http://item.id)) &amp;&amp; player.isPlaying}

      onPlayingChange={(shouldPlay) =&gt; {

        if (shouldPlay) {

          [player.play](http://player.play)(item)

        } else {

          player.pause()

        }

      }}

      loading={

        player.isItemActive([item.id](http://item.id)) &amp;&amp; player.isBuffering &amp;&amp; player.isPlaying

      }

    /&gt;

  )

}

type Callback = (delta: number) =&gt; void

function useAnimationFrame(callback: Callback) {

  const requestRef = useRef&lt;number | null&gt;(null)

  const previousTimeRef = useRef&lt;number | null&gt;(null)

  const callbackRef = useRef&lt;Callback&gt;(callback)

  useEffect(() =&gt; {

    callbackRef.current = callback

  }, [callback])

  useEffect(() =&gt; {

    const animate = (time: number) =&gt; {

      if (previousTimeRef.current !== null) {

        const delta = time - previousTimeRef.current

        callbackRef.current(delta)

      }

      previousTimeRef.current = time

      requestRef.current = requestAnimationFrame(animate)

    }

    requestRef.current = requestAnimationFrame(animate)

    return () =&gt; {

      if (requestRef.current) cancelAnimationFrame(requestRef.current)

      previousTimeRef.current = null

    }

  }, [])

}

const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

export interface AudioPlayerSpeedProps

  extends React.ComponentProps&lt;typeof Button&gt; {

  speeds?: readonly number[]

}

export function AudioPlayerSpeed({

  speeds = PLAYBACK_SPEEDS,

  className,

  variant = "ghost",

  size = "icon",

  ...props

}: AudioPlayerSpeedProps) {

  const player = useAudioPlayer()

  const currentSpeed = player.playbackRate

  return (

    &lt;DropdownMenu&gt;

      &lt;DropdownMenuTrigger asChild&gt;

        &lt;Button

          variant={variant}

          size={size}

          className={cn(className)}

          aria-label="Playback speed"

          {...props}

        &gt;

          &lt;Settings className="size-4" /&gt;

        &lt;/Button&gt;

      &lt;/DropdownMenuTrigger&gt;

      &lt;DropdownMenuContent align="end" className="min-w-[120px]"&gt;

        {[speeds.map](http://speeds.map)((speed) =&gt; (

          &lt;DropdownMenuItem

            key={speed}

            onClick={() =&gt; player.setPlaybackRate(speed)}

            className="flex items-center justify-between"

          &gt;

            &lt;span className={speed === 1 ? "" : "font-mono"}&gt;

              {speed === 1 ? "Normal" : `${speed}x`}

            &lt;/span&gt;

            {currentSpeed === speed &amp;&amp; &lt;Check className="size-4" /&gt;}

          &lt;/DropdownMenuItem&gt;

        ))}

      &lt;/DropdownMenuContent&gt;

    &lt;/DropdownMenu&gt;

  )

}

export interface AudioPlayerSpeedButtonGroupProps

  extends Omit&lt;React.HTMLAttributes&lt;HTMLDivElement&gt;, "children"&gt; {

  speeds?: readonly number[]

}

export function AudioPlayerSpeedButtonGroup({

  speeds = [0.5, 1, 1.5, 2],

  className,

  ...props

}: AudioPlayerSpeedButtonGroupProps) {

  const player = useAudioPlayer()

  const currentSpeed = player.playbackRate

  return (

    &lt;div

      className={cn("flex items-center gap-1", className)}

      role="group"

      aria-label="Playback speed controls"

      {...props}

    &gt;

      {[speeds.map](http://speeds.map)((speed) =&gt; (

        &lt;Button

          key={speed}

          variant={currentSpeed === speed ? "default" : "outline"}

          size="sm"

          onClick={() =&gt; player.setPlaybackRate(speed)}

          className="min-w-[50px] font-mono text-xs"

        &gt;

          {speed}x

        &lt;/Button&gt;

      ))}

    &lt;/div&gt;

  )

}

export const exampleTracks = [

  {

    id: "0",

    name: "II - 00",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/00.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/00.mp3)",

  },

  {

    id: "1",

    name: "II - 01",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/01.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/01.mp3)",

  },

  {

    id: "2",

    name: "II - 02",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/02.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/02.mp3)",

  },

  {

    id: "3",

    name: "II - 03",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/03.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/03.mp3)",

  },

  {

    id: "4",

    name: "II - 04",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/04.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/04.mp3)",

  },

  {

    id: "5",

    name: "II - 05",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/05.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/05.mp3)",

  },

  {

    id: "6",

    name: "II - 06",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/06.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/06.mp3)",

  },

  {

    id: "7",

    name: "II - 07",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/07.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/07.mp3)",

  },

  {

    id: "8",

    name: "II - 08",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/08.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/08.mp3)",

  },

  {

    id: "9",

    name: "II - 09",

    url: "[https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/09.mp3](https://storage.googleapis.com/eleven-public-cdn/audio/ui-elevenlabs-io/09.mp3)",

  },

]

demo.tsx

"use client"

import { PauseIcon, PlayIcon } from "lucide-react"

import { cn } from "@/lib/utils"

import {

  AudioPlayerButton,

  AudioPlayerDuration,

  AudioPlayerProgress,

  AudioPlayerProvider,

  AudioPlayerSpeed,

  AudioPlayerTime,

  exampleTracks,

  useAudioPlayer,

} from "@/components/ui/audio-player"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import { ScrollArea } from "@/components/ui/scroll-area"

interface Track {

  id: string

  name: string

  url: string

}

export default function AudioPlayer() {

  return (

    &lt;AudioPlayerProvider&lt;Track&gt;&gt;

      &lt;AudioPlayerDemo /&gt;

    &lt;/AudioPlayerProvider&gt;

  )

}

const AudioPlayerDemo = () =&gt; {

  return (

    &lt;Card className="w-full overflow-hidden p-0"&gt;

      &lt;div className="flex flex-col lg:h-[180px] lg:flex-row"&gt;

        &lt;div className="bg-muted/50 flex flex-col overflow-hidden lg:h-full lg:w-64"&gt;

          &lt;ScrollArea className="h-48 w-full lg:h-full"&gt;

            &lt;div className="space-y-1 p-3"&gt;

              {[exampleTracks.map](http://exampleTracks.map)((song, index) =&gt; (

                &lt;SongListItem

                  key={[song.id](http://song.id)}

                  song={song}

                  trackNumber={index + 1}

                /&gt;

              ))}

            &lt;/div&gt;

          &lt;/ScrollArea&gt;

        &lt;/div&gt;

        &lt;Player /&gt;

      &lt;/div&gt;

    &lt;/Card&gt;

  )

}

const Player = () =&gt; {

  const player = useAudioPlayer&lt;Track&gt;()

  return (

    &lt;div className="flex flex-1 items-center p-4 sm:p-6"&gt;

      &lt;div className="mx-auto w-full max-w-2xl"&gt;

        &lt;div className="mb-4"&gt;

          &lt;h3 className="text-base font-semibold sm:text-lg"&gt;

            {player.activeItem?.data?.name ?? "No track selected"}

          &lt;/h3&gt;

        &lt;/div&gt;

        &lt;div className="flex items-center gap-3 sm:gap-4"&gt;

          &lt;AudioPlayerButton

            variant="outline"

            size="default"

            className="h-12 w-12 shrink-0 sm:h-10 sm:w-10"

            disabled={!player.activeItem}

          /&gt;

          &lt;div className="flex flex-1 items-center gap-2 sm:gap-3"&gt;

            &lt;AudioPlayerTime className="text-xs tabular-nums" /&gt;

            &lt;AudioPlayerProgress className="flex-1" /&gt;

            &lt;AudioPlayerDuration className="text-xs tabular-nums" /&gt;

            &lt;AudioPlayerSpeed variant="ghost" size="icon" /&gt;

          &lt;/div&gt;

        &lt;/div&gt;

      &lt;/div&gt;

    &lt;/div&gt;

  )

}

const SongListItem = ({

  song,

  trackNumber,

}: {

  song: Track

  trackNumber: number

}) =&gt; {

  const player = useAudioPlayer&lt;Track&gt;()

  const isActive = player.isItemActive([song.id](http://song.id))

  const isCurrentlyPlaying = isActive &amp;&amp; player.isPlaying

  return (

    &lt;div className="group/song relative"&gt;

      &lt;Button

        variant={isActive ? "secondary" : "ghost"}

        size="sm"

        className={cn(

          "h-10 w-full justify-start px-3 font-normal sm:h-9 sm:px-2",

          isActive &amp;&amp; "bg-secondary"

        )}

        onClick={() =&gt; {

          if (isCurrentlyPlaying) {

            player.pause()

          } else {

            [player.play](http://player.play)({

              id: [song.id](http://song.id),

              src: song.url,

              data: song,

            })

          }

        }}

      &gt;

        &lt;div className="flex w-full items-center gap-3"&gt;

          &lt;div className="flex w-5 shrink-0 items-center justify-center"&gt;

            {isCurrentlyPlaying ? (

              &lt;PauseIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" /&gt;

            ) : (

              &lt;&gt;

                &lt;span className="text-muted-foreground/60 text-sm tabular-nums group-hover/song:invisible"&gt;

                  {trackNumber}

                &lt;/span&gt;

                &lt;PlayIcon className="invisible absolute h-4 w-4 group-hover/song:visible sm:h-3.5 sm:w-3.5" /&gt;

              &lt;/&gt;

            )}

          &lt;/div&gt;

          &lt;span className="truncate text-left text-sm"&gt;{[song.name](http://song.name)}&lt;/span&gt;

        &lt;/div&gt;

      &lt;/Button&gt;

    &lt;/div&gt;

  )

}

```

Copy-paste these files for dependencies:

```tsx

shadcn/button

import * as React from "react"

import { Slot } from "@radix-ui/react-slot"

import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(

  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",

  {

    variants: {

      variant: {

        default: "bg-primary text-primary-foreground hover:bg-primary/90",

        destructive:

          "bg-destructive text-destructive-foreground hover:bg-destructive/90",

        outline:

          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",

        secondary:

          "bg-secondary text-secondary-foreground hover:bg-secondary/80",

        ghost: "hover:bg-accent hover:text-accent-foreground",

        link: "text-primary underline-offset-4 hover:underline",

      },

      size: {

        default: "h-10 px-4 py-2",

        sm: "h-9 rounded-md px-3",

        lg: "h-11 rounded-md px-8",

        icon: "h-10 w-10",

      },

    },

    defaultVariants: {

      variant: "default",

      size: "default",

    },

  },

)

export interface ButtonProps

  extends React.ButtonHTMLAttributes&lt;HTMLButtonElement&gt;,

    VariantProps&lt;typeof buttonVariants&gt; {

  asChild?: boolean

}

const Button = React.forwardRef&lt;HTMLButtonElement, ButtonProps&gt;(

  ({ className, variant, size, asChild = false, ...props }, ref) =&gt; {

    const Comp = asChild ? Slot : "button"

    return (

      &lt;Comp

        className={cn(buttonVariants({ variant, size, className }))}

        ref={ref}

        {...props}

      /&gt;

    )

  },

)

Button.displayName = "Button"

export { Button, buttonVariants }

```

```tsx

shadcn/scroll-area

"use client"

import * as React from "react"

import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef&lt;

  React.ElementRef&lt;typeof ScrollAreaPrimitive.Root&gt;,

  React.ComponentPropsWithoutRef&lt;typeof ScrollAreaPrimitive.Root&gt;

&gt;(({ className, children, ...props }, ref) =&gt; (

  &lt;ScrollAreaPrimitive.Root

    ref={ref}

    className={cn("relative overflow-hidden", className)}

    {...props}

  &gt;

    &lt;ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]"&gt;

      {children}

    &lt;/ScrollAreaPrimitive.Viewport&gt;

    &lt;ScrollBar /&gt;

    &lt;ScrollAreaPrimitive.Corner /&gt;

  &lt;/ScrollAreaPrimitive.Root&gt;

))

ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef&lt;

  React.ElementRef&lt;typeof ScrollAreaPrimitive.ScrollAreaScrollbar&gt;,

  React.ComponentPropsWithoutRef&lt;typeof ScrollAreaPrimitive.ScrollAreaScrollbar&gt;

&gt;(({ className, orientation = "vertical", ...props }, ref) =&gt; (

  &lt;ScrollAreaPrimitive.ScrollAreaScrollbar

    ref={ref}

    orientation={orientation}

    className={cn(

      "flex touch-none select-none transition-colors",

      orientation === "vertical" &amp;&amp;

        "h-full w-2.5 border-l border-l-transparent p-[1px]",

      orientation === "horizontal" &amp;&amp;

        "h-2.5 flex-col border-t border-t-transparent p-[1px]",

      className,

    )}

    {...props}

  &gt;

    &lt;ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" /&gt;

  &lt;/ScrollAreaPrimitive.ScrollAreaScrollbar&gt;

))

ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }

```

```tsx

shadcn/separator

"use client"

import * as React from "react"

import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

const Separator = React.forwardRef&lt;

  React.ElementRef&lt;typeof SeparatorPrimitive.Root&gt;,

  React.ComponentPropsWithoutRef&lt;typeof SeparatorPrimitive.Root&gt;

&gt;(

  (

    { className, orientation = "horizontal", decorative = true, ...props },

    ref

  ) =&gt; (

    &lt;SeparatorPrimitive.Root

      ref={ref}

      decorative={decorative}

      orientation={orientation}

      className={cn(

        "shrink-0 bg-border",

        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",

        className

      )}

      {...props}

    /&gt;

  )

)

Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }

```

```tsx

shadcn/dropdown-menu

"use client"

import * as React from "react"

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"

import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = [DropdownMenuPrimitive.Group](http://DropdownMenuPrimitive.Group)

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef&lt;

  React.ElementRef&lt;typeof DropdownMenuPrimitive.SubTrigger&gt;,

  React.ComponentPropsWithoutRef&lt;typeof DropdownMenuPrimitive.SubTrigger&gt; &amp; {

    inset?: boolean

  }

&gt;(({ className, inset, children, ...props }, ref) =&gt; (

  &lt;DropdownMenuPrimitive.SubTrigger

    ref={ref}

    className={cn(

      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent",

      inset &amp;&amp; "pl-8",

      className,

    )}

    {...props}

  &gt;

    {children}

    &lt;ChevronRight className="ml-auto h-4 w-4" /&gt;

  &lt;/DropdownMenuPrimitive.SubTrigger&gt;

))

DropdownMenuSubTrigger.displayName =

  DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef&lt;

  React.ElementRef&lt;typeof DropdownMenuPrimitive.SubContent&gt;,

  React.ComponentPropsWithoutRef&lt;typeof DropdownMenuPrimitive.SubContent&gt;

&gt;(({ className, ...props }, ref) =&gt; (

  &lt;DropdownMenuPrimitive.SubContent

    ref={ref}

    className={cn(

      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",

      className,

    )}

    {...props}

  /&gt;

))

DropdownMenuSubContent.displayName =

  DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef&lt;

  React.ElementRef&lt;typeof DropdownMenuPrimitive.Content&gt;,

  React.ComponentPropsWithoutRef&lt;typeof DropdownMenuPrimitive.Content&gt;

&gt;(({ className, sideOffset = 4, ...props }, ref) =&gt; (

  &lt;DropdownMenuPrimitive.Portal&gt;

    &lt;DropdownMenuPrimitive.Content

      ref={ref}

      sideOffset={sideOffset}

      className={cn(

        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",

        className,

      )}

      {...props}

    /&gt;

  &lt;/DropdownMenuPrimitive.Portal&gt;

))

DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef&lt;

  React.ElementRef&lt;typeof DropdownMenuPrimitive.Item&gt;,

  React.ComponentPropsWithoutRef&lt;typeof DropdownMenuPrimitive.Item&gt; &amp; {

    inset?: boolean

  }

&gt;(({ className, inset, ...props }, ref) =&gt; (

  &lt;DropdownMenuPrimitive.Item

    ref={ref}

    className={cn(

      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",

      inset &amp;&amp; "pl-8",

      className,

    )}

    {...props}

  /&gt;

))

DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef&lt;

  React.ElementRef&lt;typeof DropdownMenuPrimitive.CheckboxItem&gt;,

  React.ComponentPropsWithoutRef&lt;typeof DropdownMenuPrimitive.CheckboxItem&gt;

&gt;(({ className, children, checked, ...props }, ref) =&gt; (

  &lt;DropdownMenuPrimitive.CheckboxItem

    ref={ref}

    className={cn(

      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",

      className,

    )}

    checked={checked}

    {...props}

  &gt;

    &lt;span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"&gt;

      &lt;DropdownMenuPrimitive.ItemIndicator&gt;

        &lt;Check className="h-4 w-4" /&gt;

      &lt;/DropdownMenuPrimitive.ItemIndicator&gt;

    &lt;/span&gt;

    {children}

  &lt;/DropdownMenuPrimitive.CheckboxItem&gt;

))

DropdownMenuCheckboxItem.displayName =

  DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef&lt;

  React.ElementRef&lt;typeof DropdownMenuPrimitive.RadioItem&gt;,

  React.ComponentPropsWithoutRef&lt;typeof DropdownMenuPrimitive.RadioItem&gt;

&gt;(({ className, children, ...props }, ref) =&gt; (

  &lt;DropdownMenuPrimitive.RadioItem

    ref={ref}

    className={cn(

      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",

      className,

    )}

    {...props}

  &gt;

    &lt;span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"&gt;

      &lt;DropdownMenuPrimitive.ItemIndicator&gt;

        &lt;Circle className="h-2 w-2 fill-current" /&gt;

      &lt;/DropdownMenuPrimitive.ItemIndicator&gt;

    &lt;/span&gt;

    {children}

  &lt;/DropdownMenuPrimitive.RadioItem&gt;

))

DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef&lt;

  React.ElementRef&lt;typeof DropdownMenuPrimitive.Label&gt;,

  React.ComponentPropsWithoutRef&lt;typeof DropdownMenuPrimitive.Label&gt; &amp; {

    inset?: boolean

  }

&gt;(({ className, inset, ...props }, ref) =&gt; (

  &lt;DropdownMenuPrimitive.Label

    ref={ref}

    className={cn(

      "px-2 py-1.5 text-sm font-semibold",

      inset &amp;&amp; "pl-8",

      className,

    )}

    {...props}

  /&gt;

))

DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef&lt;

  React.ElementRef&lt;typeof DropdownMenuPrimitive.Separator&gt;,

  React.ComponentPropsWithoutRef&lt;typeof DropdownMenuPrimitive.Separator&gt;

&gt;(({ className, ...props }, ref) =&gt; (

  &lt;DropdownMenuPrimitive.Separator

    ref={ref}

    className={cn("-mx-1 my-1 h-px bg-muted", className)}

    {...props}

  /&gt;

))

DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({

  className,

  ...props

}: React.HTMLAttributes&lt;HTMLSpanElement&gt;) =&gt; {

  return (

    &lt;span

      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}

      {...props}

    /&gt;

  )

}

DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {

  DropdownMenu,

  DropdownMenuTrigger,

  DropdownMenuContent,

  DropdownMenuItem,

  DropdownMenuCheckboxItem,

  DropdownMenuRadioItem,

  DropdownMenuLabel,

  DropdownMenuSeparator,

  DropdownMenuShortcut,

  DropdownMenuGroup,

  DropdownMenuPortal,

  DropdownMenuSub,

  DropdownMenuSubContent,

  DropdownMenuSubTrigger,

  DropdownMenuRadioGroup,

}

```

```tsx

shadcn/card

import * as React from "react"

import { cn } from "@/lib/utils"

const Card = React.forwardRef&lt;

  HTMLDivElement,

  React.HTMLAttributes&lt;HTMLDivElement&gt;

&gt;(({ className, ...props }, ref) =&gt; (

  &lt;div

    ref={ref}

    className={cn(

      "rounded-lg border bg-card text-card-foreground shadow-sm",

      className,

    )}

    {...props}

  /&gt;

))

Card.displayName = "Card"

const CardHeader = React.forwardRef&lt;

  HTMLDivElement,

  React.HTMLAttributes&lt;HTMLDivElement&gt;

&gt;(({ className, ...props }, ref) =&gt; (

  &lt;div

    ref={ref}

    className={cn("flex flex-col space-y-1.5 p-6", className)}

    {...props}

  /&gt;

))

CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef&lt;

  HTMLParagraphElement,

  React.HTMLAttributes&lt;HTMLHeadingElement&gt;

&gt;(({ className, ...props }, ref) =&gt; (

  &lt;h3

    ref={ref}

    className={cn(

      "text-2xl font-semibold leading-none tracking-tight",

      className,

    )}

    {...props}

  /&gt;

))

CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef&lt;

  HTMLParagraphElement,

  React.HTMLAttributes&lt;HTMLParagraphElement&gt;

&gt;(({ className, ...props }, ref) =&gt; (

  &lt;p

    ref={ref}

    className={cn("text-sm text-muted-foreground", className)}

    {...props}

  /&gt;

))

CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef&lt;

  HTMLDivElement,

  React.HTMLAttributes&lt;HTMLDivElement&gt;

&gt;(({ className, ...props }, ref) =&gt; (

  &lt;div ref={ref} className={cn("p-6 pt-0", className)} {...props} /&gt;

))

CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef&lt;

  HTMLDivElement,

  React.HTMLAttributes&lt;HTMLDivElement&gt;

&gt;(({ className, ...props }, ref) =&gt; (

  &lt;div

    ref={ref}

    className={cn("flex items-center p-6 pt-0", className)}

    {...props}

  /&gt;

))

CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }

```

Install NPM dependencies:

```bash

lucide-react, @radix-ui/react-slider, @radix-ui/react-slot, class-variance-authority, @radix-ui/react-scroll-area, @radix-ui/react-separator, @radix-ui/react-dropdown-menu

```

