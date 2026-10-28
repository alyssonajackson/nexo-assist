import { describe, expect, it, vi } from 'vitest'
import { backoffDelay, RetryExhaustedError, withRetry } from './retry'

const opts = { attempts: 4, baseDelayMs: 400, maxDelayMs: 2500, sleep: async () => {}, random: () => 1 }
const transient = new Error('503')
const isRetryable = (e: unknown) => e === transient

describe('backoffDelay', () => {
  it('doubles up to the cap', () => {
    expect([1, 2, 3, 4, 5].map((n) => backoffDelay(n, opts))).toEqual([400, 800, 1600, 2500, 2500])
  })
  it('applies full jitter', () => {
    expect(backoffDelay(3, { ...opts, random: () => 0.5 })).toBe(800)
  })
})

describe('withRetry', () => {
  it('returns as soon as an attempt succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(transient).mockResolvedValueOnce('ok')
    const onRetry = vi.fn()
    await expect(withRetry(fn, isRetryable, { ...opts, onRetry })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, delayMs: 400, error: transient })
  })

  it('gives up after the configured attempts', async () => {
    const fn = vi.fn().mockRejectedValue(transient)
    await expect(withRetry(fn, isRetryable, opts)).rejects.toBeInstanceOf(RetryExhaustedError)
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('does not retry non-retryable errors', async () => {
    const notFound = new Error('404')
    const fn = vi.fn().mockRejectedValue(notFound)
    await expect(withRetry(fn, isRetryable, opts)).rejects.toBe(notFound)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
