import 'server-only'
import { ObjectId } from 'mongodb'
import type { Message } from '@nexo/shared'
import { assistDb, type MessageDoc } from '../db'
import { toMessage } from './docs'

export type NewMessage = Omit<Message, 'id' | 'createdAt'>

/** Stores a message and bumps the conversation's preview (single-document writes, no transaction). */
export async function appendMessage(input: NewMessage): Promise<Message> {
  const db = await assistDb()
  const doc: MessageDoc = { _id: new ObjectId().toHexString(), ...input, createdAt: new Date() }
  await db.messages.insertOne(doc)
  await db.conversations.updateOne(
    { _id: input.conversationId },
    { $set: { lastMessageAt: doc.createdAt, preview: input.text.slice(0, 140) } },
  )
  return toMessage(doc)
}

export const systemMessage = (conversationId: string, text: string) =>
  appendMessage({ conversationId, role: 'system', text, parts: [] })

export async function listMessages(conversationId: string): Promise<Message[]> {
  const docs = await (await assistDb()).messages.find({ conversationId }).sort({ createdAt: 1 }).toArray()
  return docs.map(toMessage)
}
