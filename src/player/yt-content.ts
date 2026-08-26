/**
 * Lado YouTube. Corre como content script en las páginas de reproducción.
 *
 * Toma el audio directo del elemento <video> con captureStream() —sin permisos especiales, sin
 * tabCapture— y se lo manda a la pestaña de Meet por una conexión WebRTC local. Los dos extremos
 * están en el mismo navegador, así que ICE resuelve con candidatos de host y el enlace es inmediato.
 */
import { preferHighQualityOpus, raiseAudioBitrate } from '../core/sdp.js'
import {
  PORT_PLAYER,
  YT_BRIDGE,
  type FromYtMain,
  type PlayerCmd,
  type PlayerEvent,
  type PlayerState,
  type Signal,
  type ToYtMain,
} from '../core/messages.js'

const port = chrome.runtime.connect({ name: PORT_PLAYER })

let pc: RTCPeerConnection | null = null
let video: HTMLVideoElement | null = null
let lastSent = ''
/** Se emite una sola vez por documento, para que el service worker devuelva el foco al Meet. */
let reportedPlaying = false
/**
 * Qué canción pedimos. Es la fuente de verdad porque `loadVideoById` cambia el video **sin tocar
 * la URL**, así que leer `?v=` reportaría eternamente la primera.
 */
let requestedVideoId: string | null = null
/** Lo que el reproductor tiene cargado ahora mismo. Durante un anuncio, son los datos del aviso. */
let loadedVideoId: string | null = null
/** Título real del video cargado, informado por el mundo MAIN junto con su id. */
let videoTitle: string | null = null
let videoAuthor: string | null = null
/** El listener de fin vive en el elemento, que se reutiliza: no hay que duplicarlo. */
let endWatched = false
/** El emisor de audio, para poder cambiarle la pista sin repactar la conexión. */
let audioSender: RTCRtpSender | null = null
let recapturing = false

/** Grafo de Web Audio: se arma una sola vez y sobrevive los cambios de canción. */
let ytCtx: AudioContext | null = null
let graphDest: MediaStreamAudioDestinationNode | null = null
let graphAnalyser: AnalyserNode | null = null
/** Lo que escucha el DJ, aplicado en la fuente para que no dependa del viaje por WebRTC. */
let monitorGain: GainNode | null = null
let monitorLevel = 0.35
let usingWebAudio = false
/** Una vez que Web Audio falla, no se reintenta: el elemento ya no se puede volver a tomar. */
let fellBackToCapture = false
/** Sondeos consecutivos sin señal mientras el video corre. Ver `watchForSilence`. */
let silentTicks = 0
/** Último veredicto de `watchForSilence`, para mostrarlo en el panel. */
let hasSignal = false
let rescueAttempts = 0

const toMain = (msg: ToYtMain): void => {
  window.postMessage({ __bridge: YT_BRIDGE, dir: 'to-main', msg }, window.location.origin)
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return
  const data = event.data as { __bridge?: string; dir?: string; msg?: FromYtMain }
  if (!data || data.__bridge !== YT_BRIDGE || data.dir !== 'from-main' || !data.msg) return

  if (data.msg.type === 'api-missing') {
    emit({ type: 'capture-failed', error: 'The YouTube player does not expose its API on this page' })
    return
  }

  if (data.msg.type === 'videoData') {
    loadedVideoId = data.msg.videoId
    videoTitle = data.msg.title
    videoAuthor = data.msg.author
  }
})

const emit = (event: PlayerEvent): void => {
  try {
    port.postMessage(event)
  } catch {
    // El service worker se durmió; el próximo tick reintenta.
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** El <video> aparece recién cuando YouTube termina de montar el reproductor. */
const findVideo = async (): Promise<HTMLVideoElement> => {
  for (let i = 0; i < 150; i++) {
    const el = document.querySelector<HTMLVideoElement>('video')
    if (el && el.readyState >= 1) return el
    await sleep(200)
  }
  throw new Error('The YouTube player never showed up on the page')
}

/**
 * Toma el audio del reproductor por Web Audio.
 *
 * `createMediaElementSource` se ata **al elemento**, no al recurso que está reproduciendo, así que
 * el stream resultante sobrevive los cambios de canción. `captureStream()` no: su pista se muere
 * en cuanto el video cambia, y ese era el motivo por el que "Siguiente" dejaba todo mudo.
 */
const viaWebAudio = async (el: HTMLVideoElement): Promise<MediaStream> => {
  if (!ytCtx) ytCtx = new AudioContext()
  if (ytCtx.state === 'suspended') await ytCtx.resume().catch(() => undefined)

  if (!graphDest) {
    // Sólo se puede crear una vez por elemento; si YouTube ya creó la suya, esto tira y caemos
    // al plan B.
    const source = ytCtx.createMediaElementSource(el)
    graphDest = ytCtx.createMediaStreamDestination()
    graphAnalyser = ytCtx.createAnalyser()
    graphAnalyser.fftSize = 512
    source.connect(graphDest)
    source.connect(graphAnalyser)

    // Rama de monitor: lo que escucha quien puso la música, directo de la fuente. Es independiente
    // de lo que sale a la reunión, y sobre todo no depende del enlace WebRTC.
    monitorGain = ytCtx.createGain()
    monitorGain.gain.value = monitorLevel
    source.connect(monitorGain)
    monitorGain.connect(ytCtx.destination)
  }

  const track = graphDest.stream.getAudioTracks()[0]
  if (!track) throw new Error('The audio graph produced no track')
  return new MediaStream([track])
}

/** Plan B, por si Web Audio no puede tomar el elemento. */
const viaCaptureStream = async (el: HTMLVideoElement): Promise<MediaStream> => {
  const capture = (el as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream
  if (typeof capture !== 'function') {
    throw new Error('This Chrome does not support captureStream() on the video')
  }

  const stream = capture.call(el)
  for (let i = 0; i < 100; i++) {
    const track = stream.getAudioTracks().find((t) => t.readyState === 'live')
    if (track) return new MediaStream([track])
    await sleep(100)
  }
  throw new Error('The video exposed no audio track (is it protected content?)')
}

const acquireAudio = async (el: HTMLVideoElement): Promise<MediaStream> => {
  if (!fellBackToCapture) {
    try {
      const stream = await viaWebAudio(el)
      usingWebAudio = true
      return stream
    } catch {
      // Ya sea porque el elemento estaba tomado o porque el contexto no arrancó.
      fellBackToCapture = true
    }
  }
  usingWebAudio = false
  return viaCaptureStream(el)
}

/**
 * Con el plan B hay que vigilar la pista, porque muere al cambiar de canción. Se reemplaza sobre el
 * emisor existente para no repactar la conexión.
 */
const recapture = async (): Promise<void> => {
  if (recapturing || !video) return
  recapturing = true
  try {
    const fresh = await viaCaptureStream(video)
    const track = fresh.getAudioTracks()[0]
    if (audioSender && track) await audioSender.replaceTrack(track)
    else await connect()
  } catch (err) {
    emit({ type: 'capture-failed', error: err instanceof Error ? err.message : String(err) })
  } finally {
    recapturing = false
  }
}

const connect = async (): Promise<void> => {
  video = await findVideo()
  requestedVideoId ??= new URL(location.href).searchParams.get('v')
  endWatched = false

  // Sin reproducir no hay pista de audio que capturar.
  video.muted = false
  video.volume = 1
  try {
    await video.play()
  } catch {
    // Chrome bloqueó el autoplay: el panel de Meet ofrece traer al usuario hasta acá.
    emit({ type: 'needs-gesture' })
  }

  watchForEnd(video)
  const audio = await acquireAudio(video)
  rescueAttempts = 0

  pc?.close()
  pc = new RTCPeerConnection()
  audioSender = null
  for (const track of audio.getAudioTracks()) audioSender = pc.addTrack(track, audio)

  pc.onicecandidate = (event) => {
    if (event.candidate) emit({ type: 'signal', signal: { kind: 'ice', candidate: event.candidate.toJSON() } })
  }

  if (audioSender) await raiseAudioBitrate(audioSender)

  const offer = await pc.createOffer()
  // El tramo YouTube → Meet es enteramente local: no hay motivo para codificar como si fuera voz.
  const sdp = preferHighQualityOpus(offer.sdp ?? '')
  await pc.setLocalDescription({ type: 'offer', sdp })
  emit({ type: 'signal', signal: { kind: 'offer', sdp } })
}

port.onMessage.addListener((raw) => {
  const cmd = raw as PlayerCmd
  switch (cmd.type) {
    case 'connect':
      connect().catch((err: unknown) => {
        emit({ type: 'capture-failed', error: err instanceof Error ? err.message : String(err) })
      })
      break

    case 'signal':
      void handleSignal(cmd.signal)
      break

    case 'load':
      // Sin recargar: mismo documento, mismo <video>, misma conexión WebRTC.
      requestedVideoId = cmd.videoId
      loadedVideoId = null
      videoTitle = null
      videoAuthor = null
      toMain({ type: 'load', videoId: cmd.videoId })
      break

    case 'play':
      toMain({ type: 'play' })
      void video?.play().catch(() => emit({ type: 'needs-gesture' }))
      break

    case 'pause':
      toMain({ type: 'pause' })
      video?.pause()
      break

    case 'seek':
      toMain({ type: 'seek', seconds: cmd.seconds })
      break

    case 'monitor':
      monitorLevel = Math.min(1, Math.max(0, cmd.level))
      if (monitorGain && ytCtx) {
        monitorGain.gain.setTargetAtTime(monitorLevel, ytCtx.currentTime, 0.02)
      } else if (video) {
        // Sin grafo (plan B por captureStream) la pestaña suena sola: el volumen es el del video.
        video.volume = monitorLevel
      }
      break
  }
})

const handleSignal = async (signal: Signal): Promise<void> => {
  if (!pc) return
  if (signal.kind === 'answer') {
    await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
  } else if (signal.kind === 'ice') {
    await pc.addIceCandidate(signal.candidate).catch(() => undefined)
  }
}

// ---------------------------------------------------------------- estado

const currentVideoId = (): string | null =>
  loadedVideoId ?? requestedVideoId ?? new URL(location.href).searchParams.get('v')

/** En una página real de YouTube el anuncio se marca en el DOM, así que esto es confiable. */
const adShowing = (): boolean =>
  document.querySelector('#movie_player')?.classList.contains('ad-showing') ?? false

const readState = (): PlayerState => {
  const el = video ?? document.querySelector<HTMLVideoElement>('video')
  const phase: PlayerState['phase'] = !el
    ? 'unstarted'
    : el.ended
      ? 'ended'
      : el.paused
        ? 'paused'
        : el.readyState < 3
          ? 'buffering'
          : 'playing'

  return {
    phase,
    currentTime: el?.currentTime ?? 0,
    duration: Number.isFinite(el?.duration) ? (el?.duration ?? 0) : 0,
    videoId: currentVideoId(),
    title: videoTitle ?? (document.title.replace(/\s*-\s*YouTube\s*$/, '').trim() || null),
    author: videoAuthor,
    adLikely: adShowing(),
    source: pc ? (usingWebAudio ? 'webaudio' : 'capture') : null,
    signal: hasSignal,
  }
}

/**
 * `loadVideoById` normalmente reutiliza el mismo <video>, pero si YouTube lo reemplaza el stream
 * capturado se queda mudo. Lo detectamos y rehacemos la captura.
 */
const ensureStillCaptured = (): void => {
  if (!video || recapturing) return

  const current = document.querySelector<HTMLVideoElement>('video')
  if (current && current !== video) {
    // YouTube reemplazó el elemento: hay que rearmar desde cero.
    connect().catch((err: unknown) => {
      emit({ type: 'capture-failed', error: err instanceof Error ? err.message : String(err) })
    })
    return
  }

  if (usingWebAudio) {
    // El contexto puede quedar suspendido si Chrome lo frena; sin esto el grafo sale mudo.
    if (ytCtx?.state === 'suspended') void ytCtx.resume().catch(() => undefined)
    return
  }

  // Con captureStream, la pista se muere al cambiar de canción.
  const track = audioSender?.track
  if (pc && track && track.readyState !== 'live') void recapture()
}

/**
 * Vigila que por el grafo esté saliendo señal de verdad.
 *
 * No alcanza con mirar si la pista sigue "viva": puede quedar en `live` y emitir silencio, que es
 * exactamente el modo en que fallaba el cambio de canción. Acá medimos la señal real, y si el video
 * está corriendo con volumen pero no sale nada, rearmamos la toma con el otro método.
 */
const watchForSilence = (): void => {
  const playing = video && !video.paused && !video.muted && video.volume > 0 && !adShowing()
  if (!playing || !pc || recapturing) {
    silentTicks = 0
    return
  }


  const analyser = usingWebAudio ? graphAnalyser : null
  if (analyser) {
    const buf = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (const v of buf) peak = Math.max(peak, Math.abs(v))
    hasSignal = peak >= 1e-4
  } else {
    const track = audioSender?.track
    hasSignal = !!track && track.readyState === 'live'
  }
  silentTicks = hasSignal ? 0 : silentTicks + 1

  // ~6 segundos de silencio con el video sonando: algo se cortó.
  if (silentTicks < 12) return
  silentTicks = 0

  if (rescueAttempts >= 2) {
    emit({
      type: 'capture-failed',
      error: 'YouTube audio stopped coming through. Try “Share the tab by hand”.',
    })
    rescueAttempts = 0
    return
  }
  rescueAttempts++

  // Si Web Audio no está entregando nada, pasamos al otro método y rearmamos.
  if (usingWebAudio) fellBackToCapture = true
  void recapture()
}

setInterval(() => {
  ensureStillCaptured()
  watchForSilence()
  const state = readState()

  // La primera reproducción real confirma que Chrome dejó sonar la pestaña.
  if (!reportedPlaying && state.phase === 'playing') {
    reportedPlaying = true
    emit({ type: 'gesture-granted' })
  }
  // Sin el tiempo, el resto del estado cambia poco: evitamos inundar el puerto.
  const fingerprint = `${state.phase}|${state.videoId}|${state.title}|${state.adLikely}|${Math.floor(state.currentTime)}|${Math.floor(state.duration)}`
  if (fingerprint === lastSent) return
  lastSent = fingerprint
  emit({ type: 'state', state })
}, 500)

/**
 * Al terminar, YouTube arranca una cuenta regresiva para navegar solo al "próximo" video sugerido.
 * Lo frenamos en seco y avisamos enseguida, sin esperar al sondeo, para que el panel cargue la
 * canción que sigue en NUESTRA cola.
 */
const watchForEnd = (el: HTMLVideoElement): void => {
  if (endWatched) return
  endWatched = true
  el.addEventListener('ended', () => {
    el.pause()
    emit({ type: 'state', state: { ...readState(), phase: 'ended' } })
  })
}

// Un clic en cualquier parte de la página cuenta como gesto: reintentamos el play.
document.addEventListener(
  'click',
  () => {
    if (video?.paused) void video.play().catch(() => undefined)
    if (ytCtx?.state === 'suspended') void ytCtx.resume().catch(() => undefined)
    emit({ type: 'gesture-granted' })
  },
  { capture: true },
)

emit({ type: 'ready' })
