import 'server-only'
import type { AuthProvider } from '@nexo/shared'
import { cognitoClient, CognitoAuthProvider, resolveCognitoConfig } from '@nexo/shared/aws'

const globalForAuth = globalThis as unknown as { nexoAuthProvider?: Promise<AuthProvider> }

/** Cognito (or Floci) behind the AuthProvider port. Pool and client ids are resolved once. */
export function authProvider(): Promise<AuthProvider> {
  globalForAuth.nexoAuthProvider ??= (async () => {
    const client = cognitoClient()
    return new CognitoAuthProvider(client, await resolveCognitoConfig(client))
  })().catch((err: unknown) => {
    globalForAuth.nexoAuthProvider = undefined
    throw err
  })
  return globalForAuth.nexoAuthProvider
}
