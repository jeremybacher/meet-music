import { describe, expect, it } from 'vitest'
import { extractNameFromLabel } from '../src/content/meet-identity.js'

describe('extractNameFromLabel', () => {
  it('lee el nombre del botón de cuenta, en cualquier idioma', () => {
    const cases: Array<[string, string]> = [
      ['Cuenta de Google: Jeremy Bacher (jeremy@akua.la)', 'Jeremy Bacher'],
      ['Google Account: Ada Lovelace (ada@example.com)', 'Ada Lovelace'],
      ['Compte Google : Marie Curie (marie@example.fr)', 'Marie Curie'],
      ['Jeremy Bacher (jeremy@akua.la)', 'Jeremy Bacher'],
      ['Cuenta de Google:   José  Ñandú   (jose@example.com)', 'José Ñandú'],
    ]
    for (const [label, expected] of cases) {
      expect(extractNameFromLabel(label), label).toBe(expected)
    }
  })

  it('ignora etiquetas que no traen una cuenta', () => {
    for (const label of [
      'Silenciar micrófono',
      'Cuenta de Google',
      '',
      'Enviar un mensaje a todos',
      '(sin-arroba)',
    ]) {
      expect(extractNameFromLabel(label), label).toBeNull()
    }
  })

  it('no devuelve el propio mail como nombre', () => {
    expect(extractNameFromLabel('Cuenta: (solo@mail.com)')).toBeNull()
    expect(extractNameFromLabel('jeremy@akua.la (jeremy@akua.la)')).toBeNull()
  })
})
