import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";

export type UnfriendErrorType =
  | "MISSING_INPUT"
  | "NOT_FRIENDS"
  | "CANNOT_UNFRIEND_SELF"
  | "INTERNAL_ERROR";

export class UnfriendError extends Error {
  readonly type: UnfriendErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: UnfriendErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "UnfriendError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function unfriend(userId: string, otherUserId: string): Promise<void> {
  if (userId === otherUserId) {
    throw new UnfriendError("CANNOT_UNFRIEND_SELF", "You cannot unfriend yourself.", 400);
  }

  try {
    return await withDb(async (client) => {
      const friendshipResult = await client.queryObject`
        SELECT user_low, user_high
        FROM friendships
        WHERE
          (user_low = ${userId} AND user_high = ${otherUserId})
          OR
          (user_low = ${otherUserId} AND user_high = ${userId})
        LIMIT 1
      `;

      const friendship = friendshipResult.rows[0];
      if (!friendship) {
        throw new UnfriendError("NOT_FRIENDS", "You are not friends with this user.", 404);
      }

      await client.queryObject`
        DELETE FROM friendships
        WHERE
          (user_low = ${userId} AND user_high = ${otherUserId})
          OR
          (user_low = ${otherUserId} AND user_high = ${userId})
      `;
    });
  } catch (error) {
    if (error instanceof UnfriendError) {
      throw error;
    }
    throw new UnfriendError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
