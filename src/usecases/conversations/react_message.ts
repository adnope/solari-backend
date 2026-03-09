import type { ContentfulStatusCode } from "hono/utils/http-status";
import { v7 } from "uuid";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

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

  constructor(type: ReactMessageErrorType, message: string, statusCode: ContentfulStatusCode) {
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

export async function reactMessage(input: ReactMessageInput): Promise<ReactMessageResult> {
  const trimmedEmoji = input.emoji?.trim();
  if (!input.userId || !input.messageId || !trimmedEmoji) {
    throw new ReactMessageError(
      "MISSING_INPUT",
      "User ID, Message ID, and Emoji are required.",
      400,
    );
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new ReactMessageError("INVALID_EMOJI", "Reaction must be a single valid emoji.", 400);
  }

  const reactionId = v7();

  try {
    return await withDb(async (client) => {
      const authCheckResult = await client<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE m.id = ${input.messageId}
            AND (
              (c.user_low = ${input.userId} AND (c.user_low_cleared_at IS NULL OR m.created_at >= c.user_low_cleared_at))
              OR
              (c.user_high = ${input.userId} AND (c.user_high_cleared_at IS NULL OR m.created_at >= c.user_high_cleared_at))
            )
        ) AS exists
      `;

      if (!authCheckResult[0]!.exists) {
        throw new ReactMessageError(
          "UNAUTHORIZED_OR_NOT_FOUND",
          "Message not found, deleted, or you are not authorized to react to it.",
          404,
        );
      }

      const result = await client<{ id: string; created_at: Date }[]>`
        INSERT INTO message_reactions (id, message_id, user_id, emoji)
        VALUES (${reactionId}, ${input.messageId}, ${input.userId}, ${trimmedEmoji})
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET emoji = EXCLUDED.emoji
        RETURNING id, created_at
      `;

      return {
        id: result[0]!.id,
        messageId: input.messageId,
        userId: input.userId,
        emoji: trimmedEmoji,
        createdAt: result[0]!.created_at,
      };
    });
  } catch (error: any) {
    if (error instanceof ReactMessageError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new ReactMessageError("UNAUTHORIZED_OR_NOT_FOUND", "Invalid message ID format.", 404);
    }

    throw new ReactMessageError("INTERNAL_ERROR", "Internal server error adding reaction.", 500);
  }
}
