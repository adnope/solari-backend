import { and, desc, eq, gte } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { conversations, messages } from "../../db/migrations/schema.ts";

export type MarkConversationAsReadResult = {
  conversationId: string;
  userId: string;
  lastReadAt: string | null;
};

export type MarkConversationAsReadErrorType =
  | "MISSING_INPUT"
  | "CONVERSATION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class MarkConversationAsReadError extends Error {
  readonly type: MarkConversationAsReadErrorType;
  readonly statusCode: number;

  constructor(type: MarkConversationAsReadErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "MarkConversationAsReadError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function markConversationAsRead(
  userId: string,
  conversationId: string,
): Promise<MarkConversationAsReadResult> {
  const normalizedUserId = userId.trim();
  const normalizedConversationId = conversationId.trim();

  if (!normalizedUserId || !normalizedConversationId) {
    throw new MarkConversationAsReadError(
      "MISSING_INPUT",
      "User ID and Conversation ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedConversationId)) {
    throw new MarkConversationAsReadError("MISSING_INPUT", "Invalid format.", 400);
  }

  try {
    return await withTx(async (tx) => {
      const [conversation] = await tx
        .select({
          id: conversations.id,
          userLow: conversations.userLow,
          userHigh: conversations.userHigh,
          userLowClearedAt: conversations.userLowClearedAt,
          userHighClearedAt: conversations.userHighClearedAt,
          userLowLastReadAt: conversations.userLowLastReadAt,
          userHighLastReadAt: conversations.userHighLastReadAt,
        })
        .from(conversations)
        .where(eq(conversations.id, normalizedConversationId))
        .limit(1);

      if (!conversation) {
        throw new MarkConversationAsReadError(
          "CONVERSATION_NOT_FOUND",
          "Conversation not found.",
          404,
        );
      }

      const isUserLow = conversation.userLow === normalizedUserId;
      const isUserHigh = conversation.userHigh === normalizedUserId;

      if (!isUserLow && !isUserHigh) {
        throw new MarkConversationAsReadError(
          "CONVERSATION_NOT_FOUND",
          "Conversation not found.",
          404,
        );
      }

      const clearedAt = isUserLow ? conversation.userLowClearedAt : conversation.userHighClearedAt;

      const currentLastReadAt = isUserLow
        ? conversation.userLowLastReadAt
        : conversation.userHighLastReadAt;

      const [latestVisibleMessage] = await tx
        .select({
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, normalizedConversationId),
            clearedAt ? gte(messages.createdAt, clearedAt) : undefined,
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(1);

      if (!latestVisibleMessage) {
        return {
          conversationId: normalizedConversationId,
          userId: normalizedUserId,
          lastReadAt: currentLastReadAt ?? null,
        };
      }

      if (currentLastReadAt && currentLastReadAt >= latestVisibleMessage.createdAt) {
        return {
          conversationId: normalizedConversationId,
          userId: normalizedUserId,
          lastReadAt: currentLastReadAt,
        };
      }

      if (isUserLow) {
        await tx
          .update(conversations)
          .set({
            userLowLastReadAt: latestVisibleMessage.createdAt,
          })
          .where(eq(conversations.id, normalizedConversationId));
      } else {
        await tx
          .update(conversations)
          .set({
            userHighLastReadAt: latestVisibleMessage.createdAt,
          })
          .where(eq(conversations.id, normalizedConversationId));
      }

      return {
        conversationId: normalizedConversationId,
        userId: normalizedUserId,
        lastReadAt: latestVisibleMessage.createdAt,
      };
    });
  } catch (error) {
    if (error instanceof MarkConversationAsReadError) throw error;

    throw new MarkConversationAsReadError(
      "INTERNAL_ERROR",
      "Internal server error marking conversation as read.",
      500,
    );
  }
}
