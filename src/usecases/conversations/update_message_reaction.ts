import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { isSingleEmoji } from "./react_message.ts";

export type UpdateMessageReactionInput = {
  userId: string;
  messageId: string;
  emoji: string;
};

export type UpdateMessageReactionResult = {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: Date;
};

export type UpdateMessageReactionErrorType =
  | "MISSING_INPUT"
  | "INVALID_EMOJI"
  | "REACTION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class UpdateMessageReactionError extends Error {
  readonly type: UpdateMessageReactionErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: UpdateMessageReactionErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "UpdateMessageReactionError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function updateMessageReaction(
  input: UpdateMessageReactionInput,
): Promise<UpdateMessageReactionResult> {
  const trimmedEmoji = input.emoji?.trim();

  if (!input.userId || !input.messageId || !trimmedEmoji) {
    throw new UpdateMessageReactionError(
      "MISSING_INPUT",
      "User ID, Message ID, and Emoji are required.",
      400,
    );
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new UpdateMessageReactionError(
      "INVALID_EMOJI",
      "Reaction must be a single valid emoji.",
      400,
    );
  }

  try {
    return await withDb(async (client) => {
      // Transitioned to Deno's native queryObject and .rows accessor
      const result = await client.queryObject<{ id: string; created_at: Date }>`
        UPDATE message_reactions
        SET emoji = ${trimmedEmoji}
        WHERE message_id = ${input.messageId} AND user_id = ${input.userId}
        RETURNING id, created_at
      `;

      if (result.rows.length === 0) {
        throw new UpdateMessageReactionError(
          "REACTION_NOT_FOUND",
          "Reaction not found. You must react to the message first.",
          404,
        );
      }

      const row = result.rows[0];

      return {
        id: row.id,
        messageId: input.messageId,
        userId: input.userId,
        emoji: trimmedEmoji,
        createdAt: row.created_at,
      };
    });
  } catch (error) {
    if (error instanceof UpdateMessageReactionError) throw error;

    // Standardized error handling without explicit 'any'
    if (isPgError(error) && error.code === "22P02") {
      throw new UpdateMessageReactionError("REACTION_NOT_FOUND", "Invalid message ID format.", 404);
    }

    throw new UpdateMessageReactionError(
      "INTERNAL_ERROR",
      "Internal server error updating reaction.",
      500,
    );
  }
}
