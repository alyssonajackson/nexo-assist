# Everything here fits the AWS free tier; the budget is the alarm for when something does not.
resource "aws_budgets_budget" "monthly" {
  name         = "${var.project}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Only this project's cost, not the whole account's. Needs the `Project` tag activated as a cost
  # allocation tag (Billing > Cost allocation tags); the tag shows up in billing within ~24 h.
  cost_filter {
    name   = "TagKeyValue"
    values = [join("", ["user:Project$", var.project])]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
