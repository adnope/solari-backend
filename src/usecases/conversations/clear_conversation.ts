import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq, or, sql } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { conversations } from "../../db/schema.ts";

export type ClearConversationErrorType =
  | "MISSING_INPUT"
  | "CONVERSATION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ClearConversationError extends Error {
  readonly type: ClearConversationErrorType;
  readonly statusCode: number;

  constructor(type: ClearConversationErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ClearConversationError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function clearConversation(userId: string, conversationId: string): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedConversationId = conversationId.trim();

  if (!normalizedUserId || !normalizedConversationId) {
    throw new ClearConversationError(
      "MISSING_INPUT",
      "User ID and Conversation ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedConversationId)) {
    throw new ClearConversationError("CONVERSATION_NOT_FOUND", "Invalid ID format.", 404);
  }

  try {
    const [updated] = await withTx(async (tx) => {
      return await tx
        .update(conversations)
        .set({
          userLowClearedAt: sql`CASE
            WHEN ${conversations.userLow} = ${normalizedUserId}
            THEN now()
            ELSE ${conversations.userLowClearedAt}
          END`,
          userHighClearedAt: sql`CASE
            WHEN ${conversations.userHigh} = ${normalizedUserId}
            THEN now()
            ELSE ${conversations.userHighClearedAt}
          END`,
        })
        .where(
          and(
            eq(conversations.id, normalizedConversationId),
            or(
              eq(conversations.userLow, normalizedUserId),
              eq(conversations.userHigh, normalizedUserId),
            ),
          ),
        )
        .returning({ id: conversations.id });
    });

    if (!updated) {
      throw new ClearConversationError(
        "CONVERSATION_NOT_FOUND",
        "Conversation not found or you are not a participant.",
        404,
      );
    }
  } catch (error) {
    if (error instanceof ClearConversationError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Clear conversation\n${error}`);
    throw new ClearConversationError(
      "INTERNAL_ERROR",
      "Internal server error clearing conversation.",
      500,
    );
  }
}
