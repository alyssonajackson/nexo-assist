import {
  ListUserPoolClientsCommand,
  ListUserPoolsCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

export const COGNITO_CLIENT_NAME = 'nexo-web'

export type CognitoConfig = {
  userPoolId: string
  clientId: string
  /** Expected `iss` claim. */
  issuer: string
  /** Where the public signing keys are fetched from. */
  jwksUrl: string
}

export type CognitoEnv = Record<string, string | undefined> & {
  AWS_REGION?: string
  COGNITO_USER_POOL_ID?: string
  COGNITO_CLIENT_ID?: string
  COGNITO_USER_POOL_NAME?: string
  /** Local only: cognito-local signs `iss` with this domain (docker/cognito/config.json). */
  COGNITO_ISSUER_DOMAIN?: string
  /** Local only: where to reach cognito-local for the JWKS (differs inside the compose network). */
  COGNITO_JWKS_DOMAIN?: string
}

export async function findUserPoolId(client: CognitoIdentityProviderClient, name: string) {
  const res = await client.send(new ListUserPoolsCommand({ MaxResults: 60 }))
  return res.UserPools?.find((p) => p.Name === name)?.Id
}

export async function findClientId(client: CognitoIdentityProviderClient, userPoolId: string) {
  const res = await client.send(new ListUserPoolClientsCommand({ UserPoolId: userPoolId, MaxResults: 60 }))
  return res.UserPoolClients?.find((c) => c.ClientName === COGNITO_CLIENT_NAME)?.ClientId
}

/**
 * On AWS the ids come from env (created by infra/). Locally, cognito-local generates ids on the
 * first start, so we look the pool and client up by name.
 */
export async function resolveCognitoConfig(
  client: CognitoIdentityProviderClient,
  env: CognitoEnv = process.env,
): Promise<CognitoConfig> {
  const region = env.AWS_REGION ?? 'us-east-1'
  let userPoolId = env.COGNITO_USER_POOL_ID
  let clientId = env.COGNITO_CLIENT_ID
  if (!userPoolId) {
    const name = env.COGNITO_USER_POOL_NAME ?? 'nexo-assist'
    userPoolId = await findUserPoolId(client, name)
    if (!userPoolId) throw new Error(`Cognito user pool "${name}" not found. Did the init step run?`)
  }
  if (!clientId) {
    clientId = await findClientId(client, userPoolId)
    if (!clientId) throw new Error(`Cognito app client "${COGNITO_CLIENT_NAME}" not found.`)
  }
  const issuerDomain = env.COGNITO_ISSUER_DOMAIN ?? `https://cognito-idp.${region}.amazonaws.com`
  const jwksDomain = env.COGNITO_JWKS_DOMAIN ?? issuerDomain
  return {
    userPoolId,
    clientId,
    issuer: `${issuerDomain}/${userPoolId}`,
    jwksUrl: `${jwksDomain}/${userPoolId}/.well-known/jwks.json`,
  }
}
