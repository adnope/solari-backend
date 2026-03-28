import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendRequests, users } from "../../db/schema.ts";

export type FriendRequestUser = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarKey: string | null;
};

export type FriendRequestDirection = "incoming" | "outgoing" | "both";

export type FriendRequestListItem = {
  id: string;
  createdAt: string;
  direction: "incoming" | "outgoing";
  requester: FriendRequestUser;
  receiver: FriendRequestUser;
};

export type ViewFriendRequestsResult = {
  items: FriendRequestListItem[];
  offset: number;
  limit: number;
  direction: FriendRequestDirection;
};

export type ViewFriendRequestsErrorType =
  | "MISSING_USER_ID"
  | "INVALID_OFFSET"
  | "INVALID_LIMIT"
  | "INVALID_DIRECTION"
  | "INTERNAL_ERROR";

export class ViewFriendRequestsError extends Error {
  readonly type: ViewFriendRequestsErrorType;
  readonly statusCode: number;

  constructor(type: ViewFriendRequestsErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ViewFriendRequestsError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function normalizeRequesterId(requesterId: string): string {
  const value = requesterId.trim();
  if (value.length === 0) {
    throw new ViewFriendRequestsError("MISSING_USER_ID", "Requester id is required.", 400);
  }
  if (!isValidUuid(value)) {
    throw new ViewFriendRequestsError("MISSING_USER_ID", "Requester id is invalid.", 400);
  }
  return value;
}

function normalizePagination(offset = 0, limit = 20): { offset: number; limit: number } {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ViewFriendRequestsError(
      "INVALID_OFFSET",
      "Offset must be a non-negative integer.",
      400,
    );
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ViewFriendRequestsError("INVALID_LIMIT", "Limit must be a positive integer.", 400);
  }

  return { offset, limit: Math.min(limit, 100) };
}

function normalizeDirection(direction: string | undefined): FriendRequestDirection {
  if (!direction || direction.trim() === "") return "both";
  const value = direction.trim().toLowerCase();
  if (value === "incoming" || value === "outgoing" || value === "both") {
    return value;
  }

  throw new ViewFriendRequestsError(
    "INVALID_DIRECTION",
    "Direction must be one of: incoming, outgoing, both.",
    400,
  );
}

export async function viewFriendRequests(
  userId: string,
  offset = 0,
  limit = 20,
  direction?: string,
): Promise<ViewFriendRequestsResult> {
  try {
    const normalizedUserId = normalizeRequesterId(userId);
    const pagination = normalizePagination(offset, limit);
    const normalizedDirection = normalizeDirection(direction);

    const requestRows = await db
      .select({
        id: friendRequests.id,
        createdAt: friendRequests.createdAt,
        requesterId: friendRequests.requesterId,
        receiverId: friendRequests.receiverId,
      })
      .from(friendRequests)
      .where(
        normalizedDirection === "incoming"
          ? eq(friendRequests.receiverId, normalizedUserId)
          : normalizedDirection === "outgoing"
            ? eq(friendRequests.requesterId, normalizedUserId)
            : or(
                eq(friendRequests.receiverId, normalizedUserId),
                eq(friendRequests.requesterId, normalizedUserId),
              ),
      )
      .orderBy(desc(friendRequests.createdAt))
      .offset(pagination.offset)
      .limit(pagination.limit);

    if (requestRows.length === 0) {
      return {
        items: [],
        offset: pagination.offset,
        limit: pagination.limit,
        direction: normalizedDirection,
      };
    }

    const relatedUserIds = [
      ...new Set(requestRows.flatMap((row) => [row.requesterId, row.receiverId])),
    ];

    const userRows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
      })
      .from(users)
      .where(inArray(users.id, relatedUserIds));

    const userMap = new Map(
      userRows.map((user) => [
        user.id,
        {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          avatarKey: user.avatarKey,
        },
      ]),
    );

    const items: FriendRequestListItem[] = requestRows.map((row) => {
      const requester = userMap.get(row.requesterId);
      const receiver = userMap.get(row.receiverId);

      if (!requester || !receiver) {
        throw new ViewFriendRequestsError("INTERNAL_ERROR", "Internal server error.", 500);
      }

      return {
        id: row.id,
        createdAt: row.createdAt,
        direction: row.receiverId === normalizedUserId ? "incoming" : "outgoing",
        requester,
        receiver,
      };
    });

    return {
      items,
      offset: pagination.offset,
      limit: pagination.limit,
      direction: normalizedDirection,
    };
  } catch (error) {
    if (error instanceof ViewFriendRequestsError) {
      throw error;
    }

    throw new ViewFriendRequestsError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
