import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendships, users } from "../../db/schema.ts";

export type ViewFriendsErrorType =
  | "MISSING_USER_ID"
  | "INVALID_OFFSET"
  | "INVALID_LIMIT"
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
  offset: number;
  limit: number;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function normalizePagination(offset = 0, limit = 20): { offset: number; limit: number } {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ViewFriendsError("INVALID_OFFSET", "Offset must be a non-negative integer.", 400);
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ViewFriendsError("INVALID_LIMIT", "Limit must be a positive integer.", 400);
  }

  return { offset, limit: Math.min(limit, 100) };
}

export async function viewFriends(
  userId: string,
  offset = 0,
  limit = 20,
): Promise<ViewFriendsResult> {
  const normalizedUserId = userId.trim();

  try {
    if (!normalizedUserId) {
      throw new ViewFriendsError("MISSING_USER_ID", "User id is missing.", 400);
    }

    if (!isValidUuid(normalizedUserId)) {
      throw new ViewFriendsError("MISSING_USER_ID", "User id is invalid.", 400);
    }

    const pagination = normalizePagination(offset, limit);

    const friendshipRows = await db
      .select({
        userLow: friendships.userLow,
        userHigh: friendships.userHigh,
        createdAt: friendships.createdAt,
      })
      .from(friendships)
      .where(
        or(eq(friendships.userLow, normalizedUserId), eq(friendships.userHigh, normalizedUserId)),
      )
      .orderBy(desc(friendships.createdAt))
      .offset(pagination.offset)
      .limit(pagination.limit);

    if (friendshipRows.length === 0) {
      return {
        items: [],
        offset: pagination.offset,
        limit: pagination.limit,
      };
    }

    const friendIds = friendshipRows.map((row) =>
      row.userLow === normalizedUserId ? row.userHigh : row.userLow,
    );

    const uniqueFriendIds = [...new Set(friendIds)];

    const userRows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
      })
      .from(users)
      .where(inArray(users.id, uniqueFriendIds));

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
        createdAt: row.createdAt,
      };
    });

    return {
      items,
      offset: pagination.offset,
      limit: pagination.limit,
    };
  } catch (error) {
    if (error instanceof ViewFriendsError) {
      throw error;
    }

    throw new ViewFriendsError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
