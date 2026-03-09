import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";

export type CancelOrRejectFriendRequestErrorType =
  | "MISSING_INPUT"
  | "REQUEST_NOT_FOUND"
  | "NOT_REQUESTER_OR_RECEIVER"
  | "INTERNAL_ERROR";

export class CancelOrRejectFriendRequestError extends Error {
  readonly type: CancelOrRejectFriendRequestErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: CancelOrRejectFriendRequestErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "CancelOrRejectFriendRequestError";
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

export async function cancelOrRejectFriendRequest(
  userId: string,
  requestId: string,
): Promise<void> {
  try {
    return await withDb(async (client) => {
      await client.begin(async (tx) => {
        const requestResult = await tx`
          SELECT id, requester_id, receiver_id, created_at
          FROM friend_requests
          WHERE id = ${requestId}
          LIMIT 1
        `;

        const requestRow = requestResult[0] as FriendRequestRow | undefined;
        if (!requestRow) {
          throw new CancelOrRejectFriendRequestError(
            "REQUEST_NOT_FOUND",
            "Friend request not found.",
            404,
          );
        }

        if (requestRow.requester_id === userId || requestRow.receiver_id === userId) {
          await tx`
            DELETE FROM friend_requests
            WHERE id = ${requestId}
          `;
        } else {
          throw new CancelOrRejectFriendRequestError(
            "NOT_REQUESTER_OR_RECEIVER",
            "You are neither the requester nor the receiver.",
            403,
          );
        }
      });
    });
  } catch (error) {
    if (error instanceof CancelOrRejectFriendRequestError) {
      throw error;
    }

    throw new CancelOrRejectFriendRequestError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
