/**
 * Título y miniatura de un video, vía el endpoint oEmbed público de YouTube.
 *
 * No es la Data API: no lleva clave, no consume cuota y no hay nada que configurar. Existe sólo
 * para que la cola muestre nombres de canciones en vez de ids crudos como `dQw4w9WgXcQ`.
 * Si falla, se encola igual con el id y el título real llega cuando el video empieza a sonar.
 */
import type { Track } from '../core/protocol.js'

const CACHE_KEY = 'oembed-cache-v1'
const CACHE_MAX_ENTRIES = 300

type Cache = Record<string, Track>

export const describeVideo = async (videoId: string): Promise<Track> => {
  const fallback: Track = { id: videoId, title: videoId }

  const cache = await readCache()
  const hit = cache[videoId]
  if (hit) return hit

  try {
    const url = new URL('https://www.youtube.com/oembed')
    url.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`)
    url.searchParams.set('format', 'json')

    const res = await fetch(url.toString())
    if (!res.ok) return fallback

    const data = (await res.json()) as { title?: string; thumbnail_url?: string }
    const track: Track = {
      id: videoId,
      title: typeof data.title === 'string' && data.title ? data.title : videoId,
      thumb: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : undefined,
    }
    await remember(videoId, track)
    return track
  } catch {
    // Video privado, borrado, o sin red: el id alcanza para encolarlo.
    return fallback
  }
}

const readCache = async (): Promise<Cache> => {
  const stored = await chrome.storage.local.get(CACHE_KEY)
  return (stored[CACHE_KEY] as Cache | undefined) ?? {}
}

const remember = async (videoId: string, track: Track): Promise<void> => {
  const cache = await readCache()
  cache[videoId] = track
  const entries = Object.entries(cache).slice(-CACHE_MAX_ENTRIES)
  await chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(entries) })
}
