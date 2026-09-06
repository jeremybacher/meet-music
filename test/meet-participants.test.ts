import { describe, expect, it } from 'vitest'
import { parseParticipantCount } from '../src/content/meet-participants.js'

describe('contador de participantes', () => {
  it('lee el número suelto dentro del botón', () => {
    expect(parseParticipantCount('Mostrar a todos', ' 4 ')).toBe(4)
  })

  it('lee el número entre paréntesis de la etiqueta', () => {
    expect(parseParticipantCount('Show everyone (12)', '')).toBe(12)
  })

  it('lee el número que abre la etiqueta', () => {
    expect(parseParticipantCount('3 participants', '')).toBe(3)
    expect(parseParticipantCount('2 personas en la llamada', '')).toBe(2)
  })

  it('prefiere el texto del botón antes que la etiqueta', () => {
    expect(parseParticipantCount('Show everyone (2)', '7')).toBe(7)
  })

  /**
   * Meet mete atajos y números sueltos en varias etiquetas. Confundir uno con el conteo dispararía
   * avisos en el chat sin que haya entrado nadie, que es peor que no avisar.
   */
  it('no toma cualquier número que aparezca', () => {
    expect(parseParticipantCount('Chat with everyone ctrl 5', '')).toBeNull()
    expect(parseParticipantCount('Personas', '')).toBeNull()
    expect(parseParticipantCount('Personas', 'abc')).toBeNull()
  })

  it('ignora un texto de botón que no sea sólo el número', () => {
    expect(parseParticipantCount('Personas', '4 personas')).toBeNull()
  })
})
