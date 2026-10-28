import { GetQueueUrlCommand } from '@aws-sdk/client-sqs'
import { sqsClient } from '@nexo/shared/aws'
import { env } from '../env'

export const sqs = sqsClient(env)

export const QUEUES = ['ticket-writes', 'assist-events', 'handoff-events'] as const

export async function queueUrl(name: string): Promise<string> {
  const res = await sqs.send(new GetQueueUrlCommand({ QueueName: name }))
  if (!res.QueueUrl) throw new Error(`queue ${name} not found`)
  return res.QueueUrl
}
