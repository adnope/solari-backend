import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { postReactions, posts, users } from "../../db/migrations/schema.ts";

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function viewPostReactions(
  viewerId: string,
  postId: string,
  limit = 100,
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

  const normalizedLimit = Math.min(Math.max(1, limit), 50);

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
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
      })
      .from(postReactions)
      .innerJoin(users, eq(users.id, postReactions.userId))
      .where(
        and(
          eq(postReactions.postId, normalizedPostId),
          parsedCursor ? lt(postReactions.createdAt, parsedCursor) : undefined,
        ),
      )
      .orderBy(desc(postReactions.createdAt))
      .limit(normalizedLimit);

    const items: PostReaction[] = rows.map((row) => ({
      id: row.id,
      emoji: row.emoji,
      note: row.note,
      createdAt: row.createdAt,
      user: {
        id: row.userId,
        username: row.username,
        displayName: row.displayName,
        avatarKey: row.avatarKey,
      },
    }));

    return {
      items,
      nextCursor: items.length > 0 ? items[items.length - 1]!.createdAt : null,
    };
  } catch (error) {
    if (error instanceof ViewPostReactionsError) throw error;

    throw new ViewPostReactionsError(
      "INTERNAL_ERROR",
      "Internal server error fetching reactions.",
      500,
    );
  }
}
