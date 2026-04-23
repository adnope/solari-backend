import { isValidUuid } from "../../utils/uuid.ts";
import { and, desc, eq, inArray, lt, notExists, or, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { blockedUsers, postVisibility, posts } from "../../db/schema.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { getAvatarUrlMapByUserId } from "../avatar_urls.ts";
import { getNicknameMap, getUserSummariesByIds } from "../common_queries.ts";
import { getPostDetailsByIds } from "../post_details.ts";

export type FeedAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
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
  limit = 30,
  cursor?: string,
  authorIds?: string[],
): Promise<GetFeedResult> {
  const normalizedViewerId = normalizeViewerId(viewerId);
  const normalizedCursor = normalizeCursor(cursor);
  const normalizedAuthorIds = normalizeAuthorIds(authorIds);
  const normalizedLimit = Math.min(Math.max(1, limit), 100);

  try {
    if (normalizedAuthorIds) {
      const existingAuthors = await getUserSummariesByIds(normalizedAuthorIds);

      if (existingAuthors.size !== normalizedAuthorIds.length) {
        throw new GetFeedError("INVALID_AUTHORS", "One or more author IDs do not exist.", 404);
      }
    }

    const candidateRows = await db
      .select({
        id: posts.id,
      })
      .from(posts)
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

          notExists(
            db
              .select({ blockerId: blockedUsers.blockerId })
              .from(blockedUsers)
              .where(
                or(
                  and(
                    eq(blockedUsers.blockerId, posts.authorId),
                    eq(blockedUsers.blockedId, normalizedViewerId),
                  ),
                  and(
                    eq(blockedUsers.blockerId, normalizedViewerId),
                    eq(blockedUsers.blockedId, posts.authorId),
                  ),
                ),
              ),
          ),

          normalizedAuthorIds ? inArray(posts.authorId, normalizedAuthorIds) : undefined,
          normalizedCursor ? lt(posts.createdAt, normalizedCursor) : undefined,
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(normalizedLimit);

    const postIds = candidateRows.map((row) => row.id);
    const postDetailMap = await getPostDetailsByIds(postIds);
    const orderedPostDetails = postIds.flatMap((postId) => {
      const detail = postDetailMap.get(postId);
      return detail ? [detail] : [];
    });

    if (orderedPostDetails.length !== postIds.length) {
      console.warn(
        `[WARN] Missing post details while building feed for viewer '${normalizedViewerId}'.`,
      );
    }

    const authorIdsFromResult = orderedPostDetails.map((detail) => detail.authorId);

    const [authorMap, nicknames] = await Promise.all([
      getUserSummariesByIds(authorIdsFromResult),
      getNicknameMap(normalizedViewerId, authorIdsFromResult),
    ]);
    const avatarUrlMap = await getAvatarUrlMapByUserId(authorMap.values());

    const items: FeedPost[] = await Promise.all(
      orderedPostDetails.map(async (detail) => {
        const author = authorMap.get(detail.authorId);

        if (!author) {
          throw new GetFeedError("INTERNAL_ERROR", "Internal server error fetching feed.", 500);
        }

        const [url, thumbnailUrl] = await Promise.all([
          getFileUrl(detail.objectKey),
          detail.thumbnailKey
            ? getFileUrl(detail.thumbnailKey)
            : Promise.resolve<string | null>(null),
        ]);

        return {
          id: detail.id,
          caption: detail.caption,
          createdAt: detail.createdAt,
          author: {
            id: author.id,
            username: author.username,
            displayName: nicknames.get(detail.authorId) ?? author.displayName,
            avatarUrl: avatarUrlMap.get(author.id) ?? null,
          },
          media: {
            url,
            thumbnailUrl: thumbnailUrl ?? url,
            mediaType: detail.mediaType,
            width: detail.width,
            height: detail.height,
            durationMs: detail.durationMs,
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

    console.error(`[ERROR] Unexpected error in use case: Get feed\n${error}`);
    throw new GetFeedError("INTERNAL_ERROR", "Internal server error fetching feed.", 500);
  }
}
