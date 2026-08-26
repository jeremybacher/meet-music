/** AudioContext mínimo para testear el mezclador sin Web Audio real. */

export interface FakeParam {
  value: number
  writes: number[]
  setTargetAtTime(value: number, when: number, tc: number): void
}

const makeParam = (): FakeParam => {
  const param: FakeParam = {
    value: 1,
    writes: [],
    setTargetAtTime(value: number) {
      param.value = value
      param.writes.push(value)
    },
  }
  return param
}

export interface FakeGain {
  gain: FakeParam
  /** A qué nodos se conectó, para poder afirmar cosas sobre la topología del grafo. */
  connectedTo: unknown[]
  connect: (target: unknown) => unknown
  disconnect: () => void
}

const makeGain = (): FakeGain => {
  const node: FakeGain = {
    gain: makeParam(),
    connectedTo: [],
    connect: (target: unknown) => {
      node.connectedTo.push(target)
      return target
    },
    disconnect: () => undefined,
  }
  return node
}

export interface FakeContext {
  currentTime: number
  state: string
  destination: unknown
  /** Amplitud constante que devuelve el analizador; sube esto para simular que alguien habla. */
  signal: number
  gains: FakeGain[]
  compressors: Array<{ kind: string; connectedTo: unknown[] }>
  resume(): Promise<void>
  createGain(): FakeGain
  createAnalyser(): unknown
  createDynamicsCompressor(): unknown
  createMediaStreamDestination(): unknown
  createMediaStreamSource(stream: unknown): unknown
}

export const fakeContext = (): FakeContext => {
  const ctx: FakeContext = {
    currentTime: 0,
    state: 'running',
    destination: { id: 'destination' },
    signal: 0,
    gains: [],
    compressors: [],
    resume: async () => undefined,
    createGain() {
      const g = makeGain()
      ctx.gains.push(g)
      return g
    },
    createAnalyser() {
      return {
        fftSize: 1024,
        connect: () => undefined,
        disconnect: () => undefined,
        getFloatTimeDomainData(buf: Float32Array) {
          buf.fill(ctx.signal)
        },
      }
    },
    createDynamicsCompressor() {
      const node = {
        kind: 'compressor',
        threshold: makeParam(),
        knee: makeParam(),
        ratio: makeParam(),
        attack: makeParam(),
        release: makeParam(),
        connectedTo: [] as unknown[],
        connect: (target: unknown) => {
          node.connectedTo.push(target)
          return target
        },
        disconnect: () => undefined,
      }
      ctx.compressors.push(node)
      return node
    },
    createMediaStreamDestination() {
      return {
        kind: 'destination',
        stream: { getAudioTracks: () => [{ readyState: 'live' }] },
        connect: () => undefined,
        disconnect: () => undefined,
      }
    },
    createMediaStreamSource() {
      return { connect: () => undefined, disconnect: () => undefined }
    },
  }
  return ctx
}
