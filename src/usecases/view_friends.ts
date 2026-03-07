import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../db/postgres_client.ts";

export type ViewFriendsErrorType =
  | "MISSING_USER_ID"
  | "INVALID_OFFSET"
  | "INVALID_LIMIT"
  | "USER_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ViewFriendsError extends Error {
  readonly type: ViewFriendsErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: ViewFriendsErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
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
  createdAt: Date;
};

export type ViewFriendsResult = {
  items: Friend[];
  offset: number;
  limit: number;
};

type FriendRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
  created_at: Date;
};

type FriendshipRow = {
  user_low: string;
  user_high: string;
  created_at: Date;
};

function mapFriend(row: FriendRow): Friend {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarKey: row.avatar_key,
    createdAt: row.created_at,
  };
}

function normalizePagination(
  offset = 0,
  limit = 20,
): { offset: number; limit: number } {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ViewFriendsError(
      "INVALID_OFFSET",
      "Offset must be a non-negative integer.",
      400,
    );
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ViewFriendsError(
      "INVALID_LIMIT",
      "Limit must be a positive integer.",
      400,
    );
  }

  return {
    offset,
    limit: Math.min(limit, 100),
  };
}

export async function viewFriends(
  userId: string,
  offset = 0,
  limit = 20,
): Promise<ViewFriendsResult> {
  try {
    if (!userId) {
      throw new ViewFriendsError("MISSING_USER_ID", "User id is missing.", 400);
    }

    const pagination = normalizePagination(offset, limit);

    return await withDb(async (client) => {
      const result = await client.queryObject<FriendRow>(
        `
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.avatar_key,
          f.created_at
        FROM friendships f
        JOIN users u ON (u.id = f.user_low OR u.id = f.user_high)
        WHERE (f.user_low = $1 OR f.user_high = $1)
          AND u.id != $1  -- Exclude the logged-in user from the results
        ORDER BY f.created_at DESC
        OFFSET $2
        LIMIT $3
        `,
        [userId, pagination.offset, pagination.limit],
      );

      return {
        items: result.rows.map(mapFriend),
        offset: pagination.offset,
        limit: pagination.limit,
      };
    });
  } catch (error) {
    if (error instanceof ViewFriendsError) {
      throw error;
    }

    throw new ViewFriendsError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
