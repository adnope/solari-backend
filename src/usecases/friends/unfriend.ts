import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendships } from "../../db/migrations/schema.ts";

export type UnfriendErrorType =
  | "MISSING_INPUT"
  | "NOT_FRIENDS"
  | "CANNOT_UNFRIEND_SELF"
  | "INTERNAL_ERROR";

export class UnfriendError extends Error {
  readonly type: UnfriendErrorType;
  readonly statusCode: number;

  constructor(type: UnfriendErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "UnfriendError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function unfriend(userId: string, otherUserId: string): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedOtherUserId = otherUserId.trim();

  if (!normalizedUserId || !normalizedOtherUserId) {
    throw new UnfriendError("MISSING_INPUT", "User IDs are required.", 400);
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedOtherUserId)) {
    throw new UnfriendError("MISSING_INPUT", "Invalid user ID format.", 400);
  }

  if (normalizedUserId === normalizedOtherUserId) {
    throw new UnfriendError("CANNOT_UNFRIEND_SELF", "You cannot unfriend yourself.", 400);
  }

  const [userLow, userHigh]: [string, string] =
    normalizedUserId < normalizedOtherUserId
      ? [normalizedUserId, normalizedOtherUserId]
      : [normalizedOtherUserId, normalizedUserId];

  try {
    const [deleted] = await db
      .delete(friendships)
      .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
      .returning({
        userLow: friendships.userLow,
      });

    if (!deleted) {
      throw new UnfriendError("NOT_FRIENDS", "You are not friends with this user.", 404);
    }
  } catch (error) {
    if (error instanceof UnfriendError) {
      throw error;
    }

    throw new UnfriendError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
