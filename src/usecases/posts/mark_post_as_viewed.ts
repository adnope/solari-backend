import { db } from "../../db/client.ts";
import { postViews } from "../../db/schema.ts";
import { isValidUuid } from "../../utils/uuid.ts";
import { getPostAccessContext } from "../../db/queries/get_post_access_context.ts";
import { hasBlockingRelationship } from "../common_queries.ts";

export type MarkPostAsViewedErrorType =
  | "MISSING_INPUT"
  | "UNAUTHORIZED"
  | "POST_NOT_FOUND"
  | "INTERNAL_ERROR";

export class MarkPostAsViewedError extends Error {
  readonly type: MarkPostAsViewedErrorType;
  readonly statusCode: number;

  constructor(type: MarkPostAsViewedErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "MarkPostAsViewedError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function markPostAsViewed(viewerId: string, postId: string): Promise<void> {
  const normalizedViewerId = viewerId.trim();
  const normalizedPostId = postId.trim();

  if (!normalizedViewerId || !normalizedPostId) {
    throw new MarkPostAsViewedError("MISSING_INPUT", "Viewer ID and Post ID are required.", 400);
  }

  if (!isValidUuid(normalizedViewerId) || !isValidUuid(normalizedPostId)) {
    throw new MarkPostAsViewedError("POST_NOT_FOUND", "Post not found.", 404);
  }

  try {
    const post = await getPostAccessContext(normalizedViewerId, normalizedPostId, db, false);

    if (!post) {
      throw new MarkPostAsViewedError("POST_NOT_FOUND", "Post not found.", 404);
    }

    if (post.authorId === normalizedViewerId) {
      return;
    }

    const isBlocked = await hasBlockingRelationship(normalizedViewerId, post.authorId);
    if (isBlocked) {
      throw new MarkPostAsViewedError("POST_NOT_FOUND", "Post not found.", 404);
    }

    if (!post.isVisible) {
      throw new MarkPostAsViewedError(
        "UNAUTHORIZED",
        "You are not authorized to view this post.",
        403,
      );
    }

    await db
      .insert(postViews)
      .values({
        postId: normalizedPostId,
        userId: normalizedViewerId,
      })
      .onConflictDoNothing({
        target: [postViews.postId, postViews.userId],
      });
  } catch (error) {
    if (error instanceof MarkPostAsViewedError) throw error;
    console.error(`[ERROR] Unexpected error in use case: Mark post as viewed\n${error}`);
    throw new MarkPostAsViewedError(
      "INTERNAL_ERROR",
      "Internal server error recording post view.",
      500,
    );
  }
}
