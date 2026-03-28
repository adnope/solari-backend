import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { postViews, posts, users } from "../../db/schema.ts";

export type PostViewerUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
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

export class GetPostViewersError extends Error {
  readonly type: GetPostViewersErrorType;
  readonly statusCode: number;

  constructor(type: GetPostViewersErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "GetPostViewersError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function getPostViewers(
  authorId: string,
  postId: string,
  limit = 50,
  cursor?: string,
): Promise<GetPostViewersResult> {
  const normalizedAuthorId = authorId.trim();
  const normalizedPostId = postId.trim();

  if (!normalizedAuthorId || !normalizedPostId) {
    throw new GetPostViewersError("MISSING_INPUT", "Author ID and Post ID are required.", 400);
  }

  if (!isValidUuid(normalizedAuthorId) || !isValidUuid(normalizedPostId)) {
    throw new GetPostViewersError("POST_NOT_FOUND", "Post not found.", 404);
  }

  let parsedCursor: string | undefined;
  if (cursor) {
    const parsed = new Date(cursor);
    if (Number.isNaN(parsed.getTime())) {
      throw new GetPostViewersError(
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
      throw new GetPostViewersError(
        "UNAUTHORIZED",
        "You are not authorized to view this post's viewers (only the author can), or it does not exist.",
        403,
      );
    }

    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
        viewedAt: postViews.viewedAt,
      })
      .from(postViews)
      .innerJoin(users, eq(users.id, postViews.userId))
      .where(
        and(
          eq(postViews.postId, normalizedPostId),
          parsedCursor ? lt(postViews.viewedAt, parsedCursor) : undefined,
        ),
      )
      .orderBy(desc(postViews.viewedAt))
      .limit(normalizedLimit);

    const items: PostViewerUser[] = rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatarKey: row.avatarKey,
      viewedAt: row.viewedAt,
    }));

    return {
      items,
      nextCursor: items.length > 0 ? items[items.length - 1]!.viewedAt : null,
    };
  } catch (error) {
    if (error instanceof GetPostViewersError) throw error;

    throw new GetPostViewersError("INTERNAL_ERROR", "Internal server error fetching viewers.", 500);
  }
}
