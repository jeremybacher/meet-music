import { describe, expect, it } from 'vitest'
import { type MicButtonBox, isMutedLabel, sameBox } from '../src/content/meet-controls.js'

const box = (extra: Partial<MicButtonBox> = {}): MicButtonBox => ({
  top: 100,
  left: 200,
  width: 48,
  height: 48,
  bg: 'rgb(60, 64, 67)',
  fg: 'rgb(232, 234, 237)',
  ...extra,
})

describe('estado del micrófono de Meet', () => {
  it('lee el silenciado desde aria-pressed', () => {
    expect(isMutedLabel('Silenciar micrófono', 'true')).toBe(true)
    expect(isMutedLabel('Silenciar micrófono', 'false')).toBe(false)
  })

  /** Meet alterna la etiqueta en vez de mantener el estado; hay que leer las dos cosas. */
  it('lee el silenciado desde la etiqueta, en cualquier idioma', () => {
    expect(isMutedLabel('Activar micrófono', null)).toBe(true)
    expect(isMutedLabel('Turn on microphone', null)).toBe(true)
    expect(isMutedLabel('Unmute microphone', null)).toBe(true)
    expect(isMutedLabel('Réactiver le micro', null)).toBe(true)
  })

  it('no confunde el estado normal con silenciado', () => {
    expect(isMutedLabel('Silenciar micrófono', null)).toBe(false)
    expect(isMutedLabel('Turn off microphone', null)).toBe(false)
    expect(isMutedLabel('Mute microphone', null)).toBe(false)
  })
})

/**
 * La caja se mide varias veces por segundo y llega siempre como un objeto nuevo. Sin comparar por
 * valor, cada medición repintaría el panel entero y pisaría lo que se estuviera tipeando.
 */
describe('comparación de la caja del botón', () => {
  it('dos medidas iguales son la misma caja', () => {
    expect(sameBox(box(), box())).toBe(true)
  })

  it('detecta que se movió, que cambió de tamaño o que cambió de color', () => {
    expect(sameBox(box(), box({ left: 201 }))).toBe(false)
    expect(sameBox(box(), box({ width: 40 }))).toBe(false)
    expect(sameBox(box(), box({ bg: 'rgb(0, 0, 0)' }))).toBe(false)
  })

  it('aparecer y desaparecer cuentan como cambio', () => {
    expect(sameBox(null, box())).toBe(false)
    expect(sameBox(box(), null)).toBe(false)
    expect(sameBox(null, null)).toBe(true)
  })
})
