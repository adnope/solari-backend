import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { conversations, friendships, messageReactions, messages } from "../../db/schema.ts";
import { publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { hasBlockingRelationship } from "../common_queries.ts";

export type RemoveMessageReactionErrorType =
  | "MISSING_INPUT"
  | "REACTION_NOT_FOUND"
  | "ARCHIVED"
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
    const { receiverId, conversationId } = await withTx(async (tx) => {
      const [authorizedMessage] = await tx
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          userLow: conversations.userLow,
          userHigh: conversations.userHigh,
        })
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

      const targetReceiverId =
        authorizedMessage.userLow === normalizedUserId
          ? authorizedMessage.userHigh
          : authorizedMessage.userLow;

      const isBlocked = await hasBlockingRelationship(normalizedUserId, targetReceiverId, tx);
      if (isBlocked) {
        throw new RemoveMessageReactionError(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      const [friendship] = await tx
        .select({ userLow: friendships.userLow })
        .from(friendships)
        .where(
          and(
            eq(friendships.userLow, authorizedMessage.userLow),
            eq(friendships.userHigh, authorizedMessage.userHigh),
          ),
        )
        .limit(1);

      if (!friendship) {
        throw new RemoveMessageReactionError(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      const [deletedReaction] = await tx
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

      return {
        receiverId: targetReceiverId,
        conversationId: authorizedMessage.conversationId,
      };
    });

    const eventPayload = {
      type: "REACTION_REMOVED" as const,
      payload: {
        conversationId,
        messageId: normalizedMessageId,
        userId: normalizedUserId,
      },
    };

    await publishWebSocketEventToUsers([receiverId, normalizedUserId], eventPayload);
  } catch (error) {
    if (error instanceof RemoveMessageReactionError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Remove message reaction\n${error}`);
    throw new RemoveMessageReactionError(
      "INTERNAL_ERROR",
      "Internal server error removing reaction.",
      500,
    );
  }
}
