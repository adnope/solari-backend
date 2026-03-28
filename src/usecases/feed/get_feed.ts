import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { postMedia, postVisibility, posts, users } from "../../db/schema.ts";
import { getFileUrl } from "../../storage/s3.ts";

export type FeedAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
};

export type FeedMedia = {
  url: string;
  thumbnailUrl: string;
  mediaType: string;
  width: number;
  height: number;
  durationMs: number | null;
};

export type FeedPost = {
  id: string;
  caption: string | null;
  createdAt: string;
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
  readonly statusCode: number;

  constructor(type: GetFeedErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "GetFeedError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function normalizeViewerId(viewerId: string): string {
  const value = viewerId.trim();
  if (!value) {
    throw new GetFeedError("INVALID_FILTER", "Viewer ID is required.", 400);
  }
  if (!isValidUuid(value)) {
    throw new GetFeedError("INVALID_FILTER", "Invalid viewer ID.", 400);
  }
  return value;
}

function normalizeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;

  const parsed = new Date(cursor);
  if (Number.isNaN(parsed.getTime())) {
    throw new GetFeedError("INVALID_CURSOR", "Cursor must be a valid ISO date string.", 400);
  }

  return parsed.toISOString();
}

function normalizeAuthorIds(authorIds?: string[]): string[] | undefined {
  if (!authorIds || authorIds.length === 0) return undefined;

  const normalized = [...new Set(authorIds.map((id) => id.trim()).filter((id) => id.length > 0))];

  if (normalized.length === 0) return undefined;

  if (!normalized.every(isValidUuid)) {
    throw new GetFeedError("INVALID_AUTHORS", "Invalid author UUIDs.", 400);
  }

  return normalized;
}

export async function getFeed(
  viewerId: string,
  limit = 20,
  cursor?: string,
  authorIds?: string[],
): Promise<GetFeedResult> {
  const normalizedViewerId = normalizeViewerId(viewerId);
  const normalizedCursor = normalizeCursor(cursor);
  const normalizedAuthorIds = normalizeAuthorIds(authorIds);
  const normalizedLimit = Math.min(Math.max(1, limit), 50);

  try {
    if (normalizedAuthorIds) {
      const existingAuthors = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, normalizedAuthorIds));

      if (existingAuthors.length !== normalizedAuthorIds.length) {
        throw new GetFeedError("INVALID_AUTHORS", "One or more author IDs do not exist.", 404);
      }
    }

    const rows = await db
      .select({
        id: posts.id,
        createdAt: posts.createdAt,
        caption: posts.caption,
        authorId: users.id,
        authorUsername: users.username,
        authorDisplayName: users.displayName,
        authorAvatarKey: users.avatarKey,
        mediaType: postMedia.mediaType,
        objectKey: postMedia.objectKey,
        thumbnailKey: postMedia.thumbnailKey,
        width: postMedia.width,
        height: postMedia.height,
        durationMs: postMedia.durationMs,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .innerJoin(postMedia, eq(postMedia.postId, posts.id))
      .where(
        and(
          or(
            eq(posts.authorId, normalizedViewerId),
            sql`exists (
              select 1
              from ${postVisibility} pv
              where pv.post_id = ${posts.id}
                and pv.viewer_id = ${normalizedViewerId}
            )`,
          ),
          normalizedAuthorIds ? inArray(posts.authorId, normalizedAuthorIds) : undefined,
          normalizedCursor ? lt(posts.createdAt, normalizedCursor) : undefined,
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(normalizedLimit);

    const items: FeedPost[] = await Promise.all(
      rows.map(async (row) => {
        const [url, thumbnailUrl] = await Promise.all([
          getFileUrl(row.objectKey),
          row.thumbnailKey ? getFileUrl(row.thumbnailKey) : Promise.resolve<string | null>(null),
        ]);

        return {
          id: row.id,
          caption: row.caption,
          createdAt: row.createdAt,
          author: {
            id: row.authorId,
            username: row.authorUsername,
            displayName: row.authorDisplayName,
            avatarKey: row.authorAvatarKey,
          },
          media: {
            url,
            thumbnailUrl: thumbnailUrl ?? url,
            mediaType: row.mediaType,
            width: row.width,
            height: row.height,
            durationMs: row.durationMs,
          },
        };
      }),
    );

    return {
      items,
      nextCursor: items.length > 0 ? items[items.length - 1]!.createdAt : null,
    };
  } catch (error) {
    if (error instanceof GetFeedError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Get feed\n${error}`)
    throw new GetFeedError("INTERNAL_ERROR", "Internal server error fetching feed.", 500);
  }
}
