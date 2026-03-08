import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { newUUIDv7 } from "../../utils/uuid.ts";

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

  constructor(
    type: SendFriendRequestErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
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
    throw new SendFriendRequestError(
      "MISSING_INPUT",
      "Requester id is required.",
      400,
    );
  }
  return value;
}

function normalizeIdentifier(identifier: string): string {
  const value = identifier.trim();
  if (value.length === 0) {
    throw new SendFriendRequestError(
      "INVALID_IDENTIFIER",
      "Username or email is required.",
      400,
    );
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
    return await withDb(async (client) => {
      await client.queryArray("BEGIN");

      try {
        const receiverResult = await client.queryObject<UserLookupRow>(
          `
          SELECT id
          FROM users
          WHERE username = $1 OR email = $1
          LIMIT 1
          `,
          [normalizedIdentifier],
        );

        const receiver = receiverResult.rows[0];
        if (!receiver) {
          throw new SendFriendRequestError(
            "USER_NOT_FOUND",
            "User not found.",
            404,
          );
        }

        if (receiver.id === normalizedRequesterId) {
          throw new SendFriendRequestError(
            "SELF_REQUEST",
            "You cannot send a friend request to yourself.",
            400,
          );
        }

        const friendshipResult = await client.queryObject<{ exists: boolean }>(
          `
          SELECT TRUE AS exists
          FROM friendships
          WHERE
            (user_low = $1 AND user_high = $2)
            OR
            (user_low = $2 AND user_high = $1)
          LIMIT 1
          `,
          [normalizedRequesterId, receiver.id],
        );

        if (friendshipResult.rows.length > 0) {
          throw new SendFriendRequestError(
            "ALREADY_FRIENDS",
            "You are already friends with this user.",
            409,
          );
        }

        const existingOutgoingResult = await client.queryObject<
          { exists: boolean }
        >(
          `
          SELECT TRUE AS exists
          FROM friend_requests
          WHERE requester_id = $1 AND receiver_id = $2
          LIMIT 1
          `,
          [normalizedRequesterId, receiver.id],
        );

        if (existingOutgoingResult.rows.length > 0) {
          throw new SendFriendRequestError(
            "REQUEST_ALREADY_SENT",
            "Friend request already sent.",
            409,
          );
        }

        const existingIncomingResult = await client.queryObject<
          { exists: boolean }
        >(
          `
          SELECT TRUE AS exists
          FROM friend_requests
          WHERE requester_id = $1 AND receiver_id = $2
          LIMIT 1
          `,
          [receiver.id, normalizedRequesterId],
        );

        if (existingIncomingResult.rows.length > 0) {
          throw new SendFriendRequestError(
            "REQUEST_ALREADY_RECEIVED",
            "This user has already sent you a friend request.",
            409,
          );
        }

        const requestId = newUUIDv7();

        const insertResult = await client.queryObject<FriendRequestRow>(
          `
          INSERT INTO friend_requests (
            id,
            requester_id,
            receiver_id
          )
          VALUES ($1, $2, $3)
          RETURNING
            id,
            requester_id,
            receiver_id,
            created_at
          `,
          [requestId, normalizedRequesterId, receiver.id],
        );

        const row = insertResult.rows[0];
        if (!row) {
          throw new SendFriendRequestError(
            "INTERNAL_ERROR",
            "Failed to create friend request.",
            500,
          );
        }

        await client.queryArray("COMMIT");
        return mapFriendRequest(row);
      } catch (error) {
        await client.queryArray("ROLLBACK");
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof SendFriendRequestError) {
      throw error;
    }

    if (isPgError(error) && error.fields.code === "23505") {
      throw new SendFriendRequestError(
        "REQUEST_ALREADY_SENT",
        "Friend request already sent.",
        409,
      );
    }

    throw new SendFriendRequestError(
      "INTERNAL_ERROR",
      "Internal server error.",
      500,
    );
  }
}
