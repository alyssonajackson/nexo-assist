import { CreateQueueCommand, GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs'
import { QUEUES } from '@nexo/shared'

/** A message received this many times without being deleted moves to the queue's DLQ. */
export const MAX_RECEIVE_COUNT = 5

/**
 * Creates the three queues, each with a `<name>-dlq` and a redrive policy. Idempotent: CreateQueue with
 * the same attributes returns the existing queue. Plain SDK calls, so the same code can create the
 * real queues on AWS. Returns the queue URLs by name.
 */
export async function ensureQueues(client: SQSClient, names: readonly string[] = Object.values(QUEUES)) {
  const urls: Record<string, string> = {}
  for (const name of names) {
    // The DLQ goes first: the main queue's redrive policy needs its ARN.
    const dlq = await client.send(new CreateQueueCommand({ QueueName: `${name}-dlq` }))
    if (!dlq.QueueUrl) throw new Error(`CreateQueue returned no url for ${name}-dlq`)
    const attrs = await client.send(
      new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ['QueueArn'] }),
    )
    const dlqArn = attrs.Attributes?.QueueArn
    if (!dlqArn) throw new Error(`No QueueArn for ${name}-dlq`)

    const queue = await client.send(
      new CreateQueueCommand({
        QueueName: name,
        Attributes: {
          VisibilityTimeout: '30',
          ReceiveMessageWaitTimeSeconds: '20',
          RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: MAX_RECEIVE_COUNT }),
        },
      }),
    )
    if (!queue.QueueUrl) throw new Error(`CreateQueue returned no url for ${name}`)
    urls[name] = queue.QueueUrl
  }
  console.log(`sqs: ${names.length} queues with DLQs`)
  return urls
}
