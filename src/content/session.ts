/**
 * Controlador del panel. Concentra todo el cableado (puerto al service worker, puente al mundo
 * MAIN, transporte por chat, estado de la cola) y expone una vista plana para que la UI sea sólo
 * pintura.
 *
 * Modelo host/invitado: quien arranca el audio es el host y manda. Los invitados sólo emiten
 * intenciones por el chat y pintan el último snapshot que recibieron. Sin CRDT, sin conflictos.
 */
import {
  PORT_MEET,
  type PanelReq,
  type PlayerState,
  type Prefs,
  type SwEvent,
} from '../core/messages.js'
import { DEFAULT_DUCK, DEFAULT_LEVELS, type DuckConfig, type Levels } from '../core/mixer.js'
import { type Msg, type StateSnapshot, type Track } from '../core/protocol.js'
import { emptyState, reduce } from '../core/queue.js'
import { type ChatDiagnostics, ChatTransport } from './chat-transport.js'
import { deriveKey } from '../core/crypto.js'
import { meetingCode } from './meet-url.js'
import { detectDisplayName } from './meet-identity.js'
import { onMain, toMain } from './bridge.js'
import { type LinkProblem, parseLink } from '../youtube/parse-url.js'
import { type ResolvedTheme, type ThemePref, resolveTheme, watchSystemTheme } from '../core/theme.js'
import { announcementText } from '../core/announce.js'
import {
  type ParticipantReading,
  UNKNOWN,
  watchParticipants,
} from './meet-participants.js'
import {
  type MicButtonBox,
  boxOf,
  findMicButton,
  isMutedLabel,
  sameBox,
} from './meet-controls.js'

/**
 * `waiting` es el estado que faltaba: el grafo está armado y la música suena para vos, pero Meet
 * todavía no transmite tu audio, así que la reunión no escucha nada. No es un error —se arregla
 * solo— pero callarlo dejaba al DJ creyendo que estaba al aire.
 */
export type AudioStatus = 'off' | 'starting' | 'waiting' | 'on' | 'error'

/** Lo que devuelve `submit`, para que el campo pueda marcarse a sí mismo. */
export type SubmitResult = { ok: true } | { ok: false; problem: LinkProblem }

export interface SessionView {
  audio: AudioStatus
  error: string | null
  notice: string | null
  needsGesture: boolean
  isHost: boolean
  hostName: string | null
  state: StateSnapshot
  player: PlayerState | null
  levels: Levels
  duck: DuckConfig
  ducking: boolean
  /** El micrófono silenciado desde Meet: corta todo, música incluida. */
  micMuted: boolean
  /**
   * Dónde está el botón de micrófono de Meet, para poder ocupar su lugar mientras suena música.
   * `null` cuando no se lo encuentra o no está a la vista: ahí el nuestro vuelve al dock.
   */
  micButton: MicButtonBox | null
  /** Tu voz silenciada desde acá: la música sigue sonando para la reunión. */
  voiceMuted: boolean
  canBroadcast: boolean
  /** Los mensajes de la cola no están llegando al chat: hay que decirlo, no reintentar en silencio. */
  chatStuck: boolean
  /** Cerraste el chat varias veces: dejamos de reabrirlo y te damos a elegir. */
  chatNeedsDecision: boolean
  /** Qué está viendo y logrando el transporte, para poder diagnosticar sin adivinar. */
  chat: ChatDiagnostics
  displayName: string
  themePref: ThemePref
  theme: ResolvedTheme
  shareQueue: boolean
  /** Avisar por el chat, en texto legible, a quien se suma con la música ya sonando. */
  announce: boolean
  /**
   * Lo último que se pudo leer del roster de Meet, y cuántos avisos salieron.
   *
   * Está a la vista porque sin esto "no avisó" y "no encuentro el contador de Meet" se ven
   * exactamente igual desde afuera, y son problemas distintos con arreglos distintos.
   */
  participants: ParticipantReading
  announced: number
  /**
   * Estamos buscando el título de un link recién pegado. Sin esto, pegar y apretar "+" no producía
   * ninguna señal hasta que oEmbed contestaba: parecía que no había pasado nada.
   */
  resolving: boolean
  /** Cuántos emisores de Meet llevan la mezcla. Con música puesta, 0 significa que nadie la oye. */
  outgoing: number
  /** Derivado: si mandás vos (sos el DJ, o todavía no hay ninguno). */
  authoritative: boolean
}

/** Mientras suena un anuncio bajamos la música casi a cero sin tocar el nivel elegido. */
const AD_DUCK = 0.1

/**
 * Cuántas canciones de la cola entran en un snapshot.
 *
 * Cada mensaje va en una sola línea del chat de Meet, y una cola larga se vuelve enorme: con 20
 * temas el mensaje cifrado pasaba los 4.000 caracteres. Diez alcanza para ver qué viene.
 */
const SNAPSHOT_QUEUE_MAX = 10

/**
 * Cuánto se espera antes de avisar por el chat, para que varias entradas seguidas produzcan un solo
 * mensaje. Entrar de a poco a una reunión es lo normal al arrancar.
 */
const JOIN_COALESCE_MS = 6_000

/**
 * Piso entre dos avisos.
 *
 * Acá hay una tensión real y el número sale de resolverla, no de elegir un valor redondo. El chat
 * de Meet **no muestra lo anterior a que entraras**: un aviso mandado antes no existe para quien
 * acaba de llegar, así que cada entrada necesita el suyo. Pero cada mensaje es también una fila
 * visible para toda la reunión.
 *
 * Con un piso alto el aviso llega tarde y deja de cumplir su función —quien entró ya se preguntó de
 * dónde salía la música— así que el piso es corto y lo que agrupa de verdad es la ventana de
 * arriba. `ANNOUNCE_MAX` pone el techo para que una reunión rarísima no se llene igual.
 */
const ANNOUNCE_GAP_MS = 30_000

/** Techo por sesión de música. Se reinicia al parar: otra música es otra conversación. */
const ANNOUNCE_MAX = 12

export class Session {
  private view: SessionView = {
    audio: 'off',
    error: null,
    notice: null,
    needsGesture: false,
    isHost: false,
    hostName: null,
    state: emptyState(),
    player: null,
    levels: { ...DEFAULT_LEVELS },
    duck: { ...DEFAULT_DUCK },
    ducking: false,
    micMuted: false,
    micButton: null,
    voiceMuted: false,
    canBroadcast: false,
    chatStuck: false,
    chatNeedsDecision: false,
    chat: { chatOpen: false, sendButton: false, sent: 0, received: 0, pending: 0, failures: 0 },
    displayName: '',
    themePref: 'system',
    theme: resolveTheme('system'),
    shareQueue: true,
    announce: true,
    participants: UNKNOWN,
    announced: 0,
    resolving: false,
    outgoing: 0,
    authoritative: true,
  }

  private listeners = new Set<(v: SessionView) => void>()
  private port: chrome.runtime.Port | null = null
  private chat = new ChatTransport()
  /** Ids de los participantes vistos, para saber cuántos votos hacen falta. */
  private peers = new Set<string>()
  /** Nuestro id estable. Se persiste para que sobreviva recargas dentro de la misma reunión. */
  private peerId = ''
  private adActive = false
  private lastBroadcast = ''
  private mergedLocal = false
  /** Nivel de voz previo al mute, para restaurarlo tal cual. */
  private preMuteMic = 1
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private volumeTimer: ReturnType<typeof setTimeout> | null = null
  /** Aviso por el chat pendiente de salir, y cuándo salió el último. Ver `requestAnnouncement`. */
  private announceTimer: ReturnType<typeof setTimeout> | null = null
  private lastAnnounceAt = 0
  /** Reintentos del `hello` inicial mientras el chat de Meet todavía no está disponible. */
  private helloTimer: ReturnType<typeof setTimeout> | null = null
  /** El botón de micrófono de Meet, cacheado: buscarlo entre todos los botones cuesta. */
  private micEl: HTMLElement | null = null

  async start(): Promise<void> {
    await this.loadPeerId()
    await this.loadPrefs()
    this.connect()

    onMain((msg) => {
      switch (msg.type) {
        case 'signal':
          this.send({ type: 'signal', signal: msg.signal })
          break
        case 'music-attached':
          this.patch({ audio: 'on', error: null, notice: null, needsGesture: false })
          this.pushLevels()
          this.send({ type: 'monitor', level: this.view.levels.musicMonitor })
          toMain({ type: 'set-duck', duck: this.view.duck })
          // Ya está sonando para la reunión: es el momento honesto para contarlo en el chat.
          this.requestAnnouncement('started')
          break

        case 'music-pending':
          // El grafo quedó armado; no hay nada que reintentar, sólo decirlo mientras dure. El
          // motivo no va a `error`: el cartel de `waiting` ya lo explica, y dos avisos del mismo
          // problema se leen como dos problemas.
          this.patch({ audio: 'waiting', error: null, needsGesture: false })
          break

        case 'outgoing-restored':
          this.notice('Your microphone had gone silent to the meeting — restored.')
          break

        case 'music-failed':
          this.patch({ audio: 'error', error: `Could not pick up the audio: ${msg.error}` })
          break
        case 'status':
          this.patch({ ducking: msg.ducking, outgoing: msg.outgoing })
          break
      }
    })

    watchSystemTheme(() => {
      if (this.view.themePref === 'system') this.patch({ theme: resolveTheme('system') })
    })

    this.chat.start((msg) => this.onChat(msg))
    this.chat.setEnabled(this.view.shareQueue)
    this.holdChatOpen(this.view.shareQueue)
    void this.installRoomKey()
    this.patch({ canBroadcast: this.chat.canSend() })

    // El chat se abre al entrar, no al primer envío. Cerrado, Meet ni siquiera monta los mensajes
    // entrantes: quien llegaba a una reunión con música no recibía el estado y veía una sala vacía
    // hasta que abriera el chat a mano, cosa que nadie hace porque nada se lo pide.
    if (this.view.shareQueue) void this.openChat()

    // Alguien nuevo en la llamada con la música ya sonando no tiene forma de saber de dónde sale.
    watchParticipants(
      () => this.requestAnnouncement('joined'),
      (reading) => {
        const { participants } = this.view
        if (reading.count !== participants.count || reading.source !== participants.source) {
          this.patch({ participants: reading })
        }
      },
    )

    // El campo del chat aparece y desaparece según el panel esté abierto; revisamos cada tanto.
    setInterval(() => {
      const can = this.chat.canSend()
      if (can !== this.view.canBroadcast) this.patch({ canBroadcast: can })
      if (this.chat.isStuck() !== this.view.chatStuck) {
        this.patch({ chatStuck: this.chat.isStuck() })
      }
      const diag = this.chat.diagnostics()
      if (JSON.stringify(diag) !== JSON.stringify(this.view.chat)) this.patch({ chat: diag })
    }, 4000)

    // El botón de mutear de Meet corta el track mezclado entero, música incluida. Además hay que
    // seguirle la posición de cerca: el nuestro se dibuja encima y no puede ir un paso atrás.
    setInterval(() => this.readMicButton(), 400)
    window.addEventListener('resize', () => this.readMicButton())
    setInterval(() => toMain({ type: 'query-status' }), 400)
  }

  /**
   * La clave de la sala sale del código de la reunión: secreto compartido entre los participantes,
   * sin nada que configurar. Derivarla cuesta, así que se hace una sola vez por sesión.
   */
  private async installRoomKey(): Promise<void> {
    const code = meetingCode(location.href)
    if (!code) return
    try {
      this.chat.setKey(await deriveKey(code))
      this.patch({ canBroadcast: this.chat.canSend() })
      this.sayHello()
    } catch {
      this.notice('Could not set up the encrypted queue channel; staying in solo mode.')
    }
  }

  /**
   * Anunciarse al entrar. Es lo que hace que, si ya hay alguien poniendo música, su extensión te
   * mande el estado y veas la cola desde el primer momento en vez de una sala vacía.
   *
   * Se reintenta porque al entrar todavía puede no haber clave ni chat: sin el reintento, el
   * `hello` se perdía y la sala se veía vacía hasta que el host tocara algo por su cuenta.
   */
  private sayHello(attempt = 0): void {
    if (this.helloTimer !== null) clearTimeout(this.helloTimer)
    this.helloTimer = null

    if (!this.view.shareQueue || this.view.isHost) return
    if (this.chat.send({ op: 'hello', from: this.peerId, name: this.view.displayName })) return
    if (attempt >= 5) return
    this.helloTimer = setTimeout(() => this.sayHello(attempt + 1), 2000)
  }

  /**
   * Pide un aviso en el chat, en texto plano y a la vista de todos.
   *
   * Sale sólo del host y sólo con la música sonando de verdad. La ventana no descarta el pedido
   * cuando está cerrada: lo pospone hasta que se abre, así quien acaba de entrar igual se entera.
   * Es lo contrario de un throttle común, y es a propósito — el pedido viene de una persona que
   * está mirando la reunión sin entender de dónde sale la música.
   */
  private requestAnnouncement(reason: 'started' | 'joined' | 'manual'): void {
    if (!this.canAnnounce()) return

    if (reason === 'manual') {
      // Pedido a mano: manda sobre la ventana, el techo y cualquier aviso ya programado.
      if (this.announceTimer !== null) clearTimeout(this.announceTimer)
      this.announceTimer = null
    } else {
      if (this.announceTimer !== null) return
      // Reenganchar el audio no es empezar de nuevo. Sin esto, cada corte y vuelta del enlace
      // producía otro aviso en el chat sin que hubiera entrado nadie.
      if (reason === 'started' && this.lastAnnounceAt !== 0) return
      if (this.view.announced >= ANNOUNCE_MAX) return
    }

    const first = this.lastAnnounceAt === 0
    const immediate = reason === 'manual' || (reason === 'started' && first)
    const wait = immediate
      ? 0
      : Math.max(JOIN_COALESCE_MS, ANNOUNCE_GAP_MS - (Date.now() - this.lastAnnounceAt))

    this.announceTimer = setTimeout(() => {
      this.announceTimer = null
      if (!this.canAnnounce()) return
      const text = announcementText({
        title: this.view.state.current?.title ?? null,
        host: this.view.displayName,
      })
      if (!this.chat.sendPlain(text)) return
      this.lastAnnounceAt = Date.now()
      this.patch({ announced: this.view.announced + 1 })
    }, wait)
  }

  private canAnnounce(): boolean {
    return this.view.announce && this.view.isHost && this.view.audio === 'on'
  }

  /**
   * El panel de chat de Meet tiene que quedar abierto mientras se comparte la cola: es por donde
   * viaja, y cerrado Meet ni siquiera monta los mensajes entrantes.
   *
   * Lo reabrimos, pero no para siempre. Si insistís en cerrarlo, dejamos de pelear y te damos a
   * elegir: pelear contra alguien que sabe lo que quiere es peor que preguntarle.
   */
  private holdChatOpen(enabled: boolean): void {
    this.chat.setKeepOpen(enabled, (count) => {
      if (count === 1) {
        this.notice('Keeping the Meet chat open — that is where the shared queue travels.')
      }
      if (count >= 3) this.patch({ chatNeedsDecision: true })
    })
  }

  /** "Dejalo abierto": volvemos a mantenerlo, contador en cero. */
  keepChatOpen(): void {
    this.patch({ chatNeedsDecision: false })
    this.chat.resetReopens()
    void this.openChat()
  }

  subscribe(fn: (v: SessionView) => void): () => void {
    this.listeners.add(fn)
    fn(this.view)
    return () => this.listeners.delete(fn)
  }

  // ---------------------------------------------------------------- acciones de la UI

  /**
   * Arranca el audio: abre la pestaña de YouTube en la canción actual, toma su sonido con
   * captureStream() y lo trae por WebRTC hasta el mezclador.
   */
  startAudio(): void {
    this.applyLocal({ type: 'setVolume', volume: this.view.levels.musicBroadcast })
    const videoId = this.view.state.current?.id
    if (!videoId) {
      this.notice('Add a song first — the YouTube tab opens straight to it.')
      return
    }
    this.patch({ audio: 'starting', error: null, isHost: true, hostName: this.view.displayName })
    this.send({ type: 'start-audio', videoId })
  }

  /** Plan B cuando captureStream() no puede tomar el audio. */
  captureDisplay(): void {
    this.patch({ error: null })
    toMain({ type: 'capture-display' })
  }

  /**
   * Cortar la música para toda la reunión, vaciar la cola y liberar el puesto.
   *
   * Es un reinicio completo: la sala queda como recién empezada y cualquiera puede arrancar de
   * cero. Por eso el botón dice explícitamente que borra la cola — es destructivo y lo puede
   * apretar cualquiera.
   */
  stopAudio(): void {
    const wasHost = this.view.isHost
    this.teardownPlayback()
    if (wasHost) this.chat.send({ op: 'stop', from: this.peerId })
  }

  /**
   * El corte en sí, sin avisarle a nadie. Se usa también al recibir un `stop` ajeno.
   *
   * Reinicia **todo lo que describe la reproducción**, no sólo la cola: los avisos de error, el
   * estado del reproductor, el ducking y el anuncio en curso quedarían describiendo una sesión que
   * ya no existe.
   *
   * El caso crítico es `voiceMuted`. Al desarmar el grafo, Meet recupera tu micrófono crudo, así
   * que quedás realmente al aire; dejar el botón en rojo te haría creer lo contrario y hablarías
   * pensando que nadie te escucha.
   */
  private teardownPlayback(): void {
    toMain({ type: 'stop-music' })
    this.send({ type: 'stop-audio' })

    if (this.volumeTimer !== null) clearTimeout(this.volumeTimer)
    this.volumeTimer = null
    if (this.announceTimer !== null) clearTimeout(this.announceTimer)
    this.announceTimer = null
    // La próxima sesión de música vuelve a merecer su aviso: es otra cosa la que suena.
    this.lastAnnounceAt = 0
    this.patch({ announced: 0 })
    this.adActive = false

    const mic = this.view.voiceMuted ? this.preMuteMic : this.view.levels.mic

    this.patch({
      audio: 'off',
      error: null,
      needsGesture: false,
      isHost: false,
      hostName: null,
      player: null,
      ducking: false,
      voiceMuted: false,
      chatStuck: false,
      levels: { ...this.view.levels, mic },
      // El volumen de la música sobrevive: es una preferencia de la sesión, no contenido.
      state: { ...emptyState(), volume: this.view.state.volume },
    })

    // Sin esto, el próximo snapshot idéntico se descartaría por deduplicación.
    this.lastBroadcast = ''
    this.mergedLocal = false
    void this.savePrefs()
  }

  focusPlayer(): void {
    this.send({ type: 'focus-player' })
  }

  /**
   * Acepta una URL de YouTube o un id suelto. En esta versión no hay búsqueda por nombre.
   *
   * Devuelve qué pasó en vez de avisar por su cuenta. Un texto que no se entiende es un error **del
   * campo**: tiene que quedar marcado ahí, con lo tipeado intacto para poder corregirlo, y no como
   * un aviso flotando arriba de todo que además se va solo a los cuatro segundos.
   */
  submit(input: string): SubmitResult {
    const parsed = parseLink(input)
    if (!parsed.ok) return parsed.reason === 'empty' ? { ok: true } : { ok: false, problem: parsed }

    this.patch({ resolving: true })
    this.send({ type: 'resolve', videoId: parsed.videoId })
    // Red de seguridad: si oEmbed no contesta, la canción se encola igual con el id y el título
    // real llega cuando empieza a sonar. Lo que no puede quedar es el spinner girando para siempre.
    setTimeout(() => {
      if (this.view.resolving) this.patch({ resolving: false })
    }, 8000)
    return { ok: true }
  }

  add(track: Track): void {
    const withAuthor: Track = { ...track, addedBy: this.view.displayName || undefined }
    const from = this.peerId
    if (this.authoritative) {
      // Todavía no hay DJ (o el DJ sos vos): la cola se arma acá mismo.
      this.applyLocal({ type: 'add', track: withAuthor })
    } else if (this.chat.send({ op: 'add', track: withAuthor, from })) {
      this.notice(`Requested "${track.title}"`)
    } else {
      this.notice('Could not write to the Meet chat. Open the chat and try again.')
    }
  }

  remove(id: string): void {
    if (this.authoritative) this.applyLocal({ type: 'remove', id })
    else this.chat.send({ op: 'remove', id, from: this.peerId })
  }

  /** Adelantar una canción de la cola. Como saltear, lo puede hacer cualquiera. */
  jump(id: string): void {
    if (this.authoritative) {
      this.applyLocal({ type: 'jump', id })
      return
    }
    if (this.chat.send({ op: 'jump', id, from: this.peerId })) this.notice('Moving that one up…')
    else this.notice('Could not reach the meeting queue. Open the Meet chat and try again.')
  }

  /** Pausar y reanudar son de la reunión: si reproduce otro, se le pide a esa persona. */
  setPlaying(playing: boolean): void {
    if (!this.authoritative) {
      this.chat.send({ op: 'playback', playing, from: this.peerId })
      return
    }
    // Darle a play sin haber arrancado el audio es la forma natural de decir "pongo yo la música".
    if (playing && this.view.audio === 'off') {
      this.startAudio()
      return
    }
    this.send({ type: playing ? 'play' : 'pause' })
    this.applyLocal({ type: 'setPlaying', playing })
  }

  play(): void {
    this.setPlaying(true)
  }

  pause(): void {
    this.setPlaying(false)
  }

  /**
   * Bajar la música de la reunión. Para quien escucha es necesariamente compartido: le llega
   * fusionada con la voz de quien reproduce, en una sola pista, así que no hay forma de regularla
   * sólo para uno.
   *
   * El efecto local es inmediato; lo que viaja va con retardo. Un slider emite en cada píxel del
   * arrastre, así que propagar sin filtro llenaría el chat de Meet con decenas de mensajes —y del
   * lado de quien reproduce, con un snapshot entero de la cola por cada uno.
   */
  setSharedVolume(level: number): void {
    if (this.view.isHost || this.view.hostName === null) this.setLevels({ musicBroadcast: level })
    this.patch({ state: { ...this.view.state, volume: level } })
    this.scheduleVolumeSync(level)
  }

  /** Propaga el volumen recién cuando soltás el slider. */
  private scheduleVolumeSync(level: number): void {
    if (this.volumeTimer !== null) clearTimeout(this.volumeTimer)
    this.volumeTimer = setTimeout(() => {
      this.volumeTimer = null
      if (this.view.isHost) this.broadcast(true)
      else if (this.view.hostName !== null) {
        this.chat.send({ op: 'volume', level, from: this.peerId })
      }
      // Sin nadie reproduciendo no hay a quién avisarle: queda como preferencia local.
    }, 400)
  }

  /** Cualquiera puede pasar de canción: la cola es de la reunión, no de quien la puso. */
  skip(): void {
    if (this.authoritative) {
      this.applyLocal({ type: 'next' })
      return
    }
    if (this.chat.send({ op: 'skip', from: this.peerId })) this.notice('Skipping…')
    else this.notice('Could not reach the meeting queue. Open the Meet chat and try again.')
  }

  /** Mandamos nosotros si somos el DJ, o si todavía no apareció ninguno. */
  private get authoritative(): boolean {
    return this.view.authoritative
  }

  setLevels(partial: Partial<Levels>): void {
    // Si tocás el slider de voz a mano, manda eso: el botón de mute refleja el nivel real.
    if (partial.mic !== undefined) this.patch({ voiceMuted: partial.mic === 0 })
    this.patch({ levels: { ...this.view.levels, ...partial } })
    this.pushLevels()
    // El monitor se aplica en la fuente, no en el mezclador: así lo que escuchás no depende de que
    // el audio complete el viaje de ida y vuelta por WebRTC.
    if (partial.musicMonitor !== undefined) {
      this.send({ type: 'monitor', level: partial.musicMonitor })
    }
    void this.savePrefs()
  }

  setDuck(partial: Partial<DuckConfig>): void {
    const duck = { ...this.view.duck, ...partial }
    this.patch({ duck })
    toMain({ type: 'set-duck', duck })
    void this.savePrefs()
  }

  setTheme(themePref: ThemePref): void {
    this.patch({ themePref, theme: resolveTheme(themePref) })
    void this.savePrefs()
  }

  /** Compartir la cola implica escribir en el chat de Meet, así que es una decisión explícita. */
  setShareQueue(shareQueue: boolean): void {
    this.patch({ shareQueue, chatNeedsDecision: false })
    this.chat.setEnabled(shareQueue)
    this.holdChatOpen(shareQueue)
    this.patch({ canBroadcast: this.chat.canSend() })
    void this.savePrefs()
    if (shareQueue) {
      void this.openChat().then(() => this.sayHello())
    }
  }

  /**
   * Avisar por el chat cuando entra alguien. Es un mensaje visible para toda la reunión, así que es
   * una decisión explícita — igual que compartir la cola, y por el mismo motivo.
   */
  setAnnounce(announce: boolean): void {
    this.patch({ announce })
    void this.savePrefs()
  }

  /**
   * Contarlo ahora, sin esperar a que entre nadie.
   *
   * Es la salida cuando la lectura del roster no funciona: el DOM de Meet no es una API y puede
   * dejar de dejarse leer en cualquier momento, así que tiene que haber una forma de hacerlo a mano
   * que no dependa de nada de eso.
   */
  announceNow(): void {
    this.requestAnnouncement('manual')
    this.notice(
      this.view.audio === 'on'
        ? 'Posting in the chat what is playing…'
        : 'Nothing is playing from here, so there is nothing to announce.',
    )
  }

  /** Saltar a un punto de la canción, desde el propio Meet. */
  seek(seconds: number): void {
    if (!this.authoritative) return
    this.send({ type: 'seek', seconds })
  }

  /**
   * Callarte sin cortar la música.
   *
   * El botón de mutear de Meet no sirve para esto: como la música viaja mezclada en tu pista de
   * micrófono, silenciar ahí corta las dos cosas. Acá bajamos sólo la ganancia de la voz, que es
   * una rama aparte del mezclador, y recordamos el nivel para devolvértelo al desmutear.
   */
  toggleVoice(): void {
    if (this.view.voiceMuted) {
      this.patch({ voiceMuted: false })
      this.setLevels({ mic: this.preMuteMic })
      return
    }
    this.preMuteMic = this.view.levels.mic || 1
    this.patch({ voiceMuted: true })
    this.setLevels({ mic: 0 })
  }

  setDisplayName(name: string): void {
    this.patch({ displayName: name.trim() })
    void this.savePrefs()
  }

  openOptions(): void {
    // openOptionsPage() no existe en un content script; lo abre el service worker por nosotros.
    this.send({ type: 'open-options' })
  }

  async openChat(): Promise<void> {
    const ok = await this.chat.ensureChatOpen()
    this.patch({ canBroadcast: ok })
    if (!ok) this.notice('Could not find the Meet chat. Open it manually from the meeting controls.')
  }

  // ---------------------------------------------------------------- service worker

  private connect(): void {
    this.port = chrome.runtime.connect({ name: PORT_MEET })
    this.port.onMessage.addListener((raw) => this.onSw(raw as SwEvent))
    this.port.onDisconnect.addListener(() => {
      this.port = null
      // El service worker de MV3 se duerme; reconectamos al toque.
      setTimeout(() => this.connect(), 500)
    })
  }

  private send(req: PanelReq): void {
    if (!this.port) this.connect()
    try {
      this.port?.postMessage(req)
    } catch {
      this.connect()
      this.port?.postMessage(req)
    }
  }

  private onSw(event: SwEvent): void {
    switch (event.type) {
      case 'signal':
        toMain({ type: 'signal', signal: event.signal })
        break

      case 'capture-failed':
        this.patch({
          audio: 'error',
          error: `Could not pick up YouTube's audio: ${event.error}`,
        })
        break

      case 'player-state':
        this.onPlayerState(event.state)
        break

      case 'needs-gesture':
        this.patch({ needsGesture: true })
        break

      case 'player-gone':
        this.patch({ notice: 'The player tab was closed.', player: null })
        break

      case 'audio-stopped':
        this.patch({ audio: 'off' })
        break

      case 'resolved':
        this.patch({ resolving: false })
        this.add(event.track)
        break

      case 'error':
        this.patch({
          resolving: false,
          error: event.error,
          audio: event.fatal ? 'error' : this.view.audio,
        })
        break
    }
  }

  private onPlayerState(player: PlayerState): void {
    this.patch({ player, needsGesture: player.phase === 'playing' ? false : this.view.needsGesture })

    if (player.adLikely !== this.adActive) {
      this.adActive = player.adLikely
      this.pushLevels()
      this.send({ type: 'monitor', level: this.view.levels.musicMonitor * (this.adActive ? AD_DUCK : 1) })
    }

    if (!this.view.isHost) return

    // El título real lo sabemos recién cuando el video carga; hasta ahí mostramos el id.
    // Durante un anuncio el reproductor informa los datos del aviso, así que no se toca nada.
    if (!player.adLikely && player.videoId && player.title && this.view.state.current?.id === player.videoId) {
      const current = this.view.state.current
      if (current.title !== player.title || current.duration !== player.duration) {
        this.applyLocal({
          type: 'enrich',
          id: player.videoId,
          patch: { title: player.title, duration: player.duration || undefined },
        })
      }
    }

    if (player.phase === 'ended') this.applyLocal({ type: 'next' })
  }

  // ---------------------------------------------------------------- cola compartida

  private onChat(msg: Msg): void {
    switch (msg.op) {
      case 'state':
        // Sólo un invitado acepta snapshots ajenos; el host manda.
        if (!this.view.isHost) {
          this.adoptHost(msg.state, msg.host)
        }
        this.peers.add(msg.from)
        break

      case 'hello':
        this.peers.add(msg.from)
        if (this.view.isHost) this.broadcast(true)
        break

      case 'add':
        this.peers.add(msg.from)
        if (this.view.isHost) {
          this.applyLocal({ type: 'add', track: msg.track })
          this.notice(`${msg.track.addedBy ?? 'Someone'} added "${msg.track.title}"`)
        }
        break

      case 'remove':
        this.peers.add(msg.from)
        if (this.view.isHost) this.applyLocal({ type: 'remove', id: msg.id })
        break

      case 'skip':
        this.peers.add(msg.from)
        if (this.view.isHost) this.applyLocal({ type: 'next' })
        break

      case 'jump':
        this.peers.add(msg.from)
        if (this.view.isHost) this.applyLocal({ type: 'jump', id: msg.id })
        break

      case 'stop':
        this.peers.add(msg.from)
        // Lo honra cualquiera, incluido quien estaba reproduciendo: parar es de la reunión.
        this.teardownPlayback()
        this.notice('Stopped and queue cleared. Anyone can start now.')
        break

      case 'playback':
        this.peers.add(msg.from)
        if (this.view.isHost) {
          this.send({ type: msg.playing ? 'play' : 'pause' })
          this.applyLocal({ type: 'setPlaying', playing: msg.playing })
        }
        break

      case 'volume':
        this.peers.add(msg.from)
        if (this.view.isHost) {
          this.setLevels({ musicBroadcast: msg.level })
          this.applyLocal({ type: 'setVolume', volume: msg.level })
        }
        break
    }
  }

  /**
   * Alguien tomó el rol de DJ. Si veníamos armando una cola local, se la reenviamos como pedidos
   * en vez de descartarla en silencio.
   */
  private adoptHost(state: StateSnapshot, host: string): void {
    const pending = this.view.hostName === null && !this.mergedLocal ? this.localTracks() : []
    this.mergedLocal = true
    this.patch({ state, hostName: host })

    const known = new Set([state.current?.id, ...state.queue.map((t) => t.id)])
    for (const track of pending) {
      if (!known.has(track.id)) this.chat.send({ op: 'add', track, from: this.peerId })
    }
    if (pending.length > 0) this.notice(`Handed your queue over to ${host}`)
  }

  private localTracks(): Track[] {
    const { current, queue } = this.view.state
    return current ? [current, ...queue] : [...queue]
  }

  /** Aplica una acción como host y difunde el resultado. */
  private applyLocal(action: Parameters<typeof reduce>[1]): void {
    this.setState(reduce(this.view.state, action))
  }

  private setState(next: StateSnapshot): void {
    const previousId = this.view.state.current?.id
    this.patch({ state: next })

    if (this.view.isHost) {
      if (next.current && next.current.id !== previousId) {
        this.send({ type: 'load', videoId: next.current.id })
      } else if (!next.current && previousId) {
        this.send({ type: 'pause' })
      }
      this.broadcast()
    }
  }

  /**
   * Difunde el estado por el chat. Sólo si cambió algo visible, para no llenar la conversación de
   * mensajes ocultos.
   */
  private broadcast(force = false): void {
    if (!this.view.isHost) return
    const payload = JSON.stringify(this.view.state)
    if (!force && payload === this.lastBroadcast) return
    this.lastBroadcast = payload

    // El snapshot se recorta: es sólo para que quien llega vea qué está sonando y qué sigue. Las
    // altas posteriores viajan una por una, así que la cola se completa sola sin mandar todo junto.
    this.chat.send({
      op: 'state',
      state: {
        ...this.view.state,
        queue: this.view.state.queue.slice(0, SNAPSHOT_QUEUE_MAX),
      },
      host: this.view.displayName,
      from: this.peerId,
    })
  }

  // ---------------------------------------------------------------- audio

  /**
   * Empuja los niveles al mezclador. El nivel de emisión se multiplica por el factor de anuncio,
   * nunca se pisa: al terminar el ad vuelve exactamente al valor que eligió el usuario.
   */
  private pushLevels(): void {
    const { levels } = this.view
    toMain({
      type: 'set-levels',
      levels: {
        ...levels,
        musicBroadcast: levels.musicBroadcast * (this.adActive ? AD_DUCK : 1),
      },
    })
  }

/**
   * Lee el botón de micrófono de Meet: si está silenciado y dónde está dibujado.
   *
   * El elemento se cachea porque encontrarlo obliga a recorrer todos los botones de la página, y
   * esto corre varias veces por segundo. Meet lo reemplaza al cambiar de layout, así que se
   * revalida por `isConnected` en vez de confiar para siempre.
   */
  private readMicButton(): void {
    if (!this.micEl?.isConnected) this.micEl = findMicButton()
    const mic = this.micEl
    if (!mic) {
      if (this.view.micButton !== null) this.patch({ micButton: null })
      return
    }

    const muted = isMutedLabel(
      mic.getAttribute('aria-label') ?? '',
      mic.getAttribute('aria-pressed') ?? mic.getAttribute('data-is-muted'),
    )
    if (muted !== this.view.micMuted) this.patch({ micMuted: muted })

    // Medir sólo cuando vamos a tapar algo. Sin música el botón de Meet es el botón correcto y no
    // hay nada que dibujar encima, así que tampoco hay motivo para estar midiéndolo.
    const box = this.view.audio === 'on' ? boxOf(mic) : null
    if (!sameBox(box, this.view.micButton)) this.patch({ micButton: box })
  }

  // ---------------------------------------------------------------- prefs

  /**
   * Id propio, persistido para sobrevivir recargas. No identifica a la persona fuera de la sala:
   * es un número al azar, y sólo viaja cifrado dentro de la reunión.
   */
  private async loadPeerId(): Promise<void> {
    const stored = await chrome.storage.local.get('peerId')
    if (typeof stored.peerId === 'string' && stored.peerId) {
      this.peerId = stored.peerId
      return
    }
    this.peerId = crypto.randomUUID()
    await chrome.storage.local.set({ peerId: this.peerId })
  }

  private async loadPrefs(): Promise<void> {
    const stored = (await chrome.storage.local.get([
      'levels',
      'duck',
      'displayName',
      'theme',
      'shareQueue',
      'announce',
    ])) as Partial<Prefs>
    const themePref = stored.theme ?? 'system'
    // Meet ya sabe cómo te llamás; preguntártelo de nuevo sería un campo de más. Si no se puede
    // leer, queda vacío y la atribución muestra sólo la marca: mejor eso que un "Invitado" genérico.
    const displayName = stored.displayName ?? detectDisplayName() ?? ''
    this.patch({
      levels: { ...DEFAULT_LEVELS, ...(stored.levels ?? {}) },
      duck: { ...DEFAULT_DUCK, ...(stored.duck ?? {}) },
      displayName,
      themePref,
      theme: resolveTheme(themePref),
      shareQueue: stored.shareQueue ?? true,
      announce: stored.announce ?? true,
    })
  }

  private async savePrefs(): Promise<void> {
    await chrome.storage.local.set({
      levels: this.view.levels,
      duck: this.view.duck,
      displayName: this.view.displayName,
      theme: this.view.themePref,
      shareQueue: this.view.shareQueue,
      announce: this.view.announce,
    })
  }

  // ---------------------------------------------------------------- utilidades

  private notice(text: string): void {
    this.patch({ notice: text })
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => this.patch({ notice: null }), 4000)
  }

  private patch(partial: Partial<SessionView>): void {
    // El sondeo de estado corre cada 400ms; sin este corte, cada tick repintaba el panel y pisaba
    // lo que el usuario estuviera tipeando en un campo.
    const keys = Object.keys(partial) as Array<keyof SessionView>
    if (keys.every((k) => this.view[k] === partial[k])) return

    const next = { ...this.view, ...partial }
    next.authoritative = next.isHost || next.hostName === null
    this.view = next
    for (const fn of this.listeners) fn(this.view)
  }
}
