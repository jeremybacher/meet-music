/**
 * El aviso en texto plano del chat.
 *
 * Es el único mensaje de la extensión escrito **para humanos**, y por eso no va cifrado ni oculto:
 * su destinatario es justamente quien NO tiene la extensión. Sin él, entrar a una reunión donde ya
 * suena música es desconcertante — hay música, no se ve de dónde sale, y no hay forma de saber que
 * uno también podría poner algo.
 *
 * Responde tres cosas en una línea: qué está sonando, quién lo comparte y cómo sumarse. Una línea,
 * porque el chat de Meet es un canal caro: cada mensaje es una fila visible para toda la reunión
 * (ver la invariante 4 en CLAUDE.md). Quien lo emite es el host, y sólo cuando entra alguien.
 */

export const EXTENSION_URL = 'https://github.com/jeremybacher/meet-music'

/** Un título muy largo empujaría lo importante —el link— fuera de la primera línea visible. */
const TITLE_MAX = 64

export interface Announcement {
  /** Lo que está sonando. `null` mientras el reproductor todavía no informó el título real. */
  title: string | null
  /** Quién la está compartiendo. Vacío si no se pudo leer el nombre de la cuenta. */
  host: string
  url?: string
}

export const announcementText = ({ title, host, url = EXTENSION_URL }: Announcement): string => {
  const who = host.trim() || 'Someone'
  const song = title?.trim() ? `now playing “${ellipsis(title.trim(), TITLE_MAX)}”` : 'music is playing'
  return (
    `♪ Meet Music · ${song} · ${who} is sharing it through their microphone, ` +
    `so you hear it without installing anything. Add songs to the queue with the extension: ${url}`
  )
}

/** Recorta por palabra cuando se puede: un corte a mitad de palabra se lee como un error. */
export const ellipsis = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
