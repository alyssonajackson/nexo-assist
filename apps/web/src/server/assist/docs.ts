import 'server-only'
import { Conversation, Draft, Message } from '@nexo/shared'
import type { ConversationDoc, DraftDoc, MessageDoc } from '../db'

/** Mongo document -> domain object, validated with the shared schemas (no Mongoose). */
export const toConversation = ({ _id, ...rest }: ConversationDoc): Conversation =>
  Conversation.parse({ id: _id, ...rest })
export const toMessage = ({ _id, ...rest }: MessageDoc): Message => Message.parse({ id: _id, ...rest })
export const toDraft = ({ _id, ...rest }: DraftDoc): Draft => Draft.parse({ id: _id, ...rest })
