import { and, eq, or } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { friendships, friendNicknames } from "../../db/schema.ts";
import { wsPublisher } from "../../websocket/publisher.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";

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
    await withTx(async (tx) => {
      const [deleted] = await tx
        .delete(friendships)
        .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
        .returning({ userLow: friendships.userLow });

      if (!deleted) {
        throw new UnfriendError("NOT_FRIENDS", "You are not friends with this user.", 404);
      }

      await tx
        .delete(friendNicknames)
        .where(
          or(
            and(
              eq(friendNicknames.setterId, normalizedUserId),
              eq(friendNicknames.targetId, normalizedOtherUserId),
            ),
            and(
              eq(friendNicknames.setterId, normalizedOtherUserId),
              eq(friendNicknames.targetId, normalizedUserId),
            ),
          ),
        );
    });

    const unfriendPayload = {
      type: "FRIENDSHIP_STATUS_CHANGED" as const,
      payload: { partnerId: "", isFriend: false },
    };

    wsPublisher.sendToUser(normalizedUserId, {
      ...unfriendPayload,
      payload: { partnerId: normalizedOtherUserId, isFriend: false },
    });

    wsPublisher.sendToUser(normalizedOtherUserId, {
      ...unfriendPayload,
      payload: { partnerId: normalizedUserId, isFriend: false },
    });
  } catch (error: unknown) {
    if (error instanceof UnfriendError) {
      throw error;
    }

    if (isPgErrorCode(error, PgErrorCode.INVALID_TEXT_REPRESENTATION)) {
      throw new UnfriendError("MISSING_INPUT", "Invalid ID format.", 400);
    }

    console.error(`[ERROR] Unexpected error in use case: Unfriend\n`, error);
    throw new UnfriendError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
