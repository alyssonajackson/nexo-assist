import type { Affected, Priority, TicketType } from './domain/ticket'

export type PriorityFacts = {
  type: TicketType
  affected: Affected
  /** Stops the person (or team) from working. */
  blocksWork: boolean
  /** A commitment today is at risk (meeting, delivery, deadline). */
  sameDayCommitment: boolean
}

export type PriorityResult = { priority: Priority; rationale: string }

/**
 * Annex A priority matrix: impact (how many people) x urgency (commitment at risk).
 * The model extracts the facts; this function decides the priority.
 *
 * - Crítica: something is down for a team or the whole company.
 * - Alta:    one person cannot work, or there is a same-day commitment.
 * - Média:   it gets in the way, but there is a workaround.
 * - Baixa:   requests and improvements without urgency.
 */
export function derivePriority(facts: PriorityFacts): PriorityResult {
  const widespread = facts.affected === 'team' || facts.affected === 'company'

  if (facts.type === 'INC' && widespread && facts.blocksWork) {
    const who = facts.affected === 'company' ? 'a empresa' : 'uma equipe'
    return { priority: 'critical', rationale: `Algo está parado para ${who}.` }
  }
  if (facts.sameDayCommitment) {
    return { priority: 'high', rationale: 'Há um compromisso hoje que depende disso.' }
  }
  if (facts.blocksWork) {
    return { priority: 'high', rationale: 'Impede a pessoa de trabalhar.' }
  }
  if (facts.type === 'INC') {
    return { priority: 'medium', rationale: 'Atrapalha, mas há alternativa para continuar trabalhando.' }
  }
  return { priority: 'low', rationale: 'Pedido sem urgência.' }
}
