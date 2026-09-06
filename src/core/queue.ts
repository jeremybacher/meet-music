/**
 * Estado de la cola. Reducer puro: el host lo aplica y difunde el resultado, los invitados sólo
 * pintan el último snapshot que recibieron.
 */
import type { StateSnapshot, Track } from './protocol.js'

export type Action =
  | { type: 'add'; track: Track }
  | { type: 'remove'; id: string }
  | { type: 'next' }
  /** Saltar directo a una canción de la cola, sin pasar por las de antes. */
  | { type: 'jump'; id: string }
  | { type: 'setPlaying'; playing: boolean }
  | { type: 'setVolume'; volume: number }
  /** El player nos contó el título/duración reales una vez que cargó el video. */
  | { type: 'enrich'; id: string; patch: Partial<Track> }

export const emptyState = (): StateSnapshot => ({
  current: null,
  queue: [],
  playing: false,
  volume: 0.7,
})

export const reduce = (state: StateSnapshot, action: Action): StateSnapshot => {
  switch (action.type) {
    case 'add': {
      // Si no hay nada sonando, la nueva canción arranca directamente.
      if (!state.current) return { ...state, current: action.track, playing: true }
      return { ...state, queue: [...state.queue, action.track] }
    }

    case 'remove': {
      if (state.current?.id === action.id) return advance(state)
      return { ...state, queue: state.queue.filter((t) => t.id !== action.id) }
    }

    case 'next':
      return advance(state)

    case 'jump': {
      const target = state.queue.find((t) => t.id === action.id)
      // Ya está sonando, o alguien la sacó entre el clic y el mensaje: no hay nada que hacer.
      if (!target) return state
      // Las que se saltean no se descartan: quedan en la cola, detrás. Nadie pidió borrarlas, y
      // perder canciones ajenas por adelantar la propia sería la peor forma de compartir una cola.
      const rest = state.queue.filter((t) => t.id !== action.id)
      return { ...state, current: target, queue: rest, playing: true }
    }

    case 'setPlaying':
      return { ...state, playing: action.playing }

    case 'setVolume':
      return { ...state, volume: Math.min(1, Math.max(0, action.volume)) }

    case 'enrich': {
      const patchTrack = (t: Track): Track => (t.id === action.id ? { ...t, ...action.patch, id: t.id } : t)
      return {
        ...state,
        current: state.current ? patchTrack(state.current) : null,
        queue: state.queue.map(patchTrack),
      }
    }
  }
}

/** Pasa a la siguiente. Cualquiera puede hacerlo: la cola es de la reunión, no de quien la puso. */
const advance = (state: StateSnapshot): StateSnapshot => {
  const [next, ...rest] = state.queue
  return {
    ...state,
    current: next ?? null,
    queue: rest,
    playing: next ? true : false,
  }
}
