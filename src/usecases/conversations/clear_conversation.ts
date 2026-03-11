import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

export type ClearConversationErrorType =
  | "MISSING_INPUT"
  | "CONVERSATION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ClearConversationError extends Error {
  readonly type: ClearConversationErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: ClearConversationErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "ClearConversationError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function clearConversation(userId: string, conversationId: string): Promise<void> {
  if (!userId || !conversationId) {
    throw new ClearConversationError(
      "MISSING_INPUT",
      "User ID and Conversation ID are required.",
      400,
    );
  }

  try {
    await withDb(async (client) => {
      const result = await client.queryObject<{ id: string }>`
        UPDATE conversations
        SET
          user_low_cleared_at = CASE WHEN user_low = ${userId} THEN now() ELSE user_low_cleared_at END,
          user_high_cleared_at = CASE WHEN user_high = ${userId} THEN now() ELSE user_high_cleared_at END
        WHERE id = ${conversationId} AND (user_low = ${userId} OR user_high = ${userId})
        RETURNING id
      `;

      if (result.rows.length === 0) {
        throw new ClearConversationError(
          "CONVERSATION_NOT_FOUND",
          "Conversation not found or you are not a participant.",
          404,
        );
      }
    });
  } catch (error) {
    if (error instanceof ClearConversationError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new ClearConversationError("CONVERSATION_NOT_FOUND", "Invalid ID format.", 404);
    }

    throw new ClearConversationError(
      "INTERNAL_ERROR",
      "Internal server error clearing conversation.",
      500,
    );
  }
}
