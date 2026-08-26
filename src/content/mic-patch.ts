/**
 * Corre en el mundo MAIN a document_start, antes que cualquier script de Meet.
 *
 * Principio de diseño: **mientras no haya música, no tocamos nada.** getUserMedia devuelve el
 * micrófono tal cual y ni siquiera se crea un AudioContext, así que la extensión instalada pero
 * ociosa no puede colorear ni ensuciar tu voz. Recién cuando empieza a sonar algo armamos el
 * mezclador y cambiamos la pista en caliente con RTCRtpSender.replaceTrack().
 *
 * Acá NO hay APIs de chrome.* — el mundo MAIN no las tiene. Todo va por window.postMessage contra
 * el content script aislado.
 */
import { BRIDGE, type Signal, type ToIsolated, type ToMain } from '../core/messages.js'
import { DEFAULT_LEVELS, Mixer } from '../core/mixer.js'
import { preferHighQualityOpus } from '../core/sdp.js'

const md = navigator.mediaDevices
if (!md || typeof md.getUserMedia !== 'function') {
  console.warn('[meet-music] mediaDevices unavailable, skipping the patch')
} else {
  install(md)
}

function install(mediaDevices: MediaDevices): void {
  const originalGum = mediaDevices.getUserMedia.bind(mediaDevices)

  let ctx: AudioContext | null = null
  let mixer: Mixer | null = null
  let musicStream: MediaStream | null = null
  let pc: RTCPeerConnection | null = null
  /**
   * Chrome no deja fluir el audio de un track remoto de WebRTC hacia Web Audio salvo que el stream
   * esté además enganchado a un elemento de medios. Este <audio> silenciado existe sólo para eso.
   */
  let keepAlive: HTMLAudioElement | null = null

  /** El último micrófono real que le dimos a Meet, para poder mezclarlo o restaurarlo. */
  let realStream: MediaStream | null = null
  /** La pista mezclada que Meet está transmitiendo, si hay música. */
  let mixedTrack: MediaStreamTrack | null = null
  /** Todas las conexiones que abre Meet; los emisores se leen recién al momento de cambiar. */
  const connections = new Set<RTCPeerConnection>()
  /** Evita que nuestro propio replaceTrack vuelva a entrar por el patch. */
  let swapping = false
  /** Emisores a los que ya les pusimos una pista: los vigilamos para que no queden vacíos. */
  const managed = new Set<RTCRtpSender>()

  const post = (msg: ToIsolated): void => {
    window.postMessage({ __bridge: BRIDGE, dir: 'to-isolated', msg }, window.location.origin)
  }

  const musicActive = (): boolean => musicStream !== null

  const ensureMixer = (): Mixer => {
    // Sin forzar `sampleRate`: dejar que Chrome elija la del dispositivo evita que tenga que
    // remuestrear en cada bloque, que es lo que volvía metálica la voz.
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    if (!mixer) mixer = new Mixer(ctx)
    return mixer
  }

  // ---------------------------------------------------------------- getUserMedia

  mediaDevices.getUserMedia = async function (constraints?: MediaStreamConstraints): Promise<MediaStream> {
    const real = await originalGum(constraints)
    if (!constraints || !constraints.audio || real.getAudioTracks().length === 0) return real

    realStream = real

    // Sin música, el micrófono sale intacto: cero procesamiento, cero riesgo de zumbido.
    if (!musicActive()) return real

    try {
      const mixed = ensureMixer().createMixedStream(real)
      post({ type: 'mic-attached' })
      return mixed
    } catch (err) {
      console.error('[meet-music] mixing failed, returning the microphone untouched', err)
      return real
    }
  }

  // ---------------------------------------------------------------- emisores de Meet

  /**
   * Nos quedamos con cada RTCPeerConnection que abre Meet. Un Proxy sobre el constructor cubre
   * todos los caminos de creación y mantiene intactos `instanceof`, el prototipo y los estáticos.
   *
   * No registramos los emisores al crearlos: Meet suele armar el transceiver de audio antes de
   * tener la pista, así que en ese momento `sender.track` todavía es null. Los senders se leen
   * recién al momento de cambiar, cuando ya tienen pista.
   */
  const NativePeerConnection = window.RTCPeerConnection
  window.RTCPeerConnection = new Proxy(NativePeerConnection, {
    construct(target, args, newTarget) {
      const pc = Reflect.construct(target, args, newTarget) as RTCPeerConnection
      connections.add(pc)
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'closed') connections.delete(pc)
      })
      return pc
    },
  })

  const audioSenders = (): RTCRtpSender[] => {
    const senders: RTCRtpSender[] = []
    for (const pc of connections) {
      try {
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind === 'audio') senders.push(sender)
        }
      } catch {
        connections.delete(pc)
      }
    }
    return senders
  }

  /**
   * Si Meet cambia de micrófono mientras hay música, va a pisar nuestra pista mezclada con la
   * cruda. Interceptamos para devolverle la mezclada y quedarnos con el micrófono nuevo.
   */
  const nativeReplaceTrack = RTCRtpSender.prototype.replaceTrack
  RTCRtpSender.prototype.replaceTrack = function (
    this: RTCRtpSender,
    track: MediaStreamTrack | null,
  ) {
    if (!swapping && mixedTrack && track && track.kind === 'audio' && track !== mixedTrack) {
      return nativeReplaceTrack.call(this, mixedTrack)
    }
    return nativeReplaceTrack.call(this, track)
  }

  /**
   * Cambia lo que Meet está transmitiendo. Devuelve cuántos emisores aceptaron la pista.
   * Nunca recibe `null`: dejar un emisor sin pista equivale a mutear al usuario en silencio.
   */
  const swapOutgoing = async (track: MediaStreamTrack): Promise<number> => {
    swapping = true
    let applied = 0
    try {
      for (const sender of audioSenders()) {
        try {
          await nativeReplaceTrack.call(sender, track)
          managed.add(sender)
          applied++
        } catch {
          // Ese emisor ya no sirve; seguimos con el resto.
        }
      }
    } finally {
      swapping = false
    }
    return applied
  }

  // ---------------------------------------------------------------- música

  const useStream = async (stream: MediaStream): Promise<void> => {
    musicStream = stream
    keepAlive = new Audio()
    keepAlive.srcObject = stream
    keepAlive.muted = true
    void keepAlive.play().catch(() => undefined)

    const m = ensureMixer()
    m.setMusicSource(stream)

    if (!realStream) {
      post({ type: 'music-failed', error: 'Meet has not requested the microphone yet' })
      return
    }

    const mixed = m.createMixedStream(realStream)
    const track = mixed.getAudioTracks()[0]
    if (!track) {
      post({ type: 'music-failed', error: 'The mixer produced no track' })
      return
    }

    mixedTrack = track
    const applied = await swapOutgoing(track)

    if (applied === 0) {
      // Meet todavía no está transmitiendo audio (por ejemplo, entraste con el micrófono apagado).
      // Igual queda todo armado: en cuanto lo prenda, el patch de getUserMedia devuelve la mezcla.
      post({
        type: 'music-failed',
        error: 'Meet is not sending audio yet. Turn on your mic and the music comes in on its own.',
      })
      return
    }
    post({ type: 'music-attached' })
  }

  const onSignal = async (signal: Signal): Promise<void> => {
    if (signal.kind === 'offer') {
      await detachMusic()
      pc = new RTCPeerConnection()

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track])
        void useStream(stream)
      }
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          post({ type: 'signal', signal: { kind: 'ice', candidate: event.candidate.toJSON() } })
        }
      }

      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
      const answer = await pc.createAnswer()
      const sdp = preferHighQualityOpus(answer.sdp ?? '')
      await pc.setLocalDescription({ type: 'answer', sdp })
      post({ type: 'signal', signal: { kind: 'answer', sdp } })
      return
    }

    if (signal.kind === 'ice' && pc) {
      await pc.addIceCandidate(signal.candidate).catch(() => undefined)
    }
  }

  /**
   * Plan B: si captureStream() falla, el usuario comparte la pestaña a mano. Requiere que tilde
   * "Compartir audio de la pestaña".
   */
  const captureDisplay = async (): Promise<void> => {
    await detachMusic()
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    const audio = stream.getAudioTracks()
    for (const track of stream.getVideoTracks()) track.stop()
    if (audio.length === 0) {
      throw new Error('You need to tick "Share tab audio" in Chrome\'s picker')
    }
    await useStream(new MediaStream(audio))
  }

  /**
   * Una pista de micrófono viva para devolverle a Meet.
   *
   * La guardada puede estar terminada (cambio de dispositivo, reconexión). Devolverle a Meet una
   * pista muerta —o peor, `null`— lo deja transmitiendo nada, que es indistinguible de estar
   * muteado: el botón dice que no lo estás, pero nadie te escucha.
   */
  const liveMicTrack = async (): Promise<MediaStreamTrack | null> => {
    const existing = realStream?.getAudioTracks()[0]
    if (existing && existing.readyState === 'live') return existing
    try {
      const fresh = await originalGum({ audio: true })
      realStream = fresh
      return fresh.getAudioTracks()[0] ?? null
    } catch {
      return null
    }
  }

  /**
   * Devuelve a Meet el micrófono crudo y desarma el grafo.
   *
   * El orden importa: el grafo se destruye **sólo si la devolución prendió**. Si Meet quedó
   * enviando nuestra pista mezclada porque el intercambio falló, cerrar el AudioContext la mataría
   * y dejaría al usuario mudo sin que nada lo indique.
   */
  const detachMusic = async (): Promise<void> => {
    const wasActive = musicActive()
    musicStream = null

    mixer?.clearMusicSource()
    pc?.close()
    pc = null
    if (keepAlive) {
      keepAlive.pause()
      keepAlive.srcObject = null
      keepAlive = null
    }

    if (!wasActive) return
    mixedTrack = null

    const mic = await liveMicTrack()
    if (!mic) {
      // Sin micrófono al que volver, conservamos el grafo: la pista mezclada sigue llevando tu voz.
      post({ type: 'music-failed', error: 'Could not restore the microphone; keeping the mixed track' })
      return
    }

    const applied = await swapOutgoing(mic)
    if (applied === 0 && audioSenders().length > 0) return

    mixer?.destroy()
    mixer = null
    await ctx?.close().catch(() => undefined)
    ctx = null
  }

  // ---------------------------------------------------------------- puente

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return
    const data = event.data as { __bridge?: string; dir?: string; msg?: ToMain }
    if (!data || data.__bridge !== BRIDGE || data.dir !== 'to-main' || !data.msg) return
    const msg = data.msg

    switch (msg.type) {
      case 'signal':
        onSignal(msg.signal).catch((err: unknown) => {
          void detachMusic()
          post({ type: 'music-failed', error: err instanceof Error ? err.message : String(err) })
        })
        break

      case 'capture-display':
        captureDisplay().catch((err: unknown) => {
          post({ type: 'music-failed', error: err instanceof Error ? err.message : String(err) })
        })
        break

      case 'stop-music':
        void detachMusic()
        break

      case 'set-levels':
        // Sin mezclador todavía no hay nada que ajustar: los niveles se aplican al crearlo.
        mixer?.setLevels(msg.levels)
        break

      case 'set-duck':
        mixer?.setDuck(msg.duck)
        break

      case 'query-status':
        post({
          type: 'status',
          micActive: realStream !== null,
          musicActive: musicActive(),
          ducking: mixer?.isDucking() ?? false,
          levels: mixer ? mixer.getLevels() : { ...DEFAULT_LEVELS },
        })
        break
    }
  })

  /**
   * Vigila que Meet nunca quede transmitiendo una pista muerta.
   *
   * Es el peor fallo posible del patch porque es invisible: Meet te muestra como muteado, tu botón
   * de micrófono dice que no lo estás, y nadie te escucha. Ante la duda preferimos reponer el
   * micrófono, aunque eso signifique perder la música un instante.
   */
  const watchOutgoing = async (): Promise<void> => {
    if (swapping) return

    const broken = [...managed].filter((s) => !s.track || s.track.readyState !== 'live')
    if (broken.length === 0) return

    const replacement = musicActive() && mixedTrack?.readyState === 'live' ? mixedTrack : await liveMicTrack()
    if (!replacement) return

    swapping = true
    try {
      for (const sender of broken) {
        try {
          await nativeReplaceTrack.call(sender, replacement)
        } catch {
          managed.delete(sender)
        }
      }
    } finally {
      swapping = false
    }
    post({ type: 'outgoing-restored' })
  }

  setInterval(() => void watchOutgoing(), 3000)

  post({ type: 'patch-installed' })
}
