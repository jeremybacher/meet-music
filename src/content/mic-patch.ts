/**
 * Corre en el mundo MAIN a document_start, antes que cualquier script de Meet.
 *
 * Principio de diseño: **mientras no haya música, no tocamos nada.** getUserMedia devuelve el
 * micrófono tal cual, no se crea ningún AudioContext y ni siquiera corre un timer, así que la
 * extensión instalada pero ociosa no puede colorear ni ensuciar tu voz. Recién cuando empieza a
 * sonar algo armamos el mezclador y cambiamos la pista en caliente con RTCRtpSender.replaceTrack().
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

/** Lo que se le dice al panel cuando el grafo está armado pero Meet todavía no transmite audio. */
const NOT_SENDING_YET =
  'Meet is not sending your microphone yet. Turn it on in Meet and the music comes in on its own.'

function install(mediaDevices: MediaDevices): void {
  const originalGum = mediaDevices.getUserMedia.bind(mediaDevices)
  const originalGdm =
    typeof mediaDevices.getDisplayMedia === 'function'
      ? mediaDevices.getDisplayMedia.bind(mediaDevices)
      : null

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
  /**
   * Pistas de audio que NO son el micrófono: las que salen de getDisplayMedia cuando alguien
   * comparte una pestaña con sonido. Meet las manda por un emisor aparte y pisarlas con la mezcla
   * silenciaría lo que la persona está compartiendo.
   */
  const displayTrackIds = new Set<string>()

  /** Cuántos emisores de Meet están llevando la mezcla ahora mismo. 0 = nadie nos escucha. */
  let attached = 0
  /** El reconciliador sólo existe mientras hay música: sin ella no corre ningún timer. */
  let reconcileTimer: ReturnType<typeof setInterval> | null = null
  let watchdogTimer: ReturnType<typeof setInterval> | null = null

  const post = (msg: ToIsolated): void => {
    window.postMessage({ __bridge: BRIDGE, dir: 'to-isolated', msg }, window.location.origin)
  }

  // DEBUG: rama de diagnóstico, no mergear. Filtrá la consola por "mm:dbg".
  const dbg = (...a: unknown[]): void => console.log('[mm:dbg]', ...a)
  const senderInfo = (s: RTCRtpSender): unknown => ({
    track: s.track && {
      id: s.track.id.slice(0, 8),
      label: s.track.label,
      kind: s.track.kind,
      state: s.track.readyState,
      enabled: s.track.enabled,
      muted: s.track.muted,
    },
    isMix: s.track === mixedTrack,
    dtx: (() => {
      try {
        return s.getParameters().encodings?.[0]
      } catch {
        return 'n/a'
      }
    })(),
  })

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
    dbg('getUserMedia called. audio=', !!constraints?.audio, 'audioTracks=', real.getAudioTracks().length, 'musicActive=', musicActive())
    if (!constraints || !constraints.audio || real.getAudioTracks().length === 0) return real

    realStream = real

    // Sin música, el micrófono sale intacto: cero procesamiento, cero riesgo de zumbido.
    if (!musicActive()) return real
    dbg('getUserMedia: music active, returning the MIXED stream to Meet')

    try {
      const mixed = ensureMixer().createMixedStream(real)
      const track = mixed.getAudioTracks()[0]
      if (track) mixedTrack = track
      post({ type: 'mic-attached' })
      return mixed
    } catch (err) {
      console.error('[meet-music] mixing failed, returning the microphone untouched', err)
      return real
    }
  }

  /**
   * El audio de pantalla compartida no es el micrófono: se anota para no reemplazarlo nunca.
   * Sin esto, compartir una pestaña con sonido mientras suena música dejaba muda esa pestaña.
   */
  if (originalGdm) {
    mediaDevices.getDisplayMedia = async function (
      constraints?: DisplayMediaStreamOptions,
    ): Promise<MediaStream> {
      const stream = await originalGdm(constraints)
      for (const track of stream.getAudioTracks()) displayTrackIds.add(track.id)
      return stream
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
      const created = Reflect.construct(target, args, newTarget) as RTCPeerConnection
      connections.add(created)
      dbg('PC created via proxy. connections=', connections.size, 'musicActive=', musicActive())
      created.addEventListener('connectionstatechange', () => {
        dbg('PC connectionState=', created.connectionState)
        if (created.connectionState === 'closed') connections.delete(created)
      })
      // Cuando se suma alguien, Meet renegocia. Es el momento exacto en que aparece un emisor
      // nuevo con el micrófono crudo, así que reconciliamos ahí mismo en vez de esperar al sondeo.
      created.addEventListener('negotiationneeded', () => {
        dbg('PC negotiationneeded, signalingState=', created.signalingState)
        void reconcileOutgoing()
      })
      created.addEventListener('signalingstatechange', () => void reconcileOutgoing())
      return created
    },
  })

  const audioSenders = (): RTCRtpSender[] => {
    const senders: RTCRtpSender[] = []
    for (const connection of connections) {
      try {
        for (const sender of connection.getSenders()) {
          if (sender.track?.kind === 'audio') senders.push(sender)
        }
      } catch {
        connections.delete(connection)
      }
    }
    return senders
  }

  /** ¿Esta pista es un micrófono que deberíamos estar reemplazando por la mezcla? */
  const isMicTrack = (track: MediaStreamTrack | null): track is MediaStreamTrack =>
    track !== null && track.kind === 'audio' && track !== mixedTrack && !displayTrackIds.has(track.id)

  /**
   * Si Meet cambia de micrófono mientras hay música, va a pisar nuestra pista mezclada con la
   * cruda. Interceptamos para devolverle la mezclada y quedarnos con el micrófono nuevo.
   */
  const nativeReplaceTrack = RTCRtpSender.prototype.replaceTrack
  RTCRtpSender.prototype.replaceTrack = function (
    this: RTCRtpSender,
    track: MediaStreamTrack | null,
  ) {
    if (!swapping) {
      dbg('Meet replaceTrack(', track && { id: track.id.slice(0, 8), kind: track.kind, label: track.label }, ') musicActive=', musicActive(), 'isMic=', isMicTrack(track))
    }
    if (!swapping && musicActive() && mixedTrack && isMicTrack(track)) {
      managed.add(this)
      dbg('Meet replaceTrack -> swapped to MIX')
      return nativeReplaceTrack.call(this, mixedTrack)
    }
    return nativeReplaceTrack.call(this, track)
  }

  /**
   * `addTrack` y `addTransceiver` son el otro camino por el que Meet empieza a transmitir audio, y
   * el que se usa cuando **abre una conexión nueva** — que es justo lo que pasa cuando se suma
   * alguien a la reunión. Sin interceptarlos, esa conexión nace con el micrófono crudo y la persona
   * que acaba de entrar no escucha la música.
   */
  const nativeAddTrack = NativePeerConnection.prototype.addTrack
  NativePeerConnection.prototype.addTrack = function (
    this: RTCPeerConnection,
    track: MediaStreamTrack,
    ...streams: MediaStream[]
  ): RTCRtpSender {
    connections.add(this)
    dbg('Meet addTrack(', { id: track.id.slice(0, 8), kind: track.kind, label: track.label }, ') musicActive=', musicActive(), 'isMic=', isMicTrack(track))
    if (musicActive() && mixedTrack && isMicTrack(track)) {
      const sender = nativeAddTrack.call(this, mixedTrack, ...streams)
      managed.add(sender)
      dbg('Meet addTrack -> added MIX instead')
      return sender
    }
    return nativeAddTrack.call(this, track, ...streams)
  }

  const nativeAddTransceiver = NativePeerConnection.prototype.addTransceiver
  NativePeerConnection.prototype.addTransceiver = function (
    this: RTCPeerConnection,
    trackOrKind: MediaStreamTrack | string,
    init?: RTCRtpTransceiverInit,
  ): RTCRtpTransceiver {
    connections.add(this)
    dbg('Meet addTransceiver(', typeof trackOrKind === 'string' ? trackOrKind : { id: trackOrKind.id.slice(0, 8), kind: trackOrKind.kind }, ', dir=', init?.direction, ') musicActive=', musicActive())
    if (
      musicActive() &&
      mixedTrack &&
      typeof trackOrKind !== 'string' &&
      isMicTrack(trackOrKind)
    ) {
      const transceiver = nativeAddTransceiver.call(this, mixedTrack, init)
      managed.add(transceiver.sender)
      dbg('Meet addTransceiver -> with MIX')
      return transceiver
    }
    return nativeAddTransceiver.call(this, trackOrKind, init)
  }

  /**
   * Cambia lo que Meet está transmitiendo. Devuelve cuántos emisores aceptaron la pista.
   * Nunca recibe `null`: dejar un emisor sin pista equivale a mutear al usuario en silencio.
   */
  const swapOutgoing = async (track: MediaStreamTrack): Promise<number> => {
    swapping = true
    let applied = 0
    const all = audioSenders()
    dbg('swapOutgoing: connections=', connections.size, 'audioSenders=', all.length, all.map(senderInfo))
    try {
      for (const sender of all) {
        if (sender.track !== track && displayTrackIds.has(sender.track?.id ?? '')) {
          dbg('swapOutgoing: skipping display sender', senderInfo(sender))
          continue
        }
        try {
          await nativeReplaceTrack.call(sender, track)
          managed.add(sender)
          applied++
          dbg('swapOutgoing: replaced sender OK', senderInfo(sender))
        } catch (e) {
          dbg('swapOutgoing: replaceTrack THREW', e)
        }
      }
    } finally {
      swapping = false
    }
    dbg('swapOutgoing done. applied=', applied)
    return applied
  }

  /**
   * Mantiene la mezcla en **todos** los emisores de audio de Meet, no sólo en los que existían
   * cuando arrancó la música.
   *
   * Este es el motivo por el que quien entraba después no escuchaba nada: al sumarse una persona,
   * Meet renegocia —y a veces abre una conexión nueva— con la pista cruda del micrófono. Un
   * intercambio de una sola vez no la alcanza, así que la música quedaba sonando sólo para quienes
   * ya estaban, y la única salida era que quien reproducía saliera y volviera a entrar.
   *
   * Corre sólo mientras hay música: sin ella el timer ni siquiera existe.
   */
  const reconcileOutgoing = async (): Promise<void> => {
    if (swapping || !musicActive()) return
    const track = mixedTrack
    if (!track || track.readyState !== 'live') return

    const all = audioSenders()
    const stale = all.filter((s) => isMicTrack(s.track))
    const carryingNow = all.filter((s) => s.track === track).length
    // Ruidoso a propósito, pero no cada segundo: sólo cuando hay algo que reconciliar o nadie lleva la mezcla.
    if (stale.length > 0 || carryingNow === 0) {
      dbg('reconcile: audioSenders=', all.length, 'stale(mic)=', stale.length, 'carrying=', carryingNow, all.map(senderInfo))
    }
    if (stale.length > 0) {
      swapping = true
      try {
        for (const sender of stale) {
          try {
            await nativeReplaceTrack.call(sender, track)
            managed.add(sender)
          } catch {
            managed.delete(sender)
          }
        }
      } finally {
        swapping = false
      }
    }

    const carrying = audioSenders().filter((s) => s.track === track).length
    if (carrying === attached) return
    const wasAttached = attached > 0
    attached = carrying
    if (carrying > 0 && !wasAttached) post({ type: 'music-attached' })
    if (carrying === 0 && wasAttached) post({ type: 'music-pending', reason: NOT_SENDING_YET })
  }

  const startWatchers = (): void => {
    if (reconcileTimer === null) reconcileTimer = setInterval(() => void reconcileOutgoing(), 1000)
    if (watchdogTimer === null) watchdogTimer = setInterval(() => void watchOutgoing(), 3000)
    // DEBUG: foto del estado cada 5s mientras suena música, para ver el régimen permanente.
    setInterval(() => {
      if (!musicActive()) return
      const all = audioSenders()
      dbg('SNAPSHOT connections=', connections.size, 'attached=', attached, 'senders=', all.length, all.map(senderInfo))
    }, 5000)
  }

  const stopWatchers = (): void => {
    if (reconcileTimer !== null) clearInterval(reconcileTimer)
    reconcileTimer = null
    if (watchdogTimer !== null) clearInterval(watchdogTimer)
    watchdogTimer = null
    attached = 0
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
    dbg('useStream: realStream audioTracks=', realStream.getAudioTracks().map((t) => ({ id: t.id.slice(0, 8), state: t.readyState, enabled: t.enabled })))
    attached = await swapOutgoing(track)
    // Se arranca igual con cero emisores: el reconciliador engancha la mezcla en cuanto Meet
    // empiece a transmitir, sin que haya que volver a apretar nada.
    startWatchers()

    if (attached === 0) {
      dbg('useStream: attached=0 -> music-pending')
      post({ type: 'music-pending', reason: NOT_SENDING_YET })
      return
    }
    dbg('useStream: attached=', attached, '-> music-attached')
    post({ type: 'music-attached' })
  }

  const onSignal = async (signal: Signal): Promise<void> => {
    if (signal.kind === 'offer') {
      await detachMusic()
      pc = new NativePeerConnection()

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
    const stream = await mediaDevices.getDisplayMedia({ video: true, audio: true })
    const audio = stream.getAudioTracks()
    for (const track of stream.getVideoTracks()) track.stop()
    if (audio.length === 0) {
      throw new Error('You need to tick "Share tab audio" in Chrome\'s picker')
    }
    // Es nuestra fuente de música, no algo que Meet esté compartiendo: sale de la lista de
    // intocables o el mezclador no podría usarla.
    for (const track of audio) displayTrackIds.delete(track.id)
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
    stopWatchers()

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
          outgoing: attached,
          senders: audioSenders().length,
        })
        break
    }
  })

  /**
   * Vigila que Meet nunca quede transmitiendo una pista muerta, y que el micrófono que alimenta al
   * mezclador siga vivo.
   *
   * Es el peor fallo posible del patch porque es invisible: Meet te muestra como muteado, tu botón
   * de micrófono dice que no lo estás, y nadie te escucha. Ante la duda preferimos reponer el
   * micrófono, aunque eso signifique perder la música un instante.
   */
  const watchOutgoing = async (): Promise<void> => {
    if (swapping) return

    // El micrófono que entra al mezclador puede morirse solo (cambio de dispositivo, suspensión).
    // La pista mezclada sigue "viva" y silenciosa, así que nada más lo delataría.
    if (musicActive() && mixer && !realStream?.getAudioTracks().some((t) => t.readyState === 'live')) {
      const fresh = await liveMicTrack()
      if (fresh && realStream) {
        mixer.setMicSource(realStream)
        post({ type: 'outgoing-restored' })
      }
    }

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

  post({ type: 'patch-installed' })
}
