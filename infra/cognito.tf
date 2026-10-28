# Same pool, client and groups that scripts/src/lib/cognito.ts creates on Floci locally.

resource "aws_cognito_user_pool" "main" {
  name = var.project

  # Demo passwords like "nexo123" (PRD: "any password"; relaxed on purpose, see README).
  password_policy {
    minimum_length                   = 6
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # Only the seeded users exist: nobody can sign up from the public URL.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  auto_verified_attributes = ["email"]
  deletion_protection      = "INACTIVE" # so `terraform destroy` tears it all down
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "nexo-web" # COGNITO_CLIENT_NAME in packages/shared/src/aws/cognito-config.ts
  user_pool_id = aws_cognito_user_pool.main.id

  # A public client: the login runs on our server, but no secret means none to leak or rotate.
  generate_secret     = false
  explicit_auth_flows = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  # "E-mail ou senha inválidos" either way: the login does not reveal which e-mails exist.
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30 # "Manter conectado" keeps the refresh cookie for 30 days
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "role" {
  for_each     = toset(["employee", "analyst"])
  name         = each.key
  user_pool_id = aws_cognito_user_pool.main.id
}
