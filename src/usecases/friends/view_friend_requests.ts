import { isValidUuid } from "../../utils/uuid.ts";
import { and, asc, desc, eq, gt, inArray, lt, notExists, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { blockedUsers, friendRequests, users } from "../../db/schema.ts";

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
  nextCursor: string | null;
  limit: number;
  direction: FriendRequestDirection;
};

export type ViewFriendRequestsErrorType =
  | "MISSING_USER_ID"
  | "INVALID_CURSOR"
  | "INVALID_LIMIT"
  | "INVALID_DIRECTION"
  | "INVALID_SORT"
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

function normalizeLimit(limit = 20): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ViewFriendRequestsError("INVALID_LIMIT", "Limit must be a positive integer.", 400);
  }
  return Math.min(limit, 100);
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
  cursor?: string,
  limit = 20,
  direction?: string,
  sort: "newest" | "oldest" = "newest",
): Promise<ViewFriendRequestsResult> {
  try {
    const normalizedUserId = normalizeRequesterId(userId);
    const normalizedLimit = normalizeLimit(limit);
    const normalizedDirection = normalizeDirection(direction);

    if (sort !== "newest" && sort !== "oldest") {
      throw new ViewFriendRequestsError("INVALID_SORT", "Sort must be 'newest' or 'oldest'.", 400);
    }

    if (cursor && Number.isNaN(Date.parse(cursor))) {
      throw new ViewFriendRequestsError(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }

    const directionCondition =
      normalizedDirection === "incoming"
        ? eq(friendRequests.receiverId, normalizedUserId)
        : normalizedDirection === "outgoing"
          ? eq(friendRequests.requesterId, normalizedUserId)
          : or(
              eq(friendRequests.receiverId, normalizedUserId),
              eq(friendRequests.requesterId, normalizedUserId),
            );

    let cursorCondition = undefined;
    if (cursor) {
      if (sort === "newest") {
        cursorCondition = lt(friendRequests.createdAt, cursor);
      } else {
        cursorCondition = gt(friendRequests.createdAt, cursor);
      }
    }

    const noBlockCondition = notExists(
      db
        .select({ blockerId: blockedUsers.blockerId })
        .from(blockedUsers)
        .where(
          or(
            and(
              eq(blockedUsers.blockerId, friendRequests.requesterId),
              eq(blockedUsers.blockedId, friendRequests.receiverId),
            ),
            and(
              eq(blockedUsers.blockerId, friendRequests.receiverId),
              eq(blockedUsers.blockedId, friendRequests.requesterId),
            ),
          ),
        ),
    );

    const whereCondition = cursorCondition
      ? and(directionCondition, cursorCondition, noBlockCondition)
      : and(directionCondition, noBlockCondition);

    const orderCondition =
      sort === "newest" ? desc(friendRequests.createdAt) : asc(friendRequests.createdAt);

    const requestRows = await db
      .select({
        id: friendRequests.id,
        createdAt: friendRequests.createdAt,
        requesterId: friendRequests.requesterId,
        receiverId: friendRequests.receiverId,
      })
      .from(friendRequests)
      .where(whereCondition)
      .orderBy(orderCondition)
      .limit(normalizedLimit);

    if (requestRows.length === 0) {
      return {
        items: [],
        nextCursor: null,
        limit: normalizedLimit,
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

    const nextCursor = items.length === normalizedLimit ? (items.at(-1)?.createdAt ?? null) : null;

    return {
      items,
      nextCursor,
      limit: normalizedLimit,
      direction: normalizedDirection,
    };
  } catch (error) {
    if (error instanceof ViewFriendRequestsError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: View friend requests\n${error}`);
    throw new ViewFriendRequestsError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
