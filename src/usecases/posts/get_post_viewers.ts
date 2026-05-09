import { isValidUuid } from "../../utils/validation.ts";
import { and, desc, eq, lt, notExists, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { blockedUsers, postViews, posts } from "../../db/schema.ts";
import { getAvatarUrlMapByUserId } from "../avatar_urls.ts";
import { getNicknameMap, getUserSummariesByIds } from "../common_queries.ts";
import { AppError } from "../app_error.ts";

export type PostViewerUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  viewedAt: string;
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

export async function getPostViewers(
  authorId: string,
  postId: string,
  limit = 20,
  cursor?: string,
): Promise<GetPostViewersResult> {
  const normalizedAuthorId = authorId.trim();
  const normalizedPostId = postId.trim();

  if (!normalizedAuthorId || !normalizedPostId) {
    throw new AppError<GetPostViewersErrorType>(
      "MISSING_INPUT",
      "Author ID and Post ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedAuthorId) || !isValidUuid(normalizedPostId)) {
    throw new AppError<GetPostViewersErrorType>("POST_NOT_FOUND", "Post not found.", 404);
  }

  let parsedCursor: string | undefined;
  if (cursor) {
    const parsed = new Date(cursor);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError<GetPostViewersErrorType>(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }
    parsedCursor = parsed.toISOString();
  }

  const normalizedLimit = Math.min(Math.max(1, limit), 50);

  try {
    const [authorizedPost] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, normalizedPostId), eq(posts.authorId, normalizedAuthorId)))
      .limit(1);

    if (!authorizedPost) {
      throw new AppError<GetPostViewersErrorType>(
        "UNAUTHORIZED",
        "You are not authorized to view this post's viewers (only the author can), or it does not exist.",
        403,
      );
    }

    const rows = await db
      .select({
        userId: postViews.userId,
        viewedAt: postViews.viewedAt,
      })
      .from(postViews)
      .where(
        and(
          eq(postViews.postId, normalizedPostId),
          notExists(
            db
              .select({ blockerId: blockedUsers.blockerId })
              .from(blockedUsers)
              .where(
                or(
                  and(
                    eq(blockedUsers.blockerId, postViews.userId),
                    eq(blockedUsers.blockedId, normalizedAuthorId),
                  ),
                  and(
                    eq(blockedUsers.blockerId, normalizedAuthorId),
                    eq(blockedUsers.blockedId, postViews.userId),
                  ),
                ),
              ),
          ),
          parsedCursor ? lt(postViews.viewedAt, parsedCursor) : undefined,
        ),
      )
      .orderBy(desc(postViews.viewedAt))
      .limit(normalizedLimit);

    const viewerIds = rows.map((row) => row.userId);

    const [userMap, nicknames] = await Promise.all([
      getUserSummariesByIds(viewerIds),
      getNicknameMap(normalizedAuthorId, viewerIds),
    ]);
    const avatarUrlMap = await getAvatarUrlMapByUserId(userMap.values());

    const items: PostViewerUser[] = rows.map((row) => {
      const user = userMap.get(row.userId);

      if (!user) {
        throw new AppError<GetPostViewersErrorType>(
          "INTERNAL_ERROR",
          "Internal server error.",
          500,
        );
      }

      return {
        id: user.id,
        username: user.username,
        displayName: nicknames.get(row.userId) ?? user.displayName ?? user.username,
        avatarUrl: avatarUrlMap.get(user.id) ?? null,
        viewedAt: row.viewedAt,
      };
    });

    return {
      items,
      nextCursor: items.length > 0 ? items[items.length - 1]!.viewedAt : null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(`[ERROR] Unexpected error in use case: Get post viewers\n${error}`);
    throw new AppError<GetPostViewersErrorType>(
      "INTERNAL_ERROR",
      "Internal server error fetching viewers.",
      500,
    );
  }
}
