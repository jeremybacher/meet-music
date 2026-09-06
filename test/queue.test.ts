import { describe, expect, it } from 'vitest'
import { emptyState, reduce } from '../src/core/queue.js'
import type { Track } from '../src/core/protocol.js'

const track = (id: string, extra: Partial<Track> = {}): Track => ({ id, title: `Tema ${id}`, ...extra })

describe('cola', () => {
  it('la primera canción arranca sola en vez de quedar esperando', () => {
    const s = reduce(emptyState(), { type: 'add', track: track('a') })
    expect(s.current?.id).toBe('a')
    expect(s.queue).toHaveLength(0)
    expect(s.playing).toBe(true)
  })

  it('las siguientes se encolan', () => {
    let s = reduce(emptyState(), { type: 'add', track: track('a') })
    s = reduce(s, { type: 'add', track: track('b') })
    expect(s.current?.id).toBe('a')
    expect(s.queue.map((t) => t.id)).toEqual(['b'])
  })

  it('avanzar toma la siguiente', () => {
    let s = reduce(emptyState(), { type: 'add', track: track('a') })
    s = reduce(s, { type: 'add', track: track('b') })
    s = reduce(s, { type: 'next' })
    expect(s.current?.id).toBe('b')
  })

  it('al vaciarse la cola deja de reproducir', () => {
    let s = reduce(emptyState(), { type: 'add', track: track('a') })
    s = reduce(s, { type: 'next' })
    expect(s.current).toBeNull()
    expect(s.playing).toBe(false)
  })

  it('quitar la que está sonando avanza a la siguiente', () => {
    let s = reduce(emptyState(), { type: 'add', track: track('a') })
    s = reduce(s, { type: 'add', track: track('b') })
    s = reduce(s, { type: 'remove', id: 'a' })
    expect(s.current?.id).toBe('b')
  })

  it('enrich completa título y duración sin perder el id', () => {
    let s = reduce(emptyState(), { type: 'add', track: track('a', { title: 'a' }) })
    s = reduce(s, { type: 'enrich', id: 'a', patch: { title: 'Nombre real', duration: 210 } })
    expect(s.current).toMatchObject({ id: 'a', title: 'Nombre real', duration: 210 })
  })

  it('no muta el estado anterior', () => {
    const before = reduce(emptyState(), { type: 'add', track: track('a') })
    const snapshot = JSON.stringify(before)
    reduce(before, { type: 'add', track: track('b') })
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})


describe('volumen compartido', () => {
  it('lo guarda en el estado, que es lo que ve el resto de la reunión', () => {
    const s = reduce(emptyState(), { type: 'setVolume', volume: 0.3 })
    expect(s.volume).toBeCloseTo(0.3)
  })

  it('recorta fuera de rango en vez de propagar un valor imposible', () => {
    expect(reduce(emptyState(), { type: 'setVolume', volume: 5 }).volume).toBe(1)
    expect(reduce(emptyState(), { type: 'setVolume', volume: -1 }).volume).toBe(0)
  })

  it('sobrevive al cambio de canción: es de la sesión, no del tema', () => {
    let s = reduce(emptyState(), { type: 'add', track: track('a') })
    s = reduce(s, { type: 'add', track: track('b') })
    s = reduce(s, { type: 'setVolume', volume: 0.25 })
    s = reduce(s, { type: 'next' })
    expect(s.current?.id).toBe('b')
    expect(s.volume).toBeCloseTo(0.25)
  })
})

describe('reinicio', () => {
  it('el estado vacío no arrastra nada de la sesión anterior', () => {
    const s = emptyState()
    expect(s.current).toBeNull()
    expect(s.queue).toEqual([])
    expect(s.playing).toBe(false)
  })

})

describe('adelantar una canción', () => {
  const base = [
    { type: 'add', track: track('a') },
    { type: 'add', track: track('b') },
    { type: 'add', track: track('c') },
  ] as const

  const seeded = () => base.reduce((state, action) => reduce(state, action), emptyState())

  it('la pone a sonar sin pasar por las de antes', () => {
    const s = reduce(seeded(), { type: 'jump', id: 'c' })
    expect(s.current?.id).toBe('c')
    expect(s.playing).toBe(true)
  })

  /** Perder canciones ajenas por adelantar la propia sería la peor forma de compartir una cola. */
  it('las salteadas quedan en la cola, no se descartan', () => {
    const s = reduce(seeded(), { type: 'jump', id: 'c' })
    expect(s.queue.map((t) => t.id)).toEqual(['b'])
  })

  it('un id que ya no está no cambia nada', () => {
    const before = seeded()
    expect(reduce(before, { type: 'jump', id: 'zzz' })).toBe(before)
  })

  it('adelantar la que ya suena no la duplica ni la pierde', () => {
    const before = seeded()
    expect(reduce(before, { type: 'jump', id: 'a' })).toBe(before)
  })
})
