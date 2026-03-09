import type { ContentfulStatusCode } from "hono/utils/http-status";
import { v7 } from "uuid";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

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

  constructor(type: SendReactionErrorType, message: string, statusCode: ContentfulStatusCode) {
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

export async function sendReaction(input: SendReactionInput): Promise<SendReactionResult> {
  const trimmedEmoji = input.emoji.trim();
  const trimmedNote = input.note?.trim();

  if (!input.userId || !input.postId || !trimmedEmoji) {
    throw new SendReactionError("MISSING_INPUT", "User ID, Post ID, and Emoji are required.", 400);
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new SendReactionError("INVALID_EMOJI", "Reaction must be a single valid emoji.", 400);
  }

  if (trimmedNote && trimmedNote.length > 20) {
    throw new SendReactionError("INVALID_NOTE", "Note must be 20 characters or fewer.", 400);
  }

  const reactionId = v7();

  try {
    return await withDb(async (client) => {
      const authCheckResult = await client<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM posts p
          JOIN post_visibility pv ON pv.post_id = p.id
          WHERE p.id = ${input.postId} AND pv.viewer_id = ${input.userId} AND p.author_id != ${input.userId}
        ) AS exists
      `;

      if (!authCheckResult[0]!.exists) {
        throw new SendReactionError(
          "UNAUTHORIZED",
          "You are not authorized to react to this post, or it is your own post.",
          403,
        );
      }

      const result = await client<{ created_at: Date }[]>`
        INSERT INTO post_reactions (id, post_id, user_id, emoji, note)
        VALUES (${reactionId}, ${input.postId}, ${input.userId}, ${trimmedEmoji}, ${trimmedNote || null})
        RETURNING created_at
      `;

      return {
        id: reactionId,
        postId: input.postId,
        userId: input.userId,
        emoji: trimmedEmoji,
        note: trimmedNote || null,
        createdAt: result[0]!.created_at,
      };
    });
  } catch (error: any) {
    if (error instanceof SendReactionError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new SendReactionError("POST_NOT_FOUND", "Post not found.", 404);
    }

    throw new SendReactionError("INTERNAL_ERROR", "Internal server error sending reaction.", 500);
  }
}
