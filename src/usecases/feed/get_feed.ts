import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { getFileUrl } from "../../storage/minio.ts";
import { isPgError } from "../postgres_error.ts";

export type FeedAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
};

export type FeedMedia = {
  url: string;
  mediaType: string;
  width: number;
  height: number;
  durationMs: number | null;
};

export type FeedPost = {
  id: string;
  caption: string | null;
  createdAt: Date;
  author: FeedAuthor;
  media: FeedMedia;
};

export type GetFeedResult = {
  items: FeedPost[];
  nextCursor: string | null;
};

export type GetFeedErrorType =
  | "INVALID_CURSOR"
  | "INVALID_FILTER"
  | "INVALID_AUTHORS"
  | "INTERNAL_ERROR";

export class GetFeedError extends Error {
  readonly type: GetFeedErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: GetFeedErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "GetFeedError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

type FeedRow = {
  id: string;
  created_at: Date;
  caption: string | null;
  author_id: string;
  author_username: string;
  author_display_name: string | null;
  author_avatar_key: string | null;
  media_type: string;
  object_key: string;
  width: number;
  height: number;
  duration_ms: number | null;
};

export async function getFeed(
  viewerId: string,
  limit = 20,
  cursor?: string,
  authorIds?: string[],
): Promise<GetFeedResult> {
  let parsedCursor: Date | null = null;

  if (cursor) {
    parsedCursor = new Date(cursor);
    if (isNaN(parsedCursor.getTime())) {
      throw new GetFeedError("INVALID_CURSOR", "Cursor must be a valid ISO date string.", 400);
    }
  }

  const normalizedLimit = Math.min(Math.max(1, limit), 50);

  try {
    return await withDb(async (client) => {
      const validAuthorIds = authorIds && authorIds.length > 0 ? authorIds : null;

      if (validAuthorIds) {
        const uniqueAuthorIds = [...new Set(validAuthorIds)];

        const userCheckResult = await client<{ count: bigint }[]>`
          SELECT COUNT(id) FROM users WHERE id = ANY(${uniqueAuthorIds}::uuid[])
        `;

        if (Number(userCheckResult[0]!.count) !== uniqueAuthorIds.length) {
          throw new GetFeedError("INVALID_AUTHORS", "One or more author IDs do not exist.", 404);
        }
      }

      const result = await client<FeedRow[]>`
        SELECT
          p.id,
          p.created_at,
          p.caption,
          u.id AS author_id,
          u.username AS author_username,
          u.display_name AS author_display_name,
          u.avatar_key AS author_avatar_key,
          pm.media_type,
          pm.object_key,
          pm.width,
          pm.height,
          pm.duration_ms
        FROM posts p
        JOIN users u ON u.id = p.author_id
        JOIN post_media pm ON pm.post_id = p.id
        WHERE
          (
            p.author_id = ${viewerId}
            OR
            EXISTS (
              SELECT 1 FROM post_visibility pv
              WHERE pv.post_id = p.id AND pv.viewer_id = ${viewerId}
            )
          )
          AND (${validAuthorIds}::uuid[] IS NULL OR p.author_id = ANY(${validAuthorIds}::uuid[]))
          AND (${parsedCursor}::timestamptz IS NULL OR p.created_at < ${parsedCursor})
        ORDER BY p.created_at DESC
        LIMIT ${normalizedLimit}
      `;

      const items: FeedPost[] = await Promise.all(
        result.map(async (row) => {
          const signedUrl = await getFileUrl(row.object_key);

          return {
            id: row.id,
            caption: row.caption,
            createdAt: row.created_at,
            author: {
              id: row.author_id,
              username: row.author_username,
              displayName: row.author_display_name,
              avatarKey: row.author_avatar_key,
            },
            media: {
              url: signedUrl,
              mediaType: row.media_type,
              width: row.width,
              height: row.height,
              durationMs: row.duration_ms,
            },
          };
        }),
      );

      const nextCursor = items.length > 0 ? items[items.length - 1]!.createdAt.toISOString() : null;

      return {
        items,
        nextCursor,
      };
    });
  } catch (error: any) {
    if (error instanceof GetFeedError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new GetFeedError("INVALID_AUTHORS", "One or more author IDs are invalid UUIDs.", 400);
    }

    throw new GetFeedError("INTERNAL_ERROR", "Internal server error fetching feed.", 500);
  }
}
