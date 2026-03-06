import { withDb } from "../db/postgres_client.ts";
import { isPgError } from "./postgres_error.ts";

export type FriendRequestResult = {
  id: string;
  requesterId: string;
  receiverId: string;
  createdAt: Date;
};

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
    throw new Error("Requester id is required.");
  }
  return value;
}

function normalizeIdentifier(identifier: string): string {
  const value = identifier.trim();
  if (value.length === 0) {
    throw new Error("Username or email is required.");
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
          throw new Error("User not found.");
        }

        if (receiver.id === normalizedRequesterId) {
          throw new Error("You cannot send a friend request to yourself.");
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
          throw new Error("You are already friends with this user.");
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
          throw new Error("Friend request already sent.");
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
          throw new Error("This user has already sent you a friend request.");
        }

        const requestId = crypto.randomUUID();

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
          throw new Error("Failed to create friend request.");
        }

        await client.queryArray("COMMIT");
        return mapFriendRequest(row);
      } catch (error) {
        await client.queryArray("ROLLBACK");
        throw error;
      }
    });
  } catch (error) {
    if (isPgError(error) && error.fields.code === "23505") {
      throw new Error("Friend request already sent.");
    }

    throw error;
  }
}
