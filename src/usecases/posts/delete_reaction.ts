import { isValidUuid } from "../../utils/validation.ts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { postReactions } from "../../db/schema.ts";
import { AppError } from "../app_error.ts";

export type DeleteReactionErrorType = "MISSING_INPUT" | "REACTION_NOT_FOUND" | "INTERNAL_ERROR";

export async function deleteReaction(
  userId: string,
  postId: string,
  reactionId: string,
): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedPostId = postId.trim();
  const normalizedReactionId = reactionId.trim();

  if (!normalizedUserId || !normalizedPostId || !normalizedReactionId) {
    throw new AppError<DeleteReactionErrorType>(
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
    throw new AppError<DeleteReactionErrorType>(
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
      throw new AppError<DeleteReactionErrorType>(
        "REACTION_NOT_FOUND",
        "Reaction not found or you do not have permission to delete it.",
        404,
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(`[ERROR] Unexpected error in use case: Delete reaction\n${error}`);
    throw new AppError<DeleteReactionErrorType>(
      "INTERNAL_ERROR",
      "Internal server error deleting reaction.",
      500,
    );
  }
}
