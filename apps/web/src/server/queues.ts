import 'server-only'
import { AssistEvent, HandoffEvent, QUEUES, TicketWriteMessage, type EventQueue } from '@nexo/shared'
import { sqsClient, SqsEventQueue } from '@nexo/shared/aws'

type Queues = {
  ticketWrites: EventQueue<TicketWriteMessage>
  handoffEvents: EventQueue<HandoffEvent>
  assistEvents: EventQueue<AssistEvent>
}

const globalForQueues = globalThis as unknown as { nexoQueues?: Queues }

/** SQS (Floci locally). Never in the employee's happy path: only outages and handoff events. */
export function queues(): Queues {
  if (!globalForQueues.nexoQueues) {
    const client = sqsClient()
    globalForQueues.nexoQueues = {
      ticketWrites: new SqsEventQueue(client, QUEUES.ticketWrites, TicketWriteMessage),
      handoffEvents: new SqsEventQueue(client, QUEUES.handoffEvents, HandoffEvent),
      assistEvents: new SqsEventQueue(client, QUEUES.assistEvents, AssistEvent),
    }
  }
  return globalForQueues.nexoQueues
}
