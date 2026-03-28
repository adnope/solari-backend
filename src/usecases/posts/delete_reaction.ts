import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { postReactions } from "../../db/schema.ts";

export type DeleteReactionErrorType = "MISSING_INPUT" | "REACTION_NOT_FOUND" | "INTERNAL_ERROR";

export class DeleteReactionError extends Error {
  readonly type: DeleteReactionErrorType;
  readonly statusCode: number;

  constructor(type: DeleteReactionErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "DeleteReactionError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function deleteReaction(
  userId: string,
  postId: string,
  reactionId: string,
): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedPostId = postId.trim();
  const normalizedReactionId = reactionId.trim();

  if (!normalizedUserId || !normalizedPostId || !normalizedReactionId) {
    throw new DeleteReactionError(
      "MISSING_INPUT",
      "User ID, Post ID, and Reaction ID are required.",
      400,
    );
  }

  if (
    !isValidUuid(normalizedUserId) ||
    !isValidUuid(normalizedPostId) ||
    !isValidUuid(normalizedReactionId)
  ) {
    throw new DeleteReactionError(
      "REACTION_NOT_FOUND",
      "Reaction not found or invalid ID format.",
      404,
    );
  }

  try {
    const [deleted] = await db
      .delete(postReactions)
      .where(
        and(
          eq(postReactions.id, normalizedReactionId),
          eq(postReactions.postId, normalizedPostId),
          eq(postReactions.userId, normalizedUserId),
        ),
      )
      .returning({ id: postReactions.id });

    if (!deleted) {
      throw new DeleteReactionError(
        "REACTION_NOT_FOUND",
        "Reaction not found or you do not have permission to delete it.",
        404,
      );
    }
  } catch (error) {
    if (error instanceof DeleteReactionError) throw error;
    console.error(`[ERROR] Unexpected error in use case: Delete reaction\n${error}`)
    throw new DeleteReactionError(
      "INTERNAL_ERROR",
      "Internal server error deleting reaction.",
      500,
    );
  }
}
