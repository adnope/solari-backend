import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

export type ViewPostErrorType =
  | "MISSING_INPUT"
  | "UNAUTHORIZED"
  | "POST_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ViewPostError extends Error {
  readonly type: ViewPostErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: ViewPostErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "ViewPostError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function viewPost(viewerId: string, postId: string): Promise<void> {
  if (!viewerId || !postId) {
    throw new ViewPostError("MISSING_INPUT", "Viewer ID and Post ID are required.", 400);
  }

  try {
    await withDb(async (client) => {
      const authCheckResult = await client<{ author_id: string; is_visible: boolean }[]>`
        SELECT p.author_id, (pv.viewer_id IS NOT NULL) AS is_visible
        FROM posts p
        LEFT JOIN post_visibility pv ON pv.post_id = p.id AND pv.viewer_id = ${viewerId}
        WHERE p.id = ${postId}
      `;

      if (authCheckResult.length === 0) {
        throw new ViewPostError("POST_NOT_FOUND", "Post not found.", 404);
      }

      const post = authCheckResult[0]!;
      if (post.author_id === viewerId) {
        return;
      }

      if (!post.is_visible) {
        throw new ViewPostError("UNAUTHORIZED", "You are not authorized to view this post.", 403);
      }

      await client`
        INSERT INTO post_views (post_id, user_id)
        VALUES (${postId}, ${viewerId})
        ON CONFLICT (post_id, user_id) DO NOTHING
      `;
    });
  } catch (error: any) {
    if (error instanceof ViewPostError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new ViewPostError("POST_NOT_FOUND", "Post not found.", 404);
    }

    throw new ViewPostError("INTERNAL_ERROR", "Internal server error recording post view.", 500);
  }
}
