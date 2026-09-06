/** Extraer videoIds de lo que el usuario pegue, sin gastar cuota de API. */

const ID = /^[A-Za-z0-9_-]{11}$/

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

/**
 * Los otros lugares de donde la gente saca música. Vale la pena reconocerlos por nombre: decirle
 * "no es un link de YouTube" a alguien que acaba de pegar Spotify es cierto y no ayuda en nada.
 */
const OTHER_SERVICES: Record<string, string> = {
  'open.spotify.com': 'Spotify',
  'spotify.com': 'Spotify',
  'music.apple.com': 'Apple Music',
  'soundcloud.com': 'SoundCloud',
  'deezer.com': 'Deezer',
  'tidal.com': 'Tidal',
  'listen.tidal.com': 'Tidal',
  'bandcamp.com': 'Bandcamp',
  'vimeo.com': 'Vimeo',
}

/**
 * Por qué un texto no sirve. El campo muestra un mensaje distinto para cada caso: quien pegó una
 * playlist necesita saber que le falta abrir el video, no que "el link es inválido".
 */
export type LinkProblem =
  | { reason: 'empty' }
  /** Es de YouTube, pero apunta a una playlist, un canal o una búsqueda. */
  | { reason: 'no-video' }
  /** Es un servicio de música conocido, pero no es YouTube. */
  | { reason: 'other-service'; service: string }
  | { reason: 'not-youtube' }

export type ParsedLink = { ok: true; videoId: string } | ({ ok: false } & LinkProblem)

/**
 * El videoId de lo que sea que la persona haya pegado, o el motivo por el que no se pudo.
 *
 * Devuelve el motivo y no `null` porque el campo lo necesita: quien pegó una playlist tiene que
 * enterarse de que le falta abrir el video, no de que "el link es inválido".
 */
export const parseLink = (input: string): ParsedLink => {
  const text = input.trim()
  if (!text) return { ok: false, reason: 'empty' }
  if (ID.test(text)) return { ok: true, videoId: text }

  let url: URL
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`)
  } catch {
    return { ok: false, reason: 'not-youtube' }
  }

  const host = url.hostname.toLowerCase()
  const bare = host.replace(/^www\./, '')

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    return found(pick(url.pathname.slice(1).split('/')[0]))
  }

  if (!HOSTS.has(host)) {
    const service = OTHER_SERVICES[host] ?? OTHER_SERVICES[bare]
    if (service) return { ok: false, reason: 'other-service', service }
    return { ok: false, reason: 'not-youtube' }
  }

  const v = url.searchParams.get('v')
  if (v) return found(pick(v))

  const segments = url.pathname.split('/').filter(Boolean)
  // /shorts/ID, /embed/ID, /live/ID, /v/ID
  if (segments.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(segments[0])) {
    return found(pick(segments[1]))
  }

  // Es YouTube, pero no un video: una playlist, un canal, una búsqueda, la home.
  return { ok: false, reason: 'no-video' }
}

const found = (videoId: string | null): ParsedLink =>
  videoId === null ? { ok: false, reason: 'no-video' } : { ok: true, videoId }

const pick = (candidate: string): string | null => (ID.test(candidate) ? candidate : null)

/** `4:13`, o `1:02:03` si pasa la hora. */
export const formatDuration = (seconds: number | undefined): string => {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
