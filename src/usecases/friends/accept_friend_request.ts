import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { sendPushNotification } from "../../utils/fcm.ts";

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
    const { result, pushData } = await withDb(async (client) => {
      const tx = client.createTransaction("accept_friend_request_tx");
      await tx.begin();

      try {
        const requestResult = await tx.queryObject<FriendRequestRow>`
          SELECT id, requester_id, receiver_id, created_at
          FROM friend_requests
          WHERE id = ${requestId}
          AND receiver_id = ${receiverId}
          LIMIT 1
        `;

        const requestRow = requestResult.rows[0];
        if (!requestRow) {
          throw new AcceptFriendRequestError(
            "REQUEST_NOT_FOUND",
            "Friend request not found or not for this user.",
            404,
          );
        }

        const userLow = requestRow.requester_id < requestRow.receiver_id
          ? requestRow.requester_id
          : requestRow.receiver_id;

        const userHigh = requestRow.requester_id > requestRow.receiver_id
          ? requestRow.requester_id
          : requestRow.receiver_id;

        const friendshipResult = await tx.queryObject<FriendshipRow>`
          INSERT INTO friendships (user_low, user_high, created_at)
          VALUES (${userLow}, ${userHigh}, now())
          RETURNING user_low, user_high, created_at
        `;

        const friendshipRow = friendshipResult.rows[0];
        if (!friendshipRow) {
          throw new AcceptFriendRequestError("INTERNAL_ERROR", "Failed to create friendship.", 500);
        }

        await tx.queryObject`
          DELETE FROM friend_requests
          WHERE id = ${requestId}
        `;

        const acceptorResult = await tx.queryObject<{
          username: string;
          display_name: string | null;
          avatar_key: string | null;
        }>`
          SELECT username, display_name, avatar_key FROM users WHERE id = ${receiverId} LIMIT 1
        `;
        const acceptorName = acceptorResult.rows[0]?.display_name ||
          acceptorResult.rows[0]?.username || "Someone";
        const acceptorAvatarKey = acceptorResult.rows[0]?.avatar_key;

        const devicesResult = await tx.queryObject<{ device_token: string }>`
          SELECT device_token FROM user_devices WHERE user_id = ${requestRow.requester_id}
        `;
        const tokens = devicesResult.rows.map((row) => row.device_token);

        await tx.commit();

        return {
          result: mapAcceptFriendRequest(requestRow),
          pushData: { tokens, acceptorName, acceptorAvatarKey, acceptorId: receiverId },
        };
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    });

    if (pushData.tokens.length > 0) {
      const title = "Friend Request Accepted";
      const body = `${pushData.acceptorName} accepted your friend request.`;

      let avatarUrl = "";
      if (pushData.acceptorAvatarKey) {
        avatarUrl = await getFileUrl(pushData.acceptorAvatarKey);
      }

      const extraData = {
        acceptorId: pushData.acceptorId,
        avatarUrl: avatarUrl,
      };

      Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(token, title, body, "FRIEND_REQUEST_ACCEPTED", extraData)
        ),
      ).catch(console.error);
    }

    return result;
  } catch (error) {
    if (error instanceof AcceptFriendRequestError) {
      throw error;
    }

    throw new AcceptFriendRequestError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
