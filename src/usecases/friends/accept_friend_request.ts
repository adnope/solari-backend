import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";

export type AcceptFriendRequestResult = {
  id: string;
  requesterId: string;
  receiverId: string;
  createdAt: Date;
};

export type AcceptFriendRequestErrorType =
  | "MISSING_INPUT"
  | "USER_NOT_FOUND"
  | "REQUEST_NOT_FOUND"
  | "SELF_REQUEST"
  | "ALREADY_FRIENDS"
  | "INTERNAL_ERROR";

export class AcceptFriendRequestError extends Error {
  readonly type: AcceptFriendRequestErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: AcceptFriendRequestErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "AcceptFriendRequestError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

type FriendRequestRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  created_at: Date;
};

type FriendshipRow = {
  user_low: string;
  user_high: string;
  created_at: Date;
};

function mapAcceptFriendRequest(row: FriendRequestRow): AcceptFriendRequestResult {
  return {
    id: row.id,
    requesterId: row.requester_id,
    receiverId: row.receiver_id,
    createdAt: row.created_at,
  };
}

export async function acceptFriendRequest(
  receiverId: string,
  requestId: string,
): Promise<AcceptFriendRequestResult> {
  try {
    return await withDb(async (client) => {
      // Bun natively handles the BEGIN, COMMIT, and ROLLBACK logic for us!
      return await client.begin(async (tx) => {
        const requestResult = await tx`
          SELECT id, requester_id, receiver_id, created_at
          FROM friend_requests
          WHERE id = ${requestId}
          AND receiver_id = ${receiverId}
          LIMIT 1
        `;

        const requestRow = requestResult[0] as FriendRequestRow | undefined;
        if (!requestRow) {
          throw new AcceptFriendRequestError(
            "REQUEST_NOT_FOUND",
            "Friend request not found or not for this user.",
            404,
          );
        }

        const userLow =
          requestRow.requester_id < requestRow.receiver_id
            ? requestRow.requester_id
            : requestRow.receiver_id;

        const userHigh =
          requestRow.requester_id > requestRow.receiver_id
            ? requestRow.requester_id
            : requestRow.receiver_id;

        const friendshipResult = await tx`
          INSERT INTO friendships (user_low, user_high, created_at)
          VALUES (${userLow}, ${userHigh}, now())
          RETURNING user_low, user_high, created_at
        `;

        const friendshipRow = friendshipResult[0] as FriendshipRow | undefined;
        if (!friendshipRow) {
          throw new AcceptFriendRequestError("INTERNAL_ERROR", "Failed to create friendship.", 500);
        }

        await tx`
          DELETE FROM friend_requests
          WHERE id = ${requestId}
        `;

        return mapAcceptFriendRequest(requestRow);
      });
    });
  } catch (error) {
    if (error instanceof AcceptFriendRequestError) {
      throw error;
    }

    throw new AcceptFriendRequestError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
