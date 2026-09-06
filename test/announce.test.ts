import { describe, expect, it } from 'vitest'
import { EXTENSION_URL, announcementText, ellipsis } from '../src/core/announce.js'

describe('aviso del chat', () => {
  it('nombra la canción, a quien la comparte y dónde conseguir la extensión', () => {
    const text = announcementText({ title: 'Bohemian Rhapsody', host: 'Ana' })
    expect(text).toContain('Bohemian Rhapsody')
    expect(text).toContain('Ana')
    expect(text).toContain(EXTENSION_URL)
    expect(text).toContain('Meet Music')
  })

  it('sin título todavía, igual dice que hay música sonando', () => {
    const text = announcementText({ title: null, host: 'Ana' })
    expect(text).toContain('music is playing')
    expect(text).toContain(EXTENSION_URL)
  })

  it('sin nombre legible no inventa uno propio', () => {
    expect(announcementText({ title: 'X', host: '   ' })).toContain('Someone is sharing it')
  })

  it('va en una sola línea: el chat de Meet no acepta otra cosa', () => {
    const text = announcementText({ title: 'Un\ntema\tcon saltos', host: 'Ana' })
    expect(text).not.toMatch(/[\n\r\t]/)
  })

  /**
   * Es la garantía que hace que el aviso y la cola cifrada convivan: si el texto plano matcheara el
   * formato de cable, la extensión de otra persona lo escondería y nadie lo leería.
   */
  it('no se confunde con un mensaje cifrado de la cola', () => {
    const text = announcementText({ title: 'Algo', host: 'Ana' })
    expect(text).not.toContain('[mm1]')
  })
})

describe('recorte de títulos', () => {
  it('deja intacto lo que entra', () => {
    expect(ellipsis('corto', 20)).toBe('corto')
  })

  it('corta por palabra cuando puede', () => {
    expect(ellipsis('uno dos tres cuatro cinco', 16)).toBe('uno dos tres…')
  })

  it('corta a lo bruto si no hay espacio donde cortar', () => {
    const out = ellipsis('a'.repeat(40), 10)
    expect(out).toHaveLength(10)
    expect(out.endsWith('…')).toBe(true)
  })

  it('normaliza los espacios antes de medir', () => {
    expect(ellipsis('  uno   dos  ', 20)).toBe('uno dos')
  })
})
