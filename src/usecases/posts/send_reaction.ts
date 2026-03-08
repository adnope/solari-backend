import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { newUUIDv7 } from "../../utils/uuid.ts";

export type SendReactionInput = {
  userId: string;
  postId: string;
  emoji: string;
  note?: string;
};

export type SendReactionResult = {
  id: string;
  postId: string;
  userId: string;
  emoji: string;
  note: string | null;
  createdAt: Date;
};

export type SendReactionErrorType =
  | "MISSING_INPUT"
  | "INVALID_NOTE"
  | "UNAUTHORIZED"
  | "POST_NOT_FOUND"
  | "INTERNAL_ERROR"
  | "INVALID_EMOJI";

export class SendReactionError extends Error {
  readonly type: SendReactionErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: SendReactionErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "SendReactionError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export function isSingleEmoji(input: string): boolean {
  const emojiRegex = /^\p{RGI_Emoji}$/v;

  return emojiRegex.test(input);
}

export async function sendReaction(
  input: SendReactionInput,
): Promise<SendReactionResult> {
  const trimmedEmoji = input.emoji.trim();
  const trimmedNote = input.note?.trim();

  if (!input.userId || !input.postId || !trimmedEmoji) {
    throw new SendReactionError(
      "MISSING_INPUT",
      "User ID, Post ID, and Emoji are required.",
      400,
    );
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new SendReactionError(
      "INVALID_EMOJI",
      "Reaction must be a single valid emoji.",
      400,
    );
  }

  if (trimmedNote && trimmedNote.length > 20) {
    throw new SendReactionError(
      "INVALID_NOTE",
      "Note must be 20 characters or fewer.",
      400,
    );
  }

  const reactionId = newUUIDv7();

  try {
    return await withDb(async (client) => {
      const authCheckResult = await client.queryObject<{ exists: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1 FROM posts p
          JOIN post_visibility pv ON pv.post_id = p.id
          WHERE p.id = $1 AND pv.viewer_id = $2 AND p.author_id != $2
        ) AS exists
        `,
        [input.postId, input.userId],
      );

      if (!authCheckResult.rows[0].exists) {
        throw new SendReactionError(
          "UNAUTHORIZED",
          "You are not authorized to react to this post, or it is your own post.",
          403,
        );
      }

      const result = await client.queryObject<{ created_at: Date }>(
        `
        INSERT INTO post_reactions (id, post_id, user_id, emoji, note)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING created_at
        `,
        [reactionId, input.postId, input.userId, trimmedEmoji, trimmedNote || null],
      );

      return {
        id: reactionId,
        postId: input.postId,
        userId: input.userId,
        emoji: trimmedEmoji,
        note: trimmedNote || null,
        createdAt: result.rows[0].created_at,
      };
    });
  } catch (error) {
    if (error instanceof SendReactionError) throw error;

    if (isPgError(error) && error.fields.code === "22P02") {
      throw new SendReactionError("POST_NOT_FOUND", "Post not found.", 404);
    }

    throw new SendReactionError(
      "INTERNAL_ERROR",
      "Internal server error sending reaction.",
      500,
    );
  }
}
