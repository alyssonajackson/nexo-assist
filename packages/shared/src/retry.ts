export type RetryOptions = {
  /** Total attempts, including the first one. */
  attempts: number
  baseDelayMs: number
  maxDelayMs: number
  /** Called before waiting for the next attempt (drives "tentando novamente" in the UI). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

/** ~5 s worst case: covers the ticket system's typical 3-8 s blips without making the employee wait long. */
export const DEFAULT_RETRY: RetryOptions = { attempts: 4, baseDelayMs: 400, maxDelayMs: 2500 }

export class RetryExhaustedError extends Error {
  override name = 'RetryExhaustedError'
  constructor(
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(`Gave up after ${attempts} attempts`)
  }
}

/** Exponential backoff with full jitter: delay = random(0, min(max, base * 2^n)). */
export function backoffDelay(
  attempt: number,
  opts: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'random'>,
) {
  const cap = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1))
  return Math.round((opts.random ?? Math.random)() * cap)
}

/**
 * Runs `fn` until it succeeds, a non-retryable error is thrown, or attempts run out.
 * Only call it for idempotent operations (reads, or writes with an idempotency key).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  opts: RetryOptions = DEFAULT_RETRY,
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastError: unknown
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      if (!isRetryable(error)) throw error
      lastError = error
      if (attempt === opts.attempts) break
      const delayMs = backoffDelay(attempt, opts)
      opts.onRetry?.({ attempt, delayMs, error })
      await sleep(delayMs)
    }
  }
  throw new RetryExhaustedError(opts.attempts, lastError)
}
