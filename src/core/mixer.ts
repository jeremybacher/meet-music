/**
 * Mezclador de audio.
 *
 * Garantía central del producto: el control de volumen de la música NO puede tocar la voz.
 * Por eso el micrófono y la música viajan por ramas separadas del grafo y sólo se suman al final.
 * `setLevels({ musicBroadcast })` escribe en `musicBroadcastGain` y nunca en `micGain` — hay tests
 * que lo verifican.
 *
 *   mic ──▶ micGain ────────────────────────────────▶ dest ──▶ Meet
 *                     (sin procesamiento ninguno)      ▲
 *   música ──▶ musicBroadcastGain ──▶ limiter ─────────┘
 *
 * El monitor del DJ —"música sólo para mí"— NO está acá: se aplica en la pestaña de YouTube, en la
 * fuente. Hacerlo acá obligaba a que el audio diera toda la vuelta por WebRTC sólo para volver a
 * los parlantes de quien lo puso, y cualquier corte en ese camino lo dejaba sordo aunque la reunión
 * siguiera escuchando bien.
 *
 * El limitador está SÓLO en la rama de música. La voz no pasa por ningún nodo de procesamiento
 * —ni compresor ni filtro—, únicamente por una ganancia: cualquier cosa en ese camino se escucha
 * como coloración o zumbido, y no vale la pena.
 */

export interface Levels {
  /** Cuánta música escucha la reunión. */
  musicBroadcast: number
  /** Cuánta música escucha el DJ. Se aplica en la fuente, no en este mezclador. */
  musicMonitor: number
  /** Tu voz. El control de música jamás la toca. */
  mic: number
}

export interface DuckConfig {
  enabled: boolean
  /** A qué fracción baja la música mientras hablás. */
  amount: number
  /** RMS a partir del cual se considera que hay voz. */
  threshold: number
  /** Constantes de tiempo en segundos para bajar y subir. */
  attack: number
  release: number
  /** Cuánto se sostiene el ducking tras la última sílaba, en ms. */
  holdMs: number
}

export const DEFAULT_LEVELS: Levels = { musicBroadcast: 0.7, musicMonitor: 0.35, mic: 1 }

export const DEFAULT_DUCK: DuckConfig = {
  enabled: true,
  amount: 0.25,
  threshold: 0.02,
  attack: 0.06,
  release: 0.25,
  holdMs: 1200,
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

export const rmsOf = (buf: Float32Array): number => {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / Math.max(1, buf.length))
}

/**
 * Decide si hay voz, con histéresis: entra rápido y sale tras `holdMs` de silencio, para que la
 * música no suba y baje entre palabras.
 */
export class VoiceGate {
  private lastVoiceAt = -Infinity

  constructor(private cfg: DuckConfig) {}

  setConfig(cfg: DuckConfig): void {
    this.cfg = cfg
  }

  update(rms: number, nowMs: number): boolean {
    if (rms >= this.cfg.threshold) this.lastVoiceAt = nowMs
    return nowMs - this.lastVoiceAt < this.cfg.holdMs
  }

  reset(): void {
    this.lastVoiceAt = -Infinity
  }
}

export class Mixer {
  readonly micGain: GainNode
  readonly musicBroadcastGain: GainNode
  readonly limiter: DynamicsCompressorNode
  private readonly analyser: AnalyserNode
  private readonly analyserBuf: Float32Array<ArrayBuffer>

  private micSource: MediaStreamAudioSourceNode | null = null
  private musicSource: MediaStreamAudioSourceNode | null = null
  private destinations: MediaStreamAudioDestinationNode[] = []

  private levels: Levels = { ...DEFAULT_LEVELS }
  private duck: DuckConfig = { ...DEFAULT_DUCK }
  private gate = new VoiceGate(this.duck)
  private ducking = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly ctx: AudioContext) {
    this.micGain = ctx.createGain()
    this.musicBroadcastGain = ctx.createGain()
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024

    // Limitador suave: evita que voz + música juntas saturen, que es el otro motivo por el que una
    // voz se vuelve ininteligible sobre música.
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -6
    this.limiter.knee.value = 6
    this.limiter.ratio.value = 12
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.15

    this.analyserBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))

    // El analizador es sólo un tap para el ducking: no reinyecta nada a la salida.
    this.micGain.connect(this.analyser)
    this.musicBroadcastGain.connect(this.limiter)

    this.micGain.gain.value = this.levels.mic
    this.musicBroadcastGain.gain.value = this.levels.musicBroadcast
  }

  /**
   * Envuelve el stream real del micrófono y devuelve el mezclado que se le entrega a Meet.
   * Meet llama a getUserMedia varias veces (cambio de dispositivo, reconexión), así que esto tiene
   * que ser idempotente: se reemplaza la fuente de mic y se crea un destino nuevo por llamada,
   * porque si Meet corta el track viejo no queremos que se lleve puesto al nuevo.
   */
  createMixedStream(realStream: MediaStream): MediaStream {
    const audioTracks = realStream.getAudioTracks()
    if (audioTracks.length > 0) {
      this.micSource?.disconnect()
      this.micSource = this.ctx.createMediaStreamSource(new MediaStream(audioTracks))
      this.micSource.connect(this.micGain)
    }

    this.destinations = this.destinations.filter((d) => {
      const alive = d.stream.getAudioTracks().some((t) => t.readyState === 'live')
      if (!alive) d.disconnect()
      return alive
    })

    const dest = this.ctx.createMediaStreamDestination()
    // La voz va directo; sólo la música pasa por el limitador.
    this.micGain.connect(dest)
    this.limiter.connect(dest)
    this.destinations.push(dest)

    this.startDuckLoop()

    return new MediaStream([...dest.stream.getAudioTracks(), ...realStream.getVideoTracks()])
  }

  /** Conecta el audio capturado de la player tab. */
  setMusicSource(stream: MediaStream): void {
    this.clearMusicSource()
    this.musicSource = this.ctx.createMediaStreamSource(stream)
    this.musicSource.connect(this.musicBroadcastGain)
  }

  clearMusicSource(): void {
    this.musicSource?.disconnect()
    this.musicSource = null
  }

  hasMusic(): boolean {
    return this.musicSource !== null
  }

  getLevels(): Levels {
    return { ...this.levels }
  }

  /**
   * Sólo escribe en la ganancia que corresponde. `musicBroadcast` y `musicMonitor` nunca tocan
   * `micGain`, y `mic` nunca toca las de música.
   */
  setLevels(partial: Partial<Levels>): void {
    if (partial.musicBroadcast !== undefined) {
      this.levels.musicBroadcast = clamp01(partial.musicBroadcast)
      this.applyMusicGains()
    }
    // `musicMonitor` no se aplica acá: viaja a la pestaña de YouTube y se aplica en la fuente.
    if (partial.musicMonitor !== undefined) this.levels.musicMonitor = clamp01(partial.musicMonitor)
    if (partial.mic !== undefined) {
      this.levels.mic = clamp01(partial.mic)
      this.ramp(this.micGain, this.levels.mic, 0.02)
    }
  }

  getDuck(): DuckConfig {
    return { ...this.duck }
  }

  setDuck(partial: Partial<DuckConfig>): void {
    this.duck = { ...this.duck, ...partial }
    this.gate.setConfig(this.duck)
    if (!this.duck.enabled) {
      this.ducking = false
      this.gate.reset()
      this.applyMusicGains()
    }
  }

  isDucking(): boolean {
    return this.ducking
  }

  /**
   * Un paso del ducking. Público para poder testearlo sin depender de timers reales.
   * Devuelve true si en este instante se considera que hay voz.
   */
  tickDuck(nowMs: number): boolean {
    if (!this.duck.enabled || !this.musicSource) {
      if (this.ducking) {
        this.ducking = false
        this.applyMusicGains()
      }
      return false
    }
    this.analyser.getFloatTimeDomainData(this.analyserBuf)
    const speaking = this.gate.update(rmsOf(this.analyserBuf), nowMs)
    if (speaking !== this.ducking) {
      this.ducking = speaking
      this.applyMusicGains()
    }
    return speaking
  }

  destroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.clearMusicSource()
    this.micSource?.disconnect()
    this.micSource = null
    for (const d of this.destinations) d.disconnect()
    this.destinations = []
  }

  /**
   * El factor de ducking multiplica el nivel elegido por el usuario en vez de pisarlo, así la
   * perilla sigue mandando: si la bajás mientras está duckeada, se respeta al soltar.
   */
  private applyMusicGains(): void {
    const factor = this.ducking ? this.duck.amount : 1
    const tc = this.ducking ? this.duck.attack : this.duck.release
    this.ramp(this.musicBroadcastGain, this.levels.musicBroadcast * factor, tc)
  }

  private ramp(node: GainNode, value: number, timeConstant: number): void {
    const param = node.gain
    if (typeof param.setTargetAtTime === 'function') {
      param.setTargetAtTime(value, this.ctx.currentTime, Math.max(0.001, timeConstant))
    } else {
      param.value = value
    }
  }

  private startDuckLoop(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.tickDuck(Date.now()), 50)
  }
}
