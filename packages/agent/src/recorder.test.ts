import { describe, expect, it } from 'vitest'
import { TOOL_FAILED_LABELS, TOOL_LABELS } from '@nexo/shared'
import { TurnRecorder } from './recorder'

describe('TurnRecorder', () => {
  it('records a successful call with its chip label', async () => {
    const r = new TurnRecorder()
    await r.record(
      'get_ticket',
      async () => 'INC-20311',
      (id) => id,
    )
    expect(r.toolsCalled).toEqual([
      expect.objectContaining({
        tool: 'get_ticket',
        label: TOOL_LABELS.get_ticket,
        ok: true,
        summary: 'INC-20311',
      }),
    ])
  })

  it('labels a failed call differently, so the chip does not claim it worked', async () => {
    const r = new TurnRecorder()
    const notFound = r.record(
      'get_ticket',
      async () => {
        throw new Error('Não encontrei o chamado INC-20365 entre os seus chamados.')
      },
      () => '',
    )
    await expect(notFound).rejects.toThrow()
    expect(r.toolsCalled).toEqual([
      expect.objectContaining({ tool: 'get_ticket', label: 'tentou abrir o chamado', ok: false }),
    ])
    expect(TOOL_FAILED_LABELS.get_ticket).not.toBe(TOOL_LABELS.get_ticket)
  })
})
