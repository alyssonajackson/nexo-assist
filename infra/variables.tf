variable "region" {
  description = "AWS region for Cognito and SQS."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Prefix for every resource name. The app looks the pool up by these names only locally."
  type        = string
  default     = "nexo-assist"
}

variable "budget_email" {
  description = "Who gets the AWS Budget alerts."
  type        = string
}

variable "budget_limit_usd" {
  description = "Monthly budget. Cognito (under 10k MAU) and SQS (under 1M requests) stay in the free tier."
  type        = number
  default     = 5
}
