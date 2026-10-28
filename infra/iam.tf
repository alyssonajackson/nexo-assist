# One IAM user per service, each allowed only the SQS calls its code makes (docs/deploy.md lists
# them). Access keys are NOT created here, so they never land in the Terraform state: create them
# with `aws iam create-access-key` and paste them straight into the hosting platform's secrets.
#
# Cognito needs no IAM permission at runtime: the login (InitiateAuth with USER_PASSWORD_AUTH and
# REFRESH_TOKEN_AUTH) is a public API that AWS does not authorize with IAM, the pool and client ids
# come from env (no ListUserPools), and the JWKS is a public URL.

locals {
  consume = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueUrl"]
  produce = ["sqs:SendMessage", "sqs:GetQueueUrl"]
  arn     = { for name, q in aws_sqs_queue.main : name => q.arn }
}

data "aws_iam_policy_document" "web" {
  # apps/web/src/server/assist/commit.ts and handoff.ts: deferred writes and handoff events.
  statement {
    sid       = "Produce"
    actions   = local.produce
    resources = [local.arn["ticket-writes"], local.arn["handoff-events"]]
  }
  # apps/web/src/server/assist/events.ts: "ticket registered" after an outage.
  statement {
    sid       = "Consume"
    actions   = local.consume
    resources = [local.arn["assist-events"]]
  }
}

data "aws_iam_policy_document" "tickets" {
  # services/tickets/src/consumers.ts
  statement {
    sid       = "Consume"
    actions   = local.consume
    resources = [local.arn["ticket-writes"], local.arn["handoff-events"]]
  }
  statement {
    sid       = "Produce"
    actions   = local.produce
    resources = [local.arn["assist-events"]]
  }
}

resource "aws_iam_user" "service" {
  for_each = toset(["web", "tickets"])
  name     = "${var.project}-${each.key}"
}

resource "aws_iam_user_policy" "service" {
  for_each = aws_iam_user.service
  name     = "${each.value.name}-sqs"
  user     = each.value.name
  policy   = each.key == "web" ? data.aws_iam_policy_document.web.json : data.aws_iam_policy_document.tickets.json
}
