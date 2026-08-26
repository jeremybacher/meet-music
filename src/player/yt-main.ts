/**
 * Mundo MAIN de las páginas de YouTube.
 *
 * Existe por una sola razón: `#movie_player` expone `loadVideoById`, `playVideo` y compañía como
 * propiedades que agrega la página, y el mundo aislado no las ve. Poder cambiar de canción sin
 * recargar es lo que mantiene vivo el mismo documento —y con él la activación de autoplay, el
 * `<video>` capturado y la conexión WebRTC—, así que entre temas no hay ni corte ni bloqueo.
 */
import { YT_BRIDGE, type FromYtMain, type ToYtMain } from '../core/messages.js'

interface VideoData {
  video_id?: string
  title?: string
  author?: string
}

interface MoviePlayer extends HTMLElement {
  loadVideoById?: (videoId: string) => void
  playVideo?: () => void
  pauseVideo?: () => void
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void
  getVideoData?: () => VideoData
}

const post = (msg: FromYtMain): void => {
  window.postMessage({ __bridge: YT_BRIDGE, dir: 'from-main', msg }, window.location.origin)
}

const player = (): MoviePlayer | null => document.querySelector<MoviePlayer>('#movie_player')

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return
  const data = event.data as { __bridge?: string; dir?: string; msg?: ToYtMain }
  if (!data || data.__bridge !== YT_BRIDGE || data.dir !== 'to-main' || !data.msg) return

  const el = player()
  const msg = data.msg

  if (msg.type === 'load') {
    if (typeof el?.loadVideoById !== 'function') {
      post({ type: 'api-missing' })
      return
    }
    el.loadVideoById(msg.videoId)
    post({ type: 'loaded', videoId: msg.videoId })
    return
  }

  if (msg.type === 'play') el?.playVideo?.()
  else if (msg.type === 'pause') el?.pauseVideo?.()
  else if (msg.type === 'seek') el?.seekTo?.(msg.seconds, true)
})

/**
 * El id y el título del video que realmente está cargado. Se emiten juntos para que nunca queden
 * desfasados entre sí, que es lo que pasaba leyendo `document.title`.
 */
let lastData = ''
setInterval(() => {
  const data = player()?.getVideoData?.()
  if (!data?.video_id || !data.title) return

  const fingerprint = `${data.video_id}|${data.title}`
  if (fingerprint === lastData) return
  lastData = fingerprint

  post({
    type: 'videoData',
    videoId: data.video_id,
    title: data.title,
    author: data.author ?? null,
  })
}, 500)
