import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../db/postgres_client.ts";

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

// This function can be used to both cancel and reject a friend request
export async function cancelOrRejectFriendRequest(
  userId: string, // This can be either the requester or receiver
  requestId: string,
): Promise<void> {
  try {
    return await withDb(async (client) => {
      await client.queryArray("BEGIN");

      try {
        const requestResult = await client.queryObject<FriendRequestRow>(
          `
          SELECT id, requester_id, receiver_id, created_at
          FROM friend_requests
          WHERE id = $1
          LIMIT 1
          `,
          [requestId],
        );

        const requestRow = requestResult.rows[0];
        if (!requestRow) {
          throw new CancelOrRejectFriendRequestError(
            "REQUEST_NOT_FOUND",
            "Friend request not found.",
            404,
          );
        }

        if (
          requestRow.requester_id === userId ||
          requestRow.receiver_id === userId
        ) {
          await client.queryArray(
            `
            DELETE FROM friend_requests
            WHERE id = $1
            `,
            [requestId],
          );
        } else {
          throw new CancelOrRejectFriendRequestError(
            "NOT_REQUESTER_OR_RECEIVER",
            "You are neither the requester nor the receiver.",
            403,
          );
        }

        await client.queryArray("COMMIT");
      } catch (error) {
        await client.queryArray("ROLLBACK");
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof CancelOrRejectFriendRequestError) {
      throw error;
    }

    throw new CancelOrRejectFriendRequestError(
      "INTERNAL_ERROR",
      "Internal server error.",
      500,
    );
  }
}
