import { isValidUuid } from "../../utils/uuid.ts";
import { and, desc, eq, lt, notExists, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { blockedUsers, postReactions, posts } from "../../db/schema.ts";
import { getAvatarUrlMapByUserId } from "../avatar_urls.ts";
import { getNicknameMap, getUserSummariesByIds } from "../common_queries.ts";

export type ReactionUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type PostReaction = {
  id: string;
  emoji: string;
  note: string | null;
  createdAt: string;
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
  readonly statusCode: number;

  constructor(type: ViewPostReactionsErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ViewPostReactionsError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function viewPostReactions(
  viewerId: string,
  postId: string,
  limit = 20,
  cursor?: string,
): Promise<ViewPostReactionsResult> {
  const normalizedViewerId = viewerId.trim();
  const normalizedPostId = postId.trim();

  if (!normalizedViewerId || !normalizedPostId) {
    throw new ViewPostReactionsError("MISSING_INPUT", "Viewer ID and Post ID are required.", 400);
  }

  if (!isValidUuid(normalizedViewerId) || !isValidUuid(normalizedPostId)) {
    throw new ViewPostReactionsError("POST_NOT_FOUND", "Post not found.", 404);
  }

  let parsedCursor: string | undefined;
  if (cursor) {
    const parsed = new Date(cursor);
    if (Number.isNaN(parsed.getTime())) {
      throw new ViewPostReactionsError(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }
    parsedCursor = parsed.toISOString();
  }

  const normalizedLimit = Math.min(Math.max(1, limit), 100);

  try {
    const [authorizedPost] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, normalizedPostId), eq(posts.authorId, normalizedViewerId)))
      .limit(1);

    if (!authorizedPost) {
      throw new ViewPostReactionsError(
        "UNAUTHORIZED",
        "You are not authorized to view reactions for this post, or it does not exist.",
        403,
      );
    }

    const rows = await db
      .select({
        id: postReactions.id,
        emoji: postReactions.emoji,
        note: postReactions.note,
        createdAt: postReactions.createdAt,
        userId: postReactions.userId,
      })
      .from(postReactions)
      .where(
        and(
          eq(postReactions.postId, normalizedPostId),
          notExists(
            db
              .select({ blockerId: blockedUsers.blockerId })
              .from(blockedUsers)
              .where(
                or(
                  and(
                    eq(blockedUsers.blockerId, postReactions.userId),
                    eq(blockedUsers.blockedId, normalizedViewerId),
                  ),
                  and(
                    eq(blockedUsers.blockerId, normalizedViewerId),
                    eq(blockedUsers.blockedId, postReactions.userId),
                  ),
                ),
              ),
          ),
          parsedCursor ? lt(postReactions.createdAt, parsedCursor) : undefined,
        ),
      )
      .orderBy(desc(postReactions.createdAt))
      .limit(normalizedLimit);

    const reactorIds = rows.map((r) => r.userId);
    const [userMap, nicknames] = await Promise.all([
      getUserSummariesByIds(reactorIds),
      getNicknameMap(normalizedViewerId, reactorIds),
    ]);
    const avatarUrlMap = await getAvatarUrlMapByUserId(userMap.values());

    const items: PostReaction[] = rows.map((row) => {
      const user = userMap.get(row.userId);

      if (!user) {
        throw new ViewPostReactionsError("INTERNAL_ERROR", "Internal server error.", 500);
      }

      return {
        id: row.id,
        emoji: row.emoji,
        note: row.note,
        createdAt: row.createdAt,
        user: {
          id: user.id,
          username: user.username,
          displayName: nicknames.get(row.userId) ?? user.displayName,
          avatarUrl: avatarUrlMap.get(user.id) ?? null,
        },
      };
    });

    return {
      items,
      nextCursor: items.length > 0 ? items[items.length - 1]!.createdAt : null,
    };
  } catch (error) {
    if (error instanceof ViewPostReactionsError) throw error;
    console.error(`[ERROR] Unexpected error in use case: View post reactions\n${error}`);
    throw new ViewPostReactionsError(
      "INTERNAL_ERROR",
      "Internal server error fetching reactions.",
      500,
    );
  }
}
