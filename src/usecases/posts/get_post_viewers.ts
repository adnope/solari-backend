import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

export type PostViewerUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
  viewedAt: Date;
};

export type GetPostViewersResult = {
  items: PostViewerUser[];
  nextCursor: string | null;
};

export type GetPostViewersErrorType =
  | "MISSING_INPUT"
  | "INVALID_CURSOR"
  | "UNAUTHORIZED"
  | "POST_NOT_FOUND"
  | "INTERNAL_ERROR";

export class GetPostViewersError extends Error {
  readonly type: GetPostViewersErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: GetPostViewersErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "GetPostViewersError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

type ViewerRow = {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
  viewed_at: Date;
};

export async function getPostViewers(
  authorId: string,
  postId: string,
  limit = 50,
  cursor?: string,
): Promise<GetPostViewersResult> {
  if (!authorId || !postId) {
    throw new GetPostViewersError(
      "MISSING_INPUT",
      "Author ID and Post ID are required.",
      400,
    );
  }

  let parsedCursor: Date | null = null;
  if (cursor) {
    parsedCursor = new Date(cursor);
    if (isNaN(parsedCursor.getTime())) {
      throw new GetPostViewersError(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }
  }

  const normalizedLimit = Math.min(Math.max(1, limit), 50);

  try {
    return await withDb(async (client) => {
      const authCheckResult = await client.queryObject<{ exists: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1 FROM posts
          WHERE id = $1 AND author_id = $2
        ) AS exists
        `,
        [postId, authorId],
      );

      if (!authCheckResult.rows[0].exists) {
        throw new GetPostViewersError(
          "UNAUTHORIZED",
          "You are not authorized to view this post's viewers (only the author can), or it does not exist.",
          403,
        );
      }

      const result = await client.queryObject<ViewerRow>(
        `
        SELECT
          pv.viewed_at,
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_key
        FROM post_views pv
        JOIN users u ON u.id = pv.user_id
        WHERE pv.post_id = $1
          AND ($2::timestamptz IS NULL OR pv.viewed_at < $2)
        ORDER BY pv.viewed_at DESC
        LIMIT $3
        `,
        [postId, parsedCursor, normalizedLimit],
      );

      const items: PostViewerUser[] = result.rows.map((row) => ({
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarKey: row.avatar_key,
        viewedAt: row.viewed_at,
      }));

      const nextCursor = items.length > 0 ? items[items.length - 1].viewedAt.toISOString() : null;

      return {
        items,
        nextCursor,
      };
    });
  } catch (error) {
    if (error instanceof GetPostViewersError) throw error;

    if (isPgError(error) && error.fields.code === "22P02") {
      throw new GetPostViewersError("POST_NOT_FOUND", "Post not found.", 404);
    }

    throw new GetPostViewersError("INTERNAL_ERROR", "Internal server error fetching viewers.", 500);
  }
}
