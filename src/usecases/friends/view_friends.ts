import { isValidUuid } from "../../utils/uuid.ts";
import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendships, users } from "../../db/schema.ts";
import { getNicknameMap } from "../common_queries.ts";

export type ViewFriendsErrorType =
  | "MISSING_USER_ID"
  | "INVALID_CURSOR"
  | "INVALID_LIMIT"
  | "INVALID_SORT"
  | "USER_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ViewFriendsError extends Error {
  readonly type: ViewFriendsErrorType;
  readonly statusCode: number;

  constructor(type: ViewFriendsErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ViewFriendsError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export type Friend = {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
  createdAt: string;
};

export type ViewFriendsResult = {
  items: Friend[];
  nextCursor: string | null;
  limit: number;
};

function normalizeLimit(limit = 20): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ViewFriendsError("INVALID_LIMIT", "Limit must be a positive integer.", 400);
  }
  return Math.min(limit, 100);
}

export async function viewFriends(
  userId: string,
  cursor?: string,
  limit = 20,
  sort: "newest" | "oldest" = "newest",
): Promise<ViewFriendsResult> {
  const normalizedUserId = userId.trim();

  try {
    if (!normalizedUserId || !isValidUuid(normalizedUserId)) {
      throw new ViewFriendsError("MISSING_USER_ID", "User id is missing or invalid.", 400);
    }

    if (sort !== "newest" && sort !== "oldest") {
      throw new ViewFriendsError("INVALID_SORT", "Sort must be 'newest' or 'oldest'.", 400);
    }

    if (cursor && Number.isNaN(Date.parse(cursor))) {
      throw new ViewFriendsError("INVALID_CURSOR", "Cursor must be a valid ISO date string.", 400);
    }

    const normalizedLimit = normalizeLimit(limit);

    const userCondition = or(
      eq(friendships.userLow, normalizedUserId),
      eq(friendships.userHigh, normalizedUserId),
    );

    let cursorCondition = undefined;
    if (cursor) {
      if (sort === "newest") {
        cursorCondition = lt(friendships.createdAt, cursor);
      } else {
        cursorCondition = gt(friendships.createdAt, cursor);
      }
    }

    const whereCondition = cursorCondition ? and(userCondition, cursorCondition) : userCondition;
    const orderCondition =
      sort === "newest" ? desc(friendships.createdAt) : asc(friendships.createdAt);

    const friendshipRows = await db
      .select({
        userLow: friendships.userLow,
        userHigh: friendships.userHigh,
        createdAt: friendships.createdAt,
      })
      .from(friendships)
      .where(whereCondition)
      .orderBy(orderCondition)
      .limit(normalizedLimit);

    if (friendshipRows.length === 0) {
      return {
        items: [],
        nextCursor: null,
        limit: normalizedLimit,
      };
    }

    const friendIds = friendshipRows.map((row) =>
      row.userLow === normalizedUserId ? row.userHigh : row.userLow,
    );
    const uniqueFriendIds = [...new Set(friendIds)];

    const [userRows, nicknames] = await Promise.all([
      db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarKey: users.avatarKey,
        })
        .from(users)
        .where(inArray(users.id, uniqueFriendIds)),

      getNicknameMap(normalizedUserId, uniqueFriendIds),
    ]);

    const userMap = new Map(
      userRows.map((user) => [
        user.id,
        {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarKey: user.avatarKey,
        },
      ]),
    );

    const items: Friend[] = friendshipRows.map((row) => {
      const friendId = row.userLow === normalizedUserId ? row.userHigh : row.userLow;
      const friend = userMap.get(friendId);

      if (!friend) {
        throw new ViewFriendsError("INTERNAL_ERROR", "Internal server error.", 500);
      }

      return {
        ...friend,
        displayName: nicknames.get(friendId) ?? friend.displayName,
        createdAt: row.createdAt,
      };
    });

    const nextCursor = items.length === normalizedLimit ? items[items.length - 1]!.createdAt : null;

    return {
      items,
      nextCursor,
      limit: normalizedLimit,
    };
  } catch (error: unknown) {
    if (error instanceof ViewFriendsError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: View friends\n`, error);
    throw new ViewFriendsError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
