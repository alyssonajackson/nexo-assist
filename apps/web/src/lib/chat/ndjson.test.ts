import { describe, expect, it } from 'vitest'
import type { ChatStreamEvent } from '@nexo/shared'
import { parseEvent, readEvents, splitLines } from './ndjson'

const line = (event: ChatStreamEvent) => JSON.stringify(event)

/** A body that delivers the given byte chunks one by one. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

async function collect(body: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const e of readEvents(body)) events.push(e)
  return events
}

describe('splitLines', () => {
  it('returns complete lines and keeps the partial last line in rest', () => {
    expect(splitLines('a\nb\npart')).toEqual({ lines: ['a', 'b'], rest: 'part' })
  })
  it('leaves an empty rest when the buffer ends with a newline', () => {
    expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b'], rest: '' })
  })
  it('skips blank lines', () => {
    expect(splitLines('a\n\n  \nb\n')).toEqual({ lines: ['a', 'b'], rest: '' })
  })
  it('returns only rest when there is no newline', () => {
    expect(splitLines('abc')).toEqual({ lines: [], rest: 'abc' })
  })
  it('handles an empty buffer', () => {
    expect(splitLines('')).toEqual({ lines: [], rest: '' })
  })
})

describe('parseEvent', () => {
  it('parses a valid event', () => {
    const event: ChatStreamEvent = { type: 'reply_delta', delta: 'Olá' }
    expect(parseEvent(line(event))).toEqual(event)
  })
  it('turns invalid JSON into a bad_event error', () => {
    expect(parseEvent('{not json')).toMatchObject({ type: 'error', error: 'bad_event' })
  })
  it('turns JSON that breaks the schema into a bad_event error', () => {
    expect(parseEvent('{"type":"reply_delta"}')).toMatchObject({ type: 'error', error: 'bad_event' })
    expect(parseEvent('{"type":"unknown"}')).toMatchObject({ type: 'error', error: 'bad_event' })
    expect(parseEvent('42')).toMatchObject({ type: 'error', error: 'bad_event' })
  })
})

describe('readEvents', () => {
  const enc = new TextEncoder()
  const a: ChatStreamEvent = { type: 'reply_delta', delta: 'um' }
  const b: ChatStreamEvent = { type: 'reply_delta', delta: 'dois' }

  it('yields events from lines split across chunks', async () => {
    const text = `${line(a)}\n${line(b)}\n`
    const mid = Math.floor(text.length / 3)
    const body = streamOf([
      enc.encode(text.slice(0, mid)),
      enc.encode(text.slice(mid, mid * 2)),
      enc.encode(text.slice(mid * 2)),
    ])
    expect(await collect(body)).toEqual([a, b])
  })

  it('decodes a multi-byte character split across chunks', async () => {
    const event: ChatStreamEvent = { type: 'reply_delta', delta: 'Conexão não funciona, ação' }
    const bytes = enc.encode(`${line(event)}\n`)
    // "ã" is 2 bytes: cut between them.
    const cut = bytes.indexOf(0xc3) + 1
    expect(cut).toBeGreaterThan(0)
    const body = streamOf([bytes.slice(0, cut), bytes.slice(cut)])
    expect(await collect(body)).toEqual([event])
  })

  it('splits every byte into its own chunk', async () => {
    const event: ChatStreamEvent = { type: 'reply_delta', delta: 'ç ã' }
    const bytes = enc.encode(`${line(event)}\n${line(a)}\n`)
    const body = streamOf(Array.from(bytes, (byte) => Uint8Array.of(byte)))
    expect(await collect(body)).toEqual([event, a])
  })

  it('yields the final line even without a trailing newline', async () => {
    const body = streamOf([enc.encode(`${line(a)}\n${line(b)}`)])
    expect(await collect(body)).toEqual([a, b])
  })

  it('yields a bad_event error for a malformed line and keeps going', async () => {
    const body = streamOf([enc.encode(`oops\n${line(a)}\n`)])
    const events = await collect(body)
    expect(events[0]).toMatchObject({ type: 'error', error: 'bad_event' })
    expect(events[1]).toEqual(a)
  })

  it('yields nothing for an empty body', async () => {
    expect(await collect(streamOf([]))).toEqual([])
  })
})
