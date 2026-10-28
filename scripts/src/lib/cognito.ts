import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CreateGroupCommand,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { COGNITO_CLIENT_NAME, findClientId, findUserPoolId } from '@nexo/shared/aws'
import type { Role } from '@nexo/shared'

const GROUPS: Role[] = ['employee', 'analyst']

const isAwsError = (err: unknown, name: string) => err instanceof Error && err.name === name

/** Finds or creates the user pool, the web app client (no secret) and the two role groups. */
export async function ensureUserPool(client: CognitoIdentityProviderClient, poolName: string) {
  let userPoolId = await findUserPoolId(client, poolName)
  if (!userPoolId) {
    const res = await client.send(
      new CreateUserPoolCommand({
        PoolName: poolName,
        // Demo passwords like "nexo123" (PRD: "any password"; relaxed on purpose, see README).
        Policies: {
          PasswordPolicy: {
            MinimumLength: 6,
            RequireLowercase: false,
            RequireUppercase: false,
            RequireNumbers: false,
            RequireSymbols: false,
          },
        },
        AutoVerifiedAttributes: ['email'],
      }),
    )
    userPoolId = res.UserPool?.Id
    if (!userPoolId) throw new Error('CreateUserPool returned no id')
    console.log(`cognito: created user pool ${userPoolId}`)
  }

  let clientId = await findClientId(client, userPoolId)
  if (!clientId) {
    const res = await client.send(
      new CreateUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientName: COGNITO_CLIENT_NAME,
        GenerateSecret: false,
        ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      }),
    )
    clientId = res.UserPoolClient?.ClientId
    if (!clientId) throw new Error('CreateUserPoolClient returned no id')
    console.log(`cognito: created app client ${clientId}`)
  }

  for (const group of GROUPS) {
    try {
      await client.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: group }))
    } catch (err) {
      if (!isAwsError(err, 'GroupExistsException')) throw err
    }
  }
  return { userPoolId, clientId }
}

export type CognitoUserSpec = { email: string; name: string; role: Role; password: string }

/** Finds or creates a user with a permanent password and its role group. Returns the `sub`. */
export async function ensureUser(
  client: CognitoIdentityProviderClient,
  userPoolId: string,
  spec: CognitoUserSpec,
) {
  let sub: string | undefined
  try {
    const existing = await client.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: spec.email }),
    )
    sub = existing.UserAttributes?.find((a) => a.Name === 'sub')?.Value
  } catch (err) {
    if (!isAwsError(err, 'UserNotFoundException')) throw err
    const created = await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: spec.email,
        MessageAction: 'SUPPRESS',
        TemporaryPassword: spec.password,
        UserAttributes: [
          { Name: 'email', Value: spec.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: spec.name },
        ],
      }),
    )
    sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value
    console.log(`cognito: created user ${spec.email}`)
  }
  if (!sub) throw new Error(`No sub for ${spec.email}`)

  // Permanent password skips the FORCE_CHANGE_PASSWORD challenge. Re-applied so SEED_PASSWORD changes take effect.
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: spec.email,
      Password: spec.password,
      Permanent: true,
    }),
  )
  await client.send(
    new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: spec.email, GroupName: spec.role }),
  )
  return sub
}
