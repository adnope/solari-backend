import { withDb } from "../db/postgres_client.ts";
import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";

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
  createdAt: Date;
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
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: ViewFriendRequestsErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "ViewFriendRequestsError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

type ViewFriendRequestsRow = {
  id: string;
  created_at: Date;

  requester_id: string;
  requester_username: string;
  requester_email: string;
  requester_display_name: string | null;
  requester_avatar_key: string | null;

  receiver_id: string;
  receiver_username: string;
  receiver_email: string;
  receiver_display_name: string | null;
  receiver_avatar_key: string | null;
};

function normalizeRequesterId(requesterId: string): string {
  const value = requesterId.trim();
  if (value.length === 0) {
    throw new ViewFriendRequestsError(
      "MISSING_USER_ID",
      "Requester id is required.",
      400,
    );
  }
  return value;
}

function normalizePagination(
  offset = 0,
  limit = 20,
): { offset: number; limit: number } {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ViewFriendRequestsError(
      "INVALID_OFFSET",
      "Offset must be a non-negative integer.",
      400,
    );
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ViewFriendRequestsError(
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

function normalizeDirection(
  direction: string | undefined,
): FriendRequestDirection {
  if (!direction || direction.trim() === "") {
    return "both";
  }

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

function mapFriendRequestListItem(
  currentUserId: string,
  row: ViewFriendRequestsRow,
): FriendRequestListItem {
  return {
    id: row.id,
    createdAt: row.created_at,
    direction: row.receiver_id === currentUserId ? "incoming" : "outgoing",
    requester: {
      id: row.requester_id,
      username: row.requester_username,
      email: row.requester_email,
      displayName: row.requester_display_name,
      avatarKey: row.requester_avatar_key,
    },
    receiver: {
      id: row.receiver_id,
      username: row.receiver_username,
      email: row.receiver_email,
      displayName: row.receiver_display_name,
      avatarKey: row.receiver_avatar_key,
    },
  };
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

    let whereClause = "WHERE fr.requester_id = $1 OR fr.receiver_id = $1";
    if (normalizedDirection === "incoming") {
      whereClause = "WHERE fr.receiver_id = $1";
    } else if (normalizedDirection === "outgoing") {
      whereClause = "WHERE fr.requester_id = $1";
    }

    return await withDb(async (client) => {
      const result = await client.queryObject<ViewFriendRequestsRow>(
        `
        SELECT
          fr.id,
          fr.created_at,

          ru.id AS requester_id,
          ru.username AS requester_username,
          ru.email AS requester_email,
          ru.display_name AS requester_display_name,
          ru.avatar_key AS requester_avatar_key,

          vu.id AS receiver_id,
          vu.username AS receiver_username,
          vu.email AS receiver_email,
          vu.display_name AS receiver_display_name,
          vu.avatar_key AS receiver_avatar_key
        FROM friend_requests fr
        JOIN users ru ON ru.id = fr.requester_id
        JOIN users vu ON vu.id = fr.receiver_id
        ${whereClause}
        ORDER BY fr.created_at DESC
        OFFSET $2
        LIMIT $3
        `,
        [normalizedUserId, pagination.offset, pagination.limit],
      );

      return {
        items: result.rows.map((row) =>
          mapFriendRequestListItem(normalizedUserId, row)
        ),
        offset: pagination.offset,
        limit: pagination.limit,
        direction: normalizedDirection,
      };
    });
  } catch (error) {
    if (error instanceof ViewFriendRequestsError) {
      throw error;
    }

    throw new ViewFriendRequestsError(
      "INTERNAL_ERROR",
      "Internal server error.",
      500,
    );
  }
}
