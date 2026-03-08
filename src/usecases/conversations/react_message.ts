import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { newUUIDv7 } from "../../utils/uuid.ts";

export type ReactMessageInput = {
  userId: string;
  messageId: string;
  emoji: string;
};

export type ReactMessageResult = {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: Date;
};

export type ReactMessageErrorType =
  | "MISSING_INPUT"
  | "INVALID_EMOJI"
  | "UNAUTHORIZED_OR_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ReactMessageError extends Error {
  readonly type: ReactMessageErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: ReactMessageErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "ReactMessageError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export function isSingleEmoji(input: string): boolean {
  const emojiRegex = /^\p{RGI_Emoji}$/v;
  return emojiRegex.test(input);
}

export async function reactMessage(
  input: ReactMessageInput,
): Promise<ReactMessageResult> {
  const trimmedEmoji = input.emoji?.trim();
  if (!input.userId || !input.messageId || !trimmedEmoji) {
    throw new ReactMessageError(
      "MISSING_INPUT",
      "User ID, Message ID, and Emoji are required.",
      400,
    );
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new ReactMessageError(
      "INVALID_EMOJI",
      "Reaction must be a single valid emoji.",
      400,
    );
  }

  const reactionId = newUUIDv7();

  try {
    return await withDb(async (client) => {
      const authCheckResult = await client.queryObject<{ exists: boolean }>(
        `
              SELECT EXISTS (
                SELECT 1 FROM messages m
                JOIN conversations c ON c.id = m.conversation_id
                WHERE m.id = $1
                  AND (
                    (c.user_low = $2 AND (c.user_low_cleared_at IS NULL OR m.created_at >=
                    c.user_low_cleared_at)
                    OR
                    (c.user_high = $2 AND (c.user_high_cleared_at IS NULL OR m.created_at >= c.user_high_cleared_at))
                  )
              ) AS exists
              `,
        [input.messageId, input.userId],
      );

      if (!authCheckResult.rows[0].exists) {
        throw new ReactMessageError(
          "UNAUTHORIZED_OR_NOT_FOUND",
          "Message not found, deleted, or you are not authorized to react to it.",
          404,
        );
      }

      const result = await client.queryObject<{ id: string; created_at: Date }>(
        `
        INSERT INTO message_reactions (id, message_id, user_id, emoji)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET emoji = EXCLUDED.emoji
        RETURNING id, created_at
        `,
        [reactionId, input.messageId, input.userId, trimmedEmoji],
      );

      return {
        id: result.rows[0].id,
        messageId: input.messageId,
        userId: input.userId,
        emoji: trimmedEmoji,
        createdAt: result.rows[0].created_at,
      };
    });
  } catch (error) {
    if (error instanceof ReactMessageError) throw error;

    if (isPgError(error) && error.fields.code === "22P02") {
      throw new ReactMessageError(
        "UNAUTHORIZED_OR_NOT_FOUND",
        "Invalid message ID format.",
        404,
      );
    }

    throw new ReactMessageError(
      "INTERNAL_ERROR",
      "Internal server error adding reaction.",
      500,
    );
  }
}
