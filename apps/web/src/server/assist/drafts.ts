import 'server-only'
import type { DraftStore, ProposedDraft } from '@nexo/agent'
import type { Draft, DraftStatus } from '@nexo/shared'
import { assistDb, type DraftDoc } from '../db'
import { toDraft } from './docs'

/**
 * Drafts are the confirmation state: pending -> confirmed -> committed (or pending_registration while
 * the ticket system is down). Every step is a conditional single-document update on the current status.
 */
export const draftStore: DraftStore = {
  async propose(input: ProposedDraft): Promise<Draft> {
    const db = await assistDb()
    // Only one live draft per conversation: a new proposal replaces the previous one.
    await db.drafts.updateMany(
      { conversationId: input.conversationId, status: 'pending' },
      { $set: { status: 'cancelled' } },
    )
    const counter = await db.counters.findOneAndUpdate(
      { _id: 'draft' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    )
    const doc: DraftDoc = {
      _id: `D-${counter?.seq ?? Date.now()}`,
      ...input,
      status: 'pending',
      createdAt: new Date(),
    }
    await db.drafts.insertOne(doc)
    return toDraft(doc)
  },
  async cancel(draftId: string): Promise<void> {
    await (
      await assistDb()
    ).drafts.updateOne({ _id: draftId, status: 'pending' }, { $set: { status: 'cancelled' } })
  },
}

export async function getDraft(id: string, employeeId: string): Promise<Draft | null> {
  const doc = await (await assistDb()).drafts.findOne({ _id: id, employeeId })
  return doc ? toDraft(doc) : null
}

export async function listDrafts(conversationId: string): Promise<Draft[]> {
  const docs = await (await assistDb()).drafts.find({ conversationId }).sort({ createdAt: 1 }).toArray()
  return docs.map(toDraft)
}

/** Moves a draft from one status to the next; null if it was not in `from` (double click, race, wrong user). */
export async function moveDraft(
  id: string,
  from: DraftStatus[],
  to: DraftStatus,
  set: Partial<Pick<DraftDoc, 'resultTicketId' | 'confirmedAt' | 'committedAt'>> = {},
): Promise<Draft | null> {
  const doc = await (
    await assistDb()
  ).drafts.findOneAndUpdate(
    { _id: id, status: { $in: from } },
    { $set: { ...set, status: to } },
    { returnDocument: 'after' },
  )
  return doc ? toDraft(doc) : null
}
