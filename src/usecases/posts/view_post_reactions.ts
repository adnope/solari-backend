import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

export type ReactionUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
};

export type PostReaction = {
  id: string;
  emoji: string;
  note: string | null;
  createdAt: Date;
  user: ReactionUser;
};

export type ViewPostReactionsResult = {
  items: PostReaction[];
  nextCursor: string | null;
};

export type ViewPostReactionsErrorType =
  | "MISSING_INPUT"
  | "INVALID_CURSOR"
  | "UNAUTHORIZED"
  | "POST_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ViewPostReactionsError extends Error {
  readonly type: ViewPostReactionsErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: ViewPostReactionsErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "ViewPostReactionsError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

type ReactionRow = {
  id: string;
  emoji: string;
  note: string | null;
  created_at: Date;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
};

export async function viewPostReactions(
  viewerId: string,
  postId: string,
  limit = 100,
  cursor?: string,
): Promise<ViewPostReactionsResult> {
  if (!viewerId || !postId) {
    throw new ViewPostReactionsError("MISSING_INPUT", "Viewer ID and Post ID are required.", 400);
  }

  let parsedCursor: Date | null = null;
  if (cursor) {
    parsedCursor = new Date(cursor);
    if (isNaN(parsedCursor.getTime())) {
      throw new ViewPostReactionsError(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }
  }

  const normalizedLimit = Math.min(Math.max(1, limit), 50);

  try {
    return await withDb(async (client) => {
      const authCheckResult = await client.queryObject<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM posts
          WHERE id = ${postId} AND author_id = ${viewerId}
        ) AS exists
      `;

      if (!authCheckResult.rows[0]?.exists) {
        throw new ViewPostReactionsError(
          "UNAUTHORIZED",
          "You are not authorized to view reactions for this post, or it does not exist.",
          403,
        );
      }

      const result = await client.queryObject<ReactionRow>`
        SELECT
          pr.id, pr.emoji, pr.note, pr.created_at,
          u.id AS user_id, u.username, u.display_name, u.avatar_key
        FROM post_reactions pr
        JOIN users u ON u.id = pr.user_id
        WHERE pr.post_id = ${postId}
          AND (${parsedCursor}::timestamptz IS NULL OR pr.created_at < ${parsedCursor})
        ORDER BY pr.created_at DESC
        LIMIT ${normalizedLimit}
      `;

      const items: PostReaction[] = result.rows.map((row) => ({
        id: row.id,
        emoji: row.emoji,
        note: row.note,
        createdAt: row.created_at,
        user: {
          id: row.user_id,
          username: row.username,
          displayName: row.display_name,
          avatarKey: row.avatar_key,
        },
      }));

      return {
        items,
        nextCursor: items.length > 0 ? items[items.length - 1]!.createdAt.toISOString() : null,
      };
    });
  } catch (error) {
    if (error instanceof ViewPostReactionsError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new ViewPostReactionsError("POST_NOT_FOUND", "Post not found.", 404);
    }

    throw new ViewPostReactionsError(
      "INTERNAL_ERROR",
      "Internal server error fetching reactions.",
      500,
    );
  }
}
