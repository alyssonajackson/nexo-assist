import { describe, expect, it } from 'vitest'
import { assertProductionEnv, intFromEnv, llmKeyFor, productionEnvProblems } from './env'

const spec = { required: ['MONGODB_URI', 'COGNITO_CLIENT_ID'], forbidden: ['SQS_ENDPOINT'] }

describe('productionEnvProblems', () => {
  it('checks nothing outside production', () => {
    expect(productionEnvProblems(spec, { SQS_ENDPOINT: 'http://floci:4566' })).toEqual([])
  })

  it('lists every missing and forbidden variable in production', () => {
    const env = { APP_ENV: 'production', MONGODB_URI: 'mongodb+srv://x', SQS_ENDPOINT: 'http://floci:4566' }
    expect(productionEnvProblems(spec, env)).toEqual([
      'COGNITO_CLIENT_ID is required',
      'SQS_ENDPOINT must not be set',
    ])
    expect(() => assertProductionEnv('web', spec, env)).toThrow(/web: invalid production env/)
  })

  it('treats blank values as missing', () => {
    const env = { APP_ENV: 'production', MONGODB_URI: ' ', COGNITO_CLIENT_ID: 'abc', SQS_ENDPOINT: '' }
    expect(productionEnvProblems(spec, env)).toEqual(['MONGODB_URI is required'])
  })
})

describe('llmKeyFor', () => {
  it('maps the model to its provider key', () => {
    expect(llmKeyFor('google/gemini-3.5-flash-lite')).toBe('GOOGLE_GENERATIVE_AI_API_KEY')
    expect(llmKeyFor(undefined)).toBe('GOOGLE_GENERATIVE_AI_API_KEY')
    expect(llmKeyFor('groq/openai/gpt-oss-120b')).toBe('GROQ_API_KEY')
    expect(llmKeyFor('anthropic/claude-haiku-4-5')).toBe('ANTHROPIC_API_KEY')
    expect(llmKeyFor('demo')).toBeUndefined()
  })
})

describe('intFromEnv', () => {
  it('uses the default when unset and rejects invalid values', () => {
    expect(intFromEnv({}, 'X', 7)).toBe(7)
    expect(intFromEnv({ X: '12' }, 'X', 7)).toBe(12)
    expect(() => intFromEnv({ X: '0' }, 'X', 7)).toThrow(/positive integer/)
    expect(() => intFromEnv({ X: 'abc' }, 'X', 7)).toThrow(/positive integer/)
  })
})
