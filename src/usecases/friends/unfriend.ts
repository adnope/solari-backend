import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq, or } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { friendships, friendNicknames } from "../../db/schema.ts";
import { publishWebSocketEvent } from "../../jobs/queue.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";
import { deleteCachedNicknamePair } from "../../cache/nickname_cache.ts";
import { deleteCachedFriendIdsForUsers } from "../../cache/friend_cache.ts";
import { AppError } from "../app_error.ts";

export type UnfriendErrorType =
  | "MISSING_INPUT"
  | "NOT_FRIENDS"
  | "CANNOT_UNFRIEND_SELF"
  | "INTERNAL_ERROR";

export async function unfriend(userId: string, otherUserId: string): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedOtherUserId = otherUserId.trim();

  if (!normalizedUserId || !normalizedOtherUserId) {
    throw new AppError<UnfriendErrorType>("MISSING_INPUT", "User IDs are required.", 400);
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedOtherUserId)) {
    throw new AppError<UnfriendErrorType>("MISSING_INPUT", "Invalid user ID format.", 400);
  }

  if (normalizedUserId === normalizedOtherUserId) {
    throw new AppError<UnfriendErrorType>(
      "CANNOT_UNFRIEND_SELF",
      "You cannot unfriend yourself.",
      400,
    );
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
        throw new AppError<UnfriendErrorType>(
          "NOT_FRIENDS",
          "You are not friends with this user.",
          404,
        );
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

    await Promise.all([
      deleteCachedFriendIdsForUsers([normalizedUserId, normalizedOtherUserId]),
      deleteCachedNicknamePair(normalizedUserId, normalizedOtherUserId),
    ]);

    const unfriendPayload = {
      type: "FRIENDSHIP_STATUS_CHANGED" as const,
      payload: { partnerId: "", isFriend: false },
    };

    await Promise.all([
      publishWebSocketEvent(normalizedUserId, {
        ...unfriendPayload,
        payload: { partnerId: normalizedOtherUserId, isFriend: false },
      }),
      publishWebSocketEvent(normalizedOtherUserId, {
        ...unfriendPayload,
        payload: { partnerId: normalizedUserId, isFriend: false },
      }),
    ]);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    if (isPgErrorCode(error, PgErrorCode.INVALID_TEXT_REPRESENTATION)) {
      throw new AppError<UnfriendErrorType>("MISSING_INPUT", "Invalid ID format.", 400);
    }

    console.error(`[ERROR] Unexpected error in use case: Unfriend\n`, error);
    throw new AppError<UnfriendErrorType>("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
