import { and, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { conversations, messageReactions, messages } from "../../db/schema.ts";

export type RemoveMessageReactionErrorType =
  | "MISSING_INPUT"
  | "REACTION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class RemoveMessageReactionError extends Error {
  readonly type: RemoveMessageReactionErrorType;
  readonly statusCode: number;

  constructor(type: RemoveMessageReactionErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "RemoveMessageReactionError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function removeMessageReaction(userId: string, messageId: string): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedMessageId = messageId.trim();

  if (!normalizedUserId || !normalizedMessageId) {
    throw new RemoveMessageReactionError(
      "MISSING_INPUT",
      "User ID and Message ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedMessageId)) {
    throw new RemoveMessageReactionError("REACTION_NOT_FOUND", "Invalid message ID format.", 404);
  }

  try {
    const [authorizedMessage] = await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(messages.id, normalizedMessageId),
          or(
            and(
              eq(conversations.userLow, normalizedUserId),
              or(
                isNull(conversations.userLowClearedAt),
                gte(messages.createdAt, conversations.userLowClearedAt),
              ),
            ),
            and(
              eq(conversations.userHigh, normalizedUserId),
              or(
                isNull(conversations.userHighClearedAt),
                gte(messages.createdAt, conversations.userHighClearedAt),
              ),
            ),
          ),
        ),
      )
      .limit(1);

    if (!authorizedMessage) {
      throw new RemoveMessageReactionError(
        "REACTION_NOT_FOUND",
        "Message not found, deleted, or you are not authorized.",
        404,
      );
    }

    const [deletedReaction] = await db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, normalizedMessageId),
          eq(messageReactions.userId, normalizedUserId),
        ),
      )
      .returning({ id: messageReactions.id });

    if (!deletedReaction) {
      throw new RemoveMessageReactionError("REACTION_NOT_FOUND", "Reaction not found.", 404);
    }
  } catch (error) {
    if (error instanceof RemoveMessageReactionError) throw error;

    throw new RemoveMessageReactionError(
      "INTERNAL_ERROR",
      "Internal server error removing reaction.",
      500,
    );
  }
}
