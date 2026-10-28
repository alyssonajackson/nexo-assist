import { ChatStreamEvent } from '@nexo/shared'

/**
 * Splits a buffer of NDJSON text into complete lines. The last, unfinished line stays in `rest` until
 * the next chunk arrives. Blank lines are skipped.
 */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.filter((l) => l.trim() !== ''), rest }
}

/** One NDJSON line -> a validated event. A line that breaks the contract becomes an `error` event. */
export function parseEvent(line: string): ChatStreamEvent {
  try {
    const parsed = ChatStreamEvent.safeParse(JSON.parse(line))
    if (parsed.success) return parsed.data
  } catch {
    // not JSON: handled below
  }
  return { type: 'error', error: 'bad_event', message: 'Resposta inesperada do servidor.' }
}

/** Reads a streamed NDJSON response body, yielding each event as soon as its line is complete. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    const { lines, rest } = splitLines(done ? `${buffer}\n` : buffer)
    buffer = rest
    for (const line of lines) yield parseEvent(line)
    if (done) return
  }
}
