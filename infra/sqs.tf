# Same queues that scripts/src/lib/queues.ts creates on Floci locally (QUEUES in packages/shared).
locals {
  queues = toset(["ticket-writes", "assist-events", "handoff-events"])
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = local.queues
  name                      = "${each.key}-dlq"
  message_retention_seconds = 1209600 # 14 days, the maximum: time to look at what failed
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "main" {
  for_each                   = local.queues
  name                       = each.key
  visibility_timeout_seconds = 30
  receive_wait_time_seconds  = 20 # long polling: an idle consumer costs ~3 requests a minute
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = 5 # MAX_RECEIVE_COUNT in scripts/src/lib/queues.ts
  })
}

# Only the matching main queue may move messages into each DLQ.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  for_each  = local.queues
  queue_url = aws_sqs_queue.dlq[each.key].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.main[each.key].arn]
  })
}
