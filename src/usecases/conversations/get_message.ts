import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { conversations, messageReactions, messages } from "../../db/schema.ts";
import { AppError } from "../app_error.ts";

export type GetMessageReaction = {
  userId: string;
  emoji: string;
};

export type GetMessageResult = {
  id: string;
  senderId: string;
  content: string;
  referencedPostId: string | null;
  repliedMessageId: string | null;
  isDeleted: boolean;
  createdAt: string;
  reactions: GetMessageReaction[];
};

export type GetMessageErrorType = "MISSING_INPUT" | "MESSAGE_NOT_FOUND" | "INTERNAL_ERROR";

export async function getMessage(viewerId: string, messageId: string): Promise<GetMessageResult> {
  const normalizedViewerId = viewerId.trim();
  const normalizedMessageId = messageId.trim();

  if (!normalizedViewerId || !normalizedMessageId) {
    throw new AppError<GetMessageErrorType>(
      "MISSING_INPUT",
      "Viewer ID and Message ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedViewerId) || !isValidUuid(normalizedMessageId)) {
    throw new AppError<GetMessageErrorType>("MESSAGE_NOT_FOUND", "Message not found.", 404);
  }

  try {
    const [message] = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        content: messages.content,
        referencedPostId: messages.referencedPostId,
        repliedMessageId: messages.repliedMessageId,
        isDeleted: messages.isDeleted,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(messages.id, normalizedMessageId),
          or(
            and(
              eq(conversations.userLow, normalizedViewerId),
              or(
                isNull(conversations.userLowClearedAt),
                gte(messages.createdAt, conversations.userLowClearedAt),
              ),
            ),
            and(
              eq(conversations.userHigh, normalizedViewerId),
              or(
                isNull(conversations.userHighClearedAt),
                gte(messages.createdAt, conversations.userHighClearedAt),
              ),
            ),
          ),
        ),
      )
      .limit(1);

    if (!message) {
      throw new AppError<GetMessageErrorType>("MESSAGE_NOT_FOUND", "Message not found.", 404);
    }

    const reactionRows = await db
      .select({
        userId: messageReactions.userId,
        emoji: messageReactions.emoji,
      })
      .from(messageReactions)
      .where(eq(messageReactions.messageId, normalizedMessageId));

    return {
      id: message.id,
      senderId: message.senderId,
      content: message.content,
      referencedPostId: message.referencedPostId,
      repliedMessageId: message.repliedMessageId,
      isDeleted: message.isDeleted,
      createdAt: message.createdAt,
      reactions: reactionRows.map((reaction) => ({
        userId: reaction.userId,
        emoji: reaction.emoji,
      })),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Get message\n${error}`);
    throw new AppError<GetMessageErrorType>(
      "INTERNAL_ERROR",
      "Internal server error fetching message.",
      500,
    );
  }
}
