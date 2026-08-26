import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DUCK, Mixer, VoiceGate, rmsOf } from '../src/core/mixer.js'
import { fakeContext } from './fake-audio.js'

afterEach(() => vi.useRealTimers())

const build = () => {
  const ctx = fakeContext()
  const mixer = new Mixer(ctx as unknown as AudioContext)
  mixer.setMusicSource({} as MediaStream)
  return { ctx, mixer }
}

describe('Mixer — la música nunca toca la voz', () => {
  it('mover el volumen de emisión no escribe en micGain', () => {
    const { mixer } = build()
    const before = mixer.micGain.gain.value

    for (const v of [0, 0.2, 0.55, 1, 0.33]) mixer.setLevels({ musicBroadcast: v })

    expect(mixer.micGain.gain.value).toBe(before)
    expect(mixer.musicBroadcastGain.gain.value).toBeCloseTo(0.33)
  })

  it('el monitor del DJ no toca nada de lo que sale a la reunión', () => {
    // Se aplica en la fuente, no acá: bajarlo a cero no puede dejar sorda a la reunión.
    const { mixer } = build()
    mixer.setLevels({ musicBroadcast: 0.8 })
    const mic = mixer.micGain.gain.value
    const broadcast = mixer.musicBroadcastGain.gain.value

    mixer.setLevels({ musicMonitor: 0 })

    expect(mixer.micGain.gain.value).toBe(mic)
    expect(mixer.musicBroadcastGain.gain.value).toBe(broadcast)
    expect(mixer.getLevels().musicMonitor).toBe(0)
  })

  it('mover la voz no toca ninguna ganancia de música', () => {
    const { mixer } = build()
    mixer.setLevels({ musicBroadcast: 0.6, musicMonitor: 0.4 })

    mixer.setLevels({ mic: 0 })

    expect(mixer.musicBroadcastGain.gain.value).toBeCloseTo(0.6)
    expect(mixer.micGain.gain.value).toBe(0)
  })

  it('el ducking baja la música pero deja la voz intacta', () => {
    const { ctx, mixer } = build()
    mixer.setLevels({ musicBroadcast: 0.8 })
    const mic = mixer.micGain.gain.value

    ctx.signal = 0.5 // alguien habla
    expect(mixer.tickDuck(1000)).toBe(true)

    expect(mixer.musicBroadcastGain.gain.value).toBeCloseTo(0.8 * DEFAULT_DUCK.amount)
    expect(mixer.micGain.gain.value).toBe(mic)
  })

  it('el ducking multiplica el nivel elegido en vez de pisarlo', () => {
    const { ctx, mixer } = build()
    mixer.setLevels({ musicBroadcast: 0.8 })

    ctx.signal = 0.5
    mixer.tickDuck(1000)
    // El usuario mueve la perilla mientras está duckeada.
    mixer.setLevels({ musicBroadcast: 0.5 })
    expect(mixer.musicBroadcastGain.gain.value).toBeCloseTo(0.5 * DEFAULT_DUCK.amount)

    // Al callarse vuelve al valor nuevo, no al viejo.
    ctx.signal = 0
    mixer.tickDuck(1000 + DEFAULT_DUCK.holdMs + 1)
    expect(mixer.musicBroadcastGain.gain.value).toBeCloseTo(0.5)
  })

  it('apagar el ducking restaura el volumen enseguida', () => {
    const { ctx, mixer } = build()
    mixer.setLevels({ musicBroadcast: 0.9 })
    ctx.signal = 0.5
    mixer.tickDuck(1000)
    expect(mixer.isDucking()).toBe(true)

    mixer.setDuck({ enabled: false })

    expect(mixer.isDucking()).toBe(false)
    expect(mixer.musicBroadcastGain.gain.value).toBeCloseTo(0.9)
  })

  it('recorta niveles fuera de rango en vez de propagar NaN al grafo', () => {
    const { mixer } = build()
    mixer.setLevels({ musicBroadcast: 5, musicMonitor: -2, mic: Number.NaN })
    expect(mixer.musicBroadcastGain.gain.value).toBe(1)
    expect(mixer.getLevels().musicMonitor).toBe(0)
    expect(mixer.micGain.gain.value).toBe(0)
  })
})

describe('VoiceGate', () => {
  it('se sostiene tras la última sílaba para no bombear entre palabras', () => {
    const gate = new VoiceGate({ ...DEFAULT_DUCK, threshold: 0.02, holdMs: 1000 })
    expect(gate.update(0.5, 0)).toBe(true)
    expect(gate.update(0.001, 500)).toBe(true) // silencio corto: sigue considerando voz
    expect(gate.update(0.001, 1500)).toBe(false)
  })

  it('ignora el ruido por debajo del umbral', () => {
    const gate = new VoiceGate({ ...DEFAULT_DUCK, threshold: 0.05 })
    expect(gate.update(0.01, 0)).toBe(false)
  })
})

describe('rmsOf', () => {
  it('mide la energía de la señal', () => {
    expect(rmsOf(new Float32Array([0, 0, 0]))).toBe(0)
    expect(rmsOf(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1)
    expect(rmsOf(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
  })
})

describe('topología del grafo', () => {
  it('la voz no pasa por el compresor: sólo por su ganancia', () => {
    const ctx = fakeContext()
    const mixer = new Mixer(ctx as unknown as AudioContext)
    ;(globalThis as { MediaStream?: unknown }).MediaStream = class {
      constructor(private tracks: unknown[] = []) {}
      getAudioTracks() {
        return this.tracks
      }
      getVideoTracks() {
        return []
      }
    }

    mixer.createMixedStream({
      getAudioTracks: () => [{ readyState: 'live' }],
      getVideoTracks: () => [],
    } as unknown as MediaStream)

    const compressor = ctx.compressors[0]
    const wiring = (node: GainNode) => (node as unknown as { connectedTo: unknown[] }).connectedTo

    // El limitador existe, pero cuelga de la música — nunca de la voz.
    expect(compressor).toBeDefined()
    expect(wiring(mixer.micGain)).not.toContain(compressor)
    expect(wiring(mixer.musicBroadcastGain)).toContain(compressor)
  })
})
