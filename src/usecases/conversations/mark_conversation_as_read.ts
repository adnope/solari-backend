import { isValidUuid } from "../../utils/uuid.ts";
import { and, desc, eq, gte } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { conversations, messages } from "../../db/schema.ts";
import { publishWebSocketEventToUsers } from "../../jobs/queue.ts";

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
    const { result, receiverId, hasChanged } = await withTx(async (tx) => {
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

      const targetReceiverId = isUserLow ? conversation.userHigh : conversation.userLow;

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
          result: {
            conversationId: normalizedConversationId,
            userId: normalizedUserId,
            lastReadAt: currentLastReadAt ?? null,
          },
          receiverId: targetReceiverId,
          hasChanged: false,
        };
      }

      if (currentLastReadAt && currentLastReadAt >= latestVisibleMessage.createdAt) {
        return {
          result: {
            conversationId: normalizedConversationId,
            userId: normalizedUserId,
            lastReadAt: currentLastReadAt,
          },
          receiverId: targetReceiverId,
          hasChanged: false,
        };
      }

      if (isUserLow) {
        await tx
          .update(conversations)
          .set({ userLowLastReadAt: latestVisibleMessage.createdAt })
          .where(eq(conversations.id, normalizedConversationId));
      } else {
        await tx
          .update(conversations)
          .set({ userHighLastReadAt: latestVisibleMessage.createdAt })
          .where(eq(conversations.id, normalizedConversationId));
      }

      return {
        result: {
          conversationId: normalizedConversationId,
          userId: normalizedUserId,
          lastReadAt: latestVisibleMessage.createdAt,
        },
        receiverId: targetReceiverId,
        hasChanged: true,
      };
    });

    if (hasChanged) {
      const eventPayload = {
        type: "CONVERSATION_READ" as const,
        payload: result,
      };

      await publishWebSocketEventToUsers([receiverId, normalizedUserId], eventPayload);
    }

    return result;
  } catch (error) {
    if (error instanceof MarkConversationAsReadError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Mark conversation as read\n${error}`);
    throw new MarkConversationAsReadError(
      "INTERNAL_ERROR",
      "Internal server error marking conversation as read.",
      500,
    );
  }
}
