/** Tipos de mensajes entre los cuatro contextos: MAIN, ISOLATED, service worker y player tab. */
import type { DuckConfig, Levels } from './mixer.js'
import type { Track } from './protocol.js'
import type { ThemePref } from './theme.js'

/** Marca de nuestros window.postMessage, para ignorar el ruido de Meet. */
export const BRIDGE = 'meet-music-bridge'

export type PlayerPhase = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'

/**
 * Señalización WebRTC entre la pestaña de YouTube y la de Meet. Son strings y objetos planos, así
 * que viajan sin problema por window.postMessage y por los puertos de chrome.runtime.
 */
export type Signal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

export interface PlayerState {
  phase: PlayerPhase
  currentTime: number
  duration: number
  videoId: string | null
  title: string | null
  author: string | null
  /** En una página real de YouTube esto es confiable: la clase `ad-showing` del reproductor. */
  adLikely: boolean
  /** De dónde se está tomando el audio, para poder diagnosticar sin adivinar. */
  source: 'webaudio' | 'capture' | null
  /** Si por esa toma está saliendo señal de verdad, no sólo si la pista dice estar viva. */
  signal: boolean
}

/** ISOLATED → MAIN (window.postMessage). */
export type ToMain =
  | { type: 'signal'; signal: Signal }
  | { type: 'capture-display' }
  | { type: 'stop-music' }
  | { type: 'set-levels'; levels: Partial<Levels> }
  | { type: 'set-duck'; duck: Partial<DuckConfig> }
  | { type: 'query-status' }

/** MAIN → ISOLATED (window.postMessage). */
export type ToIsolated =
  | { type: 'patch-installed' }
  | { type: 'signal'; signal: Signal }
  | { type: 'mic-attached' }
  | { type: 'music-attached' }
  /**
   * El grafo está armado pero Meet todavía no transmite audio, así que la reunión no escucha nada.
   * No es un error: se resuelve solo en cuanto Meet empiece a mandar, y el reconciliador engancha
   * la mezcla sin que haya que volver a apretar nada.
   */
  | { type: 'music-pending'; reason: string }
  | { type: 'music-failed'; error: string }
  /** Meet había quedado enviando una pista muerta y la repusimos. */
  | { type: 'outgoing-restored' }
  | {
      type: 'status'
      micActive: boolean
      musicActive: boolean
      ducking: boolean
      levels: Levels
      /** Emisores de Meet que están llevando la mezcla. 0 con música puesta = nadie la escucha. */
      outgoing: number
      /** Emisores de audio que Meet tiene abiertos, lleven o no la mezcla. */
      senders: number
    }

/** Panel (ISOLATED) → service worker. */
export type PanelReq =
  /** Abre la pestaña de YouTube con esta canción y arranca el enlace de audio. */
  | { type: 'start-audio'; videoId: string }
  | { type: 'stop-audio' }
  | { type: 'signal'; signal: Signal }
  | { type: 'load'; videoId: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; seconds: number }
  | { type: 'monitor'; level: number }
  | { type: 'focus-player' }
  | { type: 'resolve'; videoId: string }
  | { type: 'open-options' }

/** Service worker → panel. */
export type SwEvent =
  | { type: 'signal'; signal: Signal }
  | { type: 'player-state'; state: PlayerState }
  | { type: 'capture-failed'; error: string }
  | { type: 'needs-gesture' }
  | { type: 'player-gone' }
  | { type: 'audio-stopped' }
  | { type: 'resolved'; track: Track }
  | { type: 'error'; error: string; fatal?: boolean }

/** Service worker → player tab. */
export type PlayerCmd =
  /** Pedile a la pestaña de YouTube que arranque la captura y ofrezca la conexión. */
  | { type: 'connect' }
  /** Cambiar de canción sin recargar: mismo documento, mismo enlace de audio. */
  | { type: 'load'; videoId: string }
  | { type: 'signal'; signal: Signal }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; seconds: number }
  /** Cuánto querés escuchar vos, aplicado en la fuente. Ver la nota en `core/mixer.ts`. */
  | { type: 'monitor'; level: number }

/** Player tab → service worker. */
export type PlayerEvent =
  | { type: 'ready' }
  | { type: 'signal'; signal: Signal }
  | { type: 'state'; state: PlayerState }
  | { type: 'capture-failed'; error: string }
  | { type: 'needs-gesture' }
  | { type: 'gesture-granted' }

export const PORT_MEET = 'meet-music:meet'
export const PORT_PLAYER = 'meet-music:player'

/**
 * Puente entre el content script aislado de YouTube y su mundo MAIN. Hace falta porque
 * `loadVideoById` es un método que YouTube agrega al elemento `#movie_player` desde la página, y
 * el mundo aislado no ve las propiedades JS que agrega la página.
 */
export const YT_BRIDGE = 'meet-music-yt'

export type ToYtMain =
  | { type: 'load'; videoId: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; seconds: number }

export type FromYtMain =
  | { type: 'loaded'; videoId: string }
  /**
   * Id y título salen juntos de `getVideoData()`, así que siempre corresponden al mismo video.
   * `document.title` no sirve: tarda en actualizarse tras un cambio de canción y deja el título
   * viejo pegado al video nuevo.
   */
  | { type: 'videoData'; videoId: string; title: string; author: string | null }
  /** El reproductor de YouTube no expone su API; hay que recurrir a recargar la pestaña. */
  | { type: 'api-missing' }

/** Lo que el panel persiste en chrome.storage.local. */
export interface Prefs {
  levels: Levels
  duck: DuckConfig
  displayName: string
  theme: ThemePref
  /**
   * Compartir la cola escribe mensajes cifrados en el chat de Meet. Viene activado porque es el
   * único canal por el que la extensión de otra persona puede enterarse de qué se está
   * reproduciendo; sin esto cada participante queda aislado.
   */
  shareQueue: boolean
  /**
   * Avisar por el chat, en texto legible, cuando entra alguien con la música ya sonando. Es el
   * único mensaje de la extensión dirigido a quien NO la tiene instalada: sin él, llegar a una
   * reunión con música es llegar a un sonido sin origen ni forma de participar.
   */
  announce: boolean
}

