import { describe, expect, it } from 'vitest'
import { deriveKey } from '../src/core/crypto.js'
import { type Msg, } from '../src/core/protocol.js'
import { openMsg, sealMsg, thumbFor } from '../src/core/wire.js'

const ROOM = 'abc-defg-hij'
const key = await deriveKey(ROOM)
const msg: Msg = {
  op: 'add',
  from: 'p1',
  track: { id: 'dQw4w9WgXcQ', title: 'Canción ñ 🎵', addedBy: 'Ana' },
}

describe('formato de cable', () => {
  it('cifra y descifra con la clave de la sala', async () => {
    const out = await openMsg(key, await sealMsg(key, msg))
    expect(out).toMatchObject({ op: 'add', from: 'p1' })
    expect(out?.op === 'add' && out.track).toMatchObject({
      id: 'dQw4w9WgXcQ',
      title: 'Canción ñ 🎵',
      addedBy: 'Ana',
    })
  })

  it('no manda la miniatura: se deduce del id y ocupaba lugar al pedo', async () => {
    const conThumb = { ...msg, track: { ...msg.track, thumb: 'https://ejemplo/x.jpg' } }
    const wire = await sealMsg(key, conThumb)
    const flaco = await sealMsg(key, msg)
    // Cifrado, el tamaño delata si el campo viajó o no.
    expect(wire.length).toBe(flaco.length)

    const out = await openMsg(key, wire)
    expect(out?.op === 'add' && out.track.thumb).toBe(thumbFor('dQw4w9WgXcQ'))
  })

  it('recorta la miniatura también en los snapshots, que son los mensajes largos', async () => {
    const track = (i: number) => ({
      id: `dQw4w9WgXc${i}`,
      title: 'Un tema con nombre razonablemente largo (Official Video)',
      thumb: `https://i.ytimg.com/vi/dQw4w9WgXc${i}/hqdefault.jpg`,
    })
    const wire = await sealMsg(key, {
      op: 'state',
      from: 'p1',
      host: 'Ana',
      state: {
        current: track(0),
        queue: Array.from({ length: 10 }, (_, i) => track(i + 1)),
        playing: true,
        volume: 0.7,
      },
    })
    // Un mensaje de chat va en una sola línea: tiene que entrar cómodo.
    expect(wire.length).toBeLessThan(2000)
    expect(wire).not.toContain('\n')
  })

  it('el mensaje es una sola línea, que es lo que acepta el chat de Meet', async () => {
    const wire = await sealMsg(key, { op: 'add', from: 'p1', track: { id: 'abc12345678', title: 'Con\nsalto' } })
    expect(wire).not.toContain('\n')
    expect(wire.startsWith('[mm1] ')).toBe(true)
  })

  it('no filtra el contenido en claro', async () => {
    const wire = await sealMsg(key, msg)
    expect(wire).not.toContain('Canción')
    expect(wire).not.toContain('dQw4w9WgXcQ')
    expect(wire).not.toContain('Ana')
  })

  it('cada envío es distinto aunque el mensaje sea el mismo', async () => {
    // IV aleatorio: si no, repetir un estado delataría que se repitió.
    expect(await sealMsg(key, msg)).not.toBe(await sealMsg(key, msg))
  })

  it('ignora la charla normal del chat', async () => {
    for (const text of ['hola gente', '', '[mm1]', '[mm1] corto']) {
      expect(await openMsg(key, text), text).toBeNull()
    }
  })

  it('un humano no puede fabricar una orden imitando el formato', async () => {
    // Sin la clave no hay forma de pasar la autenticación de AES-GCM.
    const fake = '[mm1] ' + btoa(JSON.stringify({ op: 'skip', from: 'intruso' })).replace(/=+$/, '')
    expect(await openMsg(key, fake)).toBeNull()
  })

  it('no se puede manipular un mensaje válido', async () => {
    const wire = await sealMsg(key, msg)
    const tampered = wire.slice(0, -4) + (wire.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA')
    expect(await openMsg(key, tampered)).toBeNull()
  })

  it('otra reunión no puede leer la cola', async () => {
    const otherRoom = await deriveKey('xyz-wxyz-abc')
    expect(await openMsg(otherRoom, await sealMsg(key, msg))).toBeNull()
  })
})
