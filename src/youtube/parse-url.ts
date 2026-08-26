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

/** Devuelve el videoId, o null si el texto no es una URL de YouTube ni un id suelto. */
export const parseVideoId = (input: string): string | null => {
  const text = input.trim()
  if (!text) return null
  if (ID.test(text)) return text

  let url: URL
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    return pick(url.pathname.slice(1).split('/')[0])
  }

  if (!HOSTS.has(host)) return null

  const v = url.searchParams.get('v')
  if (v) return pick(v)

  const segments = url.pathname.split('/').filter(Boolean)
  // /shorts/ID, /embed/ID, /live/ID, /v/ID
  if (segments.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(segments[0])) {
    return pick(segments[1])
  }

  return null
}

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
