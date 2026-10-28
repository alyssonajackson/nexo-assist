import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { SQSClient } from '@aws-sdk/client-sqs'

/**
 * AWS SDK v3 clients. The only difference between local (cognito-local / ElasticMQ) and AWS
 * is the endpoint and the credentials, both from env. Without an endpoint the SDK talks to AWS.
 */
export type AwsEnv = {
  AWS_REGION?: string
  COGNITO_ENDPOINT?: string
  SQS_ENDPOINT?: string
}

export function cognitoClient(env: AwsEnv = process.env): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({
    region: env.AWS_REGION ?? 'us-east-1',
    ...(env.COGNITO_ENDPOINT ? { endpoint: env.COGNITO_ENDPOINT } : {}),
  })
}

export function sqsClient(env: AwsEnv = process.env): SQSClient {
  return new SQSClient({
    region: env.AWS_REGION ?? 'us-east-1',
    ...(env.SQS_ENDPOINT
      ? // ElasticMQ returns queue URLs with its own host name; keep using the configured endpoint.
        { endpoint: env.SQS_ENDPOINT, useQueueUrlAsEndpoint: false }
      : {}),
  })
}
