import { describe, expect, it } from 'vitest'
import { type Msg, fromJson, toJson } from '../src/core/protocol.js'

const roundtrip = (msg: Msg) => fromJson(toJson(msg))

describe('protocolo', () => {
  it('sobrevive el viaje de ida y vuelta', () => {
    const msg: Msg = { op: 'add', from: 'p1', track: { id: 'dQw4w9WgXcQ', title: 'Algo', addedBy: 'Ana' } }
    expect(roundtrip(msg)).toEqual(msg)
  })

  it('preserva acentos y emoji', () => {
    const msg: Msg = { op: 'add', from: 'p1', track: { id: 'abc12345678', title: 'Canción ñandú 🎵', addedBy: 'José' } }
    expect(roundtrip(msg)).toEqual(msg)
  })

  it('acepta un snapshot completo', () => {
    const msg: Msg = {
      op: 'state',
      host: 'Ana',
      from: 'p1',
      state: {
        current: { id: 'abc12345678', title: 'Sonando' },
        queue: [{ id: 'def12345678', title: 'Después' }],
        playing: true,
        volume: 0.7,
      },
    }
    expect(roundtrip(msg)).toEqual(msg)
  })

  it('rechaza formas inválidas: vienen de otra instalación, quizá de otra versión', () => {
    const bad = (obj: unknown) => fromJson(JSON.stringify(obj))
    expect(bad({ op: 'add', from: 'p1' })).toBeNull()
    expect(bad({ op: 'add', from: 'p1', track: { title: 'sin id' } })).toBeNull()
    expect(bad({ op: 'inventado', from: 'p1' })).toBeNull()
    expect(bad({ op: 'state', from: 'p1', host: 'x', state: { queue: 'no es array' } })).toBeNull()
    // Sin identidad no se acepta nada: es lo que separa a un participante de otro.
    expect(bad({ op: 'skip' })).toBeNull()
    expect(bad({ op: 'skip', from: '' })).toBeNull()
    expect(bad(null)).toBeNull()
    expect(bad([1, 2, 3])).toBeNull()
  })

  it('no explota con json roto', () => {
    expect(fromJson('{no es json')).toBeNull()
    expect(fromJson('')).toBeNull()
  })
})
