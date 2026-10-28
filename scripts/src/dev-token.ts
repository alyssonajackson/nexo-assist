/**
 * Prints a Cognito access token for a seeded user, for calling the tickets API by hand:
 *   TOKEN=$(pnpm -s token ana) && curl -H "authorization: Bearer $TOKEN" localhost:4000/tickets
 * Users: ana, bruno, carla, diego (employees), rafael (analyst).
 */
import { cognitoClient, CognitoAuthProvider, resolveCognitoConfig } from '@nexo/shared/aws'
import { seedUsers } from './seed/seed'

process.env.COGNITO_ENDPOINT ??= 'http://localhost:9229'
process.env.COGNITO_ISSUER_DOMAIN ??= 'http://localhost:9229'
process.env.AWS_ACCESS_KEY_ID ??= 'local'
process.env.AWS_SECRET_ACCESS_KEY ??= 'local'

const key = process.argv[2] ?? 'ana'
const user = seedUsers.find((u) => u.key === key)
if (!user) {
  console.error(`Unknown user "${key}". Use one of: ${seedUsers.map((u) => u.key).join(', ')}`)
  process.exit(1)
}
const client = cognitoClient()
const auth = new CognitoAuthProvider(client, await resolveCognitoConfig(client))
const tokens = await auth.signIn(user.email, process.env.SEED_PASSWORD ?? 'nexo123')
console.log(tokens.accessToken)
