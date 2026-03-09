import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

export type DeleteReactionErrorType = "MISSING_INPUT" | "REACTION_NOT_FOUND" | "INTERNAL_ERROR";

export class DeleteReactionError extends Error {
  readonly type: DeleteReactionErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: DeleteReactionErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "DeleteReactionError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function deleteReaction(
  userId: string,
  postId: string,
  reactionId: string,
): Promise<void> {
  if (!userId || !postId || !reactionId) {
    throw new DeleteReactionError(
      "MISSING_INPUT",
      "User ID, Post ID, and Reaction ID are required.",
      400,
    );
  }

  try {
    await withDb(async (client) => {
      const result = await client<{ id: string }[]>`
        DELETE FROM post_reactions
        WHERE id = ${reactionId} AND post_id = ${postId} AND user_id = ${userId}
        RETURNING id
      `;

      if (result.length === 0) {
        throw new DeleteReactionError(
          "REACTION_NOT_FOUND",
          "Reaction not found or you do not have permission to delete it.",
          404,
        );
      }
    });
  } catch (error: any) {
    if (error instanceof DeleteReactionError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new DeleteReactionError(
        "REACTION_NOT_FOUND",
        "Reaction not found or invalid ID format.",
        404,
      );
    }

    throw new DeleteReactionError(
      "INTERNAL_ERROR",
      "Internal server error deleting reaction.",
      500,
    );
  }
}
