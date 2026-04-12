import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { conversations, mutedConversations } from "../../db/schema.ts";

export type ToggleConversationMuteResult = {
  isMuted: boolean;
};

export type MuteConversationErrorType =
  | "MISSING_INPUT"
  | "INVALID_FORMAT"
  | "CONVERSATION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class MuteConversationError extends Error {
  readonly type: MuteConversationErrorType;
  readonly statusCode: number;

  constructor(type: MuteConversationErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "MuteConversationError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function toggleConversationMute(
  userId: string,
  conversationId: string,
): Promise<ToggleConversationMuteResult> {
  const normalizedUserId = userId.trim();
  const normalizedConversationId = conversationId.trim();

  if (!normalizedUserId || !normalizedConversationId) {
    throw new MuteConversationError(
      "MISSING_INPUT",
      "User ID and Conversation ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedConversationId)) {
    throw new MuteConversationError("INVALID_FORMAT", "Invalid ID format.", 400);
  }

  try {
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, normalizedConversationId),
          or(
            eq(conversations.userLow, normalizedUserId),
            eq(conversations.userHigh, normalizedUserId),
          ),
        ),
      )
      .limit(1);

    if (!conversation) {
      throw new MuteConversationError(
        "CONVERSATION_NOT_FOUND",
        "Conversation not found or you do not have access.",
        404,
      );
    }

    const [existingMute] = await db
      .select({ mutedAt: mutedConversations.mutedAt })
      .from(mutedConversations)
      .where(
        and(
          eq(mutedConversations.userId, normalizedUserId),
          eq(mutedConversations.conversationId, normalizedConversationId),
        ),
      )
      .limit(1);

    if (existingMute) {
      await db
        .delete(mutedConversations)
        .where(
          and(
            eq(mutedConversations.userId, normalizedUserId),
            eq(mutedConversations.conversationId, normalizedConversationId),
          ),
        );
      return { isMuted: false };
    } else {
      await db.insert(mutedConversations).values({
        userId: normalizedUserId,
        conversationId: normalizedConversationId,
      });
      return { isMuted: true };
    }
  } catch (error) {
    if (error instanceof MuteConversationError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Toggle conversation mute\n${error}`);
    throw new MuteConversationError("INTERNAL_ERROR", "Error toggling conversation mute.", 500);
  }
}
