import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

export type RemoveMessageReactionErrorType =
  | "MISSING_INPUT"
  | "REACTION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class RemoveMessageReactionError extends Error {
  readonly type: RemoveMessageReactionErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: RemoveMessageReactionErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "RemoveMessageReactionError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function removeMessageReaction(
  userId: string,
  messageId: string,
): Promise<void> {
  if (!userId || !messageId) {
    throw new RemoveMessageReactionError(
      "MISSING_INPUT",
      "User ID and Message ID are required.",
      400,
    );
  }

  try {
    await withDb(async (client) => {
      const authCheckResult = await client.queryObject<{ exists: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1 FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE m.id = $1
            AND (
              (c.user_low = $2 AND (c.user_low_cleared_at IS NULL OR m.created_at >= c.user_low_cleared_at))
              OR
              (c.user_high = $2 AND (c.user_high_cleared_at IS NULL OR m.created_at >= c.user_high_cleared_at))
            )
        ) AS exists
        `,
        [messageId, userId],
      );

      if (!authCheckResult.rows[0].exists) {
        throw new RemoveMessageReactionError(
          "REACTION_NOT_FOUND",
          "Message not found, deleted, or you are not authorized.",
          404,
        );
      }

      const result = await client.queryObject<{ id: string }>(
        `
        DELETE FROM message_reactions
        WHERE message_id = $1 AND user_id = $2
        RETURNING id
        `,
        [messageId, userId],
      );

      if (result.rows.length === 0) {
        throw new RemoveMessageReactionError(
          "REACTION_NOT_FOUND",
          "Reaction not found.",
          404,
        );
      }
    });
  } catch (error) {
    if (error instanceof RemoveMessageReactionError) throw error;

    if (isPgError(error) && error.fields.code === "22P02") {
      throw new RemoveMessageReactionError(
        "REACTION_NOT_FOUND",
        "Invalid message ID format.",
        404,
      );
    }

    throw new RemoveMessageReactionError(
      "INTERNAL_ERROR",
      "Internal server error removing reaction.",
      500,
    );
  }
}
