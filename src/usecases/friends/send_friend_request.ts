import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { v7 } from "@std/uuid";
import { withDb } from "../../db/postgres_client.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { sendPushNotification } from "../../utils/fcm.ts";
import { isPgError } from "../postgres_error.ts";

export type FriendRequestResult = {
  id: string;
  requesterId: string;
  receiverId: string;
  createdAt: Date;
};

export type SendFriendRequestErrorType =
  | "MISSING_INPUT"
  | "INVALID_IDENTIFIER"
  | "USER_NOT_FOUND"
  | "SELF_REQUEST"
  | "ALREADY_FRIENDS"
  | "REQUEST_ALREADY_SENT"
  | "REQUEST_ALREADY_RECEIVED"
  | "INTERNAL_ERROR";

export class SendFriendRequestError extends Error {
  readonly type: SendFriendRequestErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: SendFriendRequestErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "SendFriendRequestError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

type UserLookupRow = {
  id: string;
};

type FriendRequestRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  created_at: Date;
};

function normalizeRequesterId(requesterId: string): string {
  const value = requesterId.trim();
  if (value.length === 0) {
    throw new SendFriendRequestError("MISSING_INPUT", "Requester id is required.", 400);
  }
  return value;
}

function normalizeIdentifier(identifier: string): string {
  const value = identifier.trim();
  if (value.length === 0) {
    throw new SendFriendRequestError("INVALID_IDENTIFIER", "Username or email is required.", 400);
  }
  return value;
}

function mapFriendRequest(row: FriendRequestRow): FriendRequestResult {
  return {
    id: row.id,
    requesterId: row.requester_id,
    receiverId: row.receiver_id,
    createdAt: row.created_at,
  };
}

export async function sendFriendRequest(
  requesterId: string,
  identifier: string,
): Promise<FriendRequestResult> {
  if (!requesterId || !identifier) {
    throw new SendFriendRequestError(
      "MISSING_INPUT",
      "Requester ID or receiver identifier is missing.",
      400,
    );
  }

  const normalizedRequesterId = normalizeRequesterId(requesterId);
  const normalizedIdentifier = normalizeIdentifier(identifier);

  try {
    const { requestResult, pushData } = await withDb(async (client) => {
      const tx = client.createTransaction("send_friend_request_tx");
      await tx.begin();

      try {
        const requesterResult = await tx.queryObject<{
          username: string;
          display_name: string | null;
          avatar_key: string | null;
        }>`
        SELECT username, display_name, avatar_key FROM users WHERE id = ${normalizedRequesterId} LIMIT 1
        `;
        const requesterName = requesterResult.rows[0]?.display_name ||
          requesterResult.rows[0]?.username || "Someone";
        const requesterAvatarKey = requesterResult.rows[0]?.avatar_key;

        const receiverResult = await tx.queryObject<UserLookupRow>`
          SELECT id
          FROM users
          WHERE username = ${normalizedIdentifier} OR email = ${normalizedIdentifier}
          LIMIT 1
        `;

        const receiver = receiverResult.rows[0];
        if (!receiver) {
          throw new SendFriendRequestError("USER_NOT_FOUND", "User not found.", 404);
        }

        if (receiver.id === normalizedRequesterId) {
          throw new SendFriendRequestError(
            "SELF_REQUEST",
            "You cannot send a friend request to yourself.",
            400,
          );
        }

        const friendshipResult = await tx.queryObject`
          SELECT TRUE AS exists
          FROM friendships
          WHERE
            (user_low = ${normalizedRequesterId} AND user_high = ${receiver.id})
            OR
            (user_low = ${receiver.id} AND user_high = ${normalizedRequesterId})
          LIMIT 1
        `;

        if (friendshipResult.rows.length > 0) {
          throw new SendFriendRequestError(
            "ALREADY_FRIENDS",
            "You are already friends with this user.",
            409,
          );
        }

        const existingOutgoingResult = await tx.queryObject`
          SELECT TRUE AS exists
          FROM friend_requests
          WHERE requester_id = ${normalizedRequesterId} AND receiver_id = ${receiver.id}
          LIMIT 1
        `;

        if (existingOutgoingResult.rows.length > 0) {
          throw new SendFriendRequestError(
            "REQUEST_ALREADY_SENT",
            "Friend request already sent.",
            409,
          );
        }

        const existingIncomingResult = await tx.queryObject`
          SELECT TRUE AS exists
          FROM friend_requests
          WHERE requester_id = ${receiver.id} AND receiver_id = ${normalizedRequesterId}
          LIMIT 1
        `;

        if (existingIncomingResult.rows.length > 0) {
          throw new SendFriendRequestError(
            "REQUEST_ALREADY_RECEIVED",
            "This user has already sent you a friend request.",
            409,
          );
        }

        const requestId = v7.generate();

        const insertResult = await tx.queryObject<FriendRequestRow>`
          INSERT INTO friend_requests (
            id,
            requester_id,
            receiver_id
          )
          VALUES (${requestId}, ${normalizedRequesterId}, ${receiver.id})
          RETURNING
            id,
            requester_id,
            receiver_id,
            created_at
        `;

        const row = insertResult.rows[0];
        if (!row) {
          throw new SendFriendRequestError(
            "INTERNAL_ERROR",
            "Failed to create friend request.",
            500,
          );
        }

        const devicesResult = await tx.queryObject<{ device_token: string }>`
          SELECT device_token FROM user_devices WHERE user_id = ${receiver.id}
        `;
        const tokens = devicesResult.rows.map((r) => r.device_token);

        await tx.commit();

        return {
          requestResult: mapFriendRequest(row),
          pushData: {
            tokens,
            requesterName,
            requesterAvatarKey,
            requesterId: normalizedRequesterId,
          },
        };
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    });

    if (pushData.tokens.length > 0) {
      const title = "New Friend Request";
      const body = `${pushData.requesterName} sent you a friend request.`;

      let avatarUrl = "";
      if (pushData.requesterAvatarKey) {
        avatarUrl = await getFileUrl(pushData.requesterAvatarKey);
      }

      const extraData = {
        requesterId: pushData.requesterId,
        avatarUrl: avatarUrl,
      };

      Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(token, title, body, "NEW_FRIEND_REQUEST", extraData)
        ),
      ).catch(console.error);
    }

    return requestResult;
  } catch (error) {
    if (error instanceof SendFriendRequestError) {
      throw error;
    }

    if (isPgError(error) && error.code === "23505") {
      throw new SendFriendRequestError("REQUEST_ALREADY_SENT", "Friend request already sent.", 409);
    }

    throw new SendFriendRequestError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
