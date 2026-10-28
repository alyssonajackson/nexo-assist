# The values the hosting platform needs (docs/deploy.md). None of them is a secret.

output "region" {
  value = var.region
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "queue_names" {
  value = { for name, q in aws_sqs_queue.main : name => q.name }
}

output "dlq_urls" {
  description = "Where failed messages end up (inspect with aws sqs receive-message)."
  value       = { for name, q in aws_sqs_queue.dlq : name => q.url }
}

output "iam_users" {
  description = "Create one access key per user with `aws iam create-access-key --user-name <name>`."
  value       = { for k, u in aws_iam_user.service : k => u.name }
}
