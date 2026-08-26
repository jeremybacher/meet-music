/**
 * Protocolo de la cola compartida: qué mensajes existen y cómo validarlos.
 *
 * El formato de cable —prefijo y cifrado— vive en `wire.ts`.
 */

/** Una canción en la cola. `id` es el videoId de YouTube. */
export interface Track {
  id: string
  title: string
  /** Segundos. Opcional: al pegar una URL no la sabemos hasta que carga el player. */
  duration?: number
  thumb?: string
  /** Nombre visible de quien la agregó, para atribución en el panel. */
  addedBy?: string
}

/** Snapshot autoritativo que difunde el host. */
export interface StateSnapshot {
  current: Track | null
  queue: Track[]
  playing: boolean
  /** Volumen de la música en la reunión, para que quien escucha vea el valor real. */
  volume: number
}

/**
 * `from` es el id estable del participante; `name`/`addedBy`/`host` son sólo etiquetas para
 * mostrar. Van separados a propósito: si la identidad fuera el nombre, dos personas con el nombre
 * por defecto contarían como una sola y el voto para saltear quedaría roto.
 */
export type Msg =
  /** Un invitado pide agregar una canción. */
  | { op: 'add'; track: Track; from: string }
  /** Un invitado pide quitar una canción de la cola. */
  | { op: 'remove'; id: string; from: string }
  /** Cualquiera puede pasar de canción; no hay votación. */
  | { op: 'skip'; from: string }
  /** Pausar y reanudar también son de la reunión, no sólo de quien reproduce. */
  | { op: 'playback'; playing: boolean; from: string }
  /**
   * Cortar la música y liberar el puesto. La cola se conserva: lo que se libera es quién
   * reproduce, para que cualquiera pueda tomar el relevo desde donde estaba.
   */
  | { op: 'stop'; from: string }
  /**
   * Bajar la música. Es un control **compartido**: quien escucha no puede regularla por su cuenta
   * —le llega fusionada con la voz de quien reproduce, en una sola pista de Meet— así que lo único
   * posible es pedirle a esa persona que la baje para todos.
   */
  | { op: 'volume'; level: number; from: string }
  /** Un invitado acaba de entrar y pide el estado. */
  | { op: 'hello'; from: string; name: string }
  /** El host difunde el estado. Es el único mensaje que manda el host. */
  | { op: 'state'; state: StateSnapshot; host: string; from: string }

/** Serializa para el cable. La capa de cifrado vive en `wire.ts`. */
export const toJson = (msg: Msg): string => JSON.stringify(msg)

/**
 * Deserializa lo que salió de descifrar. Aunque el mensaje venga autenticado, validamos la forma:
 * viene de otra instalación de la extensión, que puede ser de otra versión.
 */
export const fromJson = (json: string): Msg | null => {
  try {
    const parsed: unknown = JSON.parse(json)
    return isMsg(parsed) ? parsed : null
  } catch {
    return null
  }
}

const isMsg = (v: unknown): v is Msg => {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  if (typeof m.from !== 'string' || !m.from) return false

  switch (m.op) {
    case 'add':
      return isTrack(m.track)
    case 'remove':
      return typeof m.id === 'string'
    case 'skip':
    case 'stop':
      return true
    case 'playback':
      return typeof m.playing === 'boolean'
    case 'volume':
      return typeof m.level === 'number' && m.level >= 0 && m.level <= 1
    case 'hello':
      return typeof m.name === 'string'
    case 'state':
      return typeof m.host === 'string' && isSnapshot(m.state)
    default:
      return false
  }
}

const isTrack = (v: unknown): v is Track => {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return typeof t.id === 'string' && t.id.length > 0 && typeof t.title === 'string'
}

const isSnapshot = (v: unknown): v is StateSnapshot => {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    (s.current === null || isTrack(s.current)) &&
    Array.isArray(s.queue) &&
    s.queue.every(isTrack) &&
    typeof s.playing === 'boolean' &&
    typeof s.volume === 'number'
  )
}
