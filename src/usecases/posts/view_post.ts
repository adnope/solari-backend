import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { postVisibility, postViews, posts } from "../../db/schema.ts";
import { hasBlockingRelationship } from "../common_queries.ts";

export type ViewPostErrorType =
  | "MISSING_INPUT"
  | "UNAUTHORIZED"
  | "POST_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ViewPostError extends Error {
  readonly type: ViewPostErrorType;
  readonly statusCode: number;

  constructor(type: ViewPostErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ViewPostError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function viewPost(viewerId: string, postId: string): Promise<void> {
  const normalizedViewerId = viewerId.trim();
  const normalizedPostId = postId.trim();

  if (!normalizedViewerId || !normalizedPostId) {
    throw new ViewPostError("MISSING_INPUT", "Viewer ID and Post ID are required.", 400);
  }

  if (!isValidUuid(normalizedViewerId) || !isValidUuid(normalizedPostId)) {
    throw new ViewPostError("POST_NOT_FOUND", "Post not found.", 404);
  }

  try {
    const [post] = await db
      .select({
        authorId: posts.authorId,
      })
      .from(posts)
      .where(eq(posts.id, normalizedPostId))
      .limit(1);

    if (!post) {
      throw new ViewPostError("POST_NOT_FOUND", "Post not found.", 404);
    }

    if (post.authorId === normalizedViewerId) {
      return;
    }

    const isBlocked = await hasBlockingRelationship(normalizedViewerId, post.authorId);
    if (isBlocked) {
      throw new ViewPostError("POST_NOT_FOUND", "Post not found.", 404);
    }

    const [visible] = await db
      .select({ viewerId: postVisibility.viewerId })
      .from(postVisibility)
      .where(
        and(
          eq(postVisibility.postId, normalizedPostId),
          eq(postVisibility.viewerId, normalizedViewerId),
        ),
      )
      .limit(1);

    if (!visible) {
      throw new ViewPostError("UNAUTHORIZED", "You are not authorized to view this post.", 403);
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
    if (error instanceof ViewPostError) throw error;
    console.error(`[ERROR] Unexpected error in use case: View post\n${error}`);
    throw new ViewPostError("INTERNAL_ERROR", "Internal server error recording post view.", 500);
  }
}
