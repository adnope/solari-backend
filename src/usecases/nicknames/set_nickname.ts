import { isValidUuid } from "../../utils/validation.ts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendNicknames, friendships } from "../../db/schema.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";
import { cacheNickname } from "../../cache/nickname_cache.ts";
import { AppError } from "../app_error.ts";

export type SetNicknameResult = {
  success: boolean;
  nickname: string;
};

export type SetNicknameErrorType =
  | "MISSING_INPUT"
  | "INVALID_FORMAT"
  | "CANNOT_NICKNAME_SELF"
  | "USER_NOT_FOUND"
  | "NOT_FRIENDS"
  | "NICKNAME_ALREADY_EXISTS"
  | "INTERNAL_ERROR";

export async function setNickname(
  setterId: string,
  targetId: string,
  nickname: string,
): Promise<SetNicknameResult> {
  const normalizedSetterId = setterId.trim();
  const normalizedTargetId = targetId.trim();
  const trimmedNickname = nickname.trim();

  if (!normalizedSetterId || !normalizedTargetId || !trimmedNickname) {
    throw new AppError<SetNicknameErrorType>(
      "MISSING_INPUT",
      "User IDs and nickname are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedSetterId) || !isValidUuid(normalizedTargetId)) {
    throw new AppError<SetNicknameErrorType>("INVALID_FORMAT", "Invalid user ID format.", 400);
  }

  if (normalizedSetterId === normalizedTargetId) {
    throw new AppError<SetNicknameErrorType>(
      "CANNOT_NICKNAME_SELF",
      "You cannot set a nickname for yourself.",
      400,
    );
  }

  const [userLow, userHigh]: [string, string] =
    normalizedSetterId < normalizedTargetId
      ? [normalizedSetterId, normalizedTargetId]
      : [normalizedTargetId, normalizedSetterId];

  try {
    const [friendship] = await db
      .select({ userLow: friendships.userLow })
      .from(friendships)
      .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
      .limit(1);

    if (!friendship) {
      throw new AppError<SetNicknameErrorType>(
        "NOT_FRIENDS",
        "You can only set nicknames for users who are on your friends list.",
        403,
      );
    }

    const now = new Date().toISOString();

    await db.insert(friendNicknames).values({
      setterId: normalizedSetterId,
      targetId: normalizedTargetId,
      nickname: trimmedNickname,
      createdAt: now,
      updatedAt: now,
    });

    await cacheNickname(normalizedSetterId, normalizedTargetId, trimmedNickname);

    return { success: true, nickname: trimmedNickname };
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    if (isPgErrorCode(error, PgErrorCode.UNIQUE_VIOLATION)) {
      throw new AppError<SetNicknameErrorType>(
        "NICKNAME_ALREADY_EXISTS",
        "A nickname is already set for this user. Use the update endpoint instead.",
        409,
      );
    }

    if (isPgErrorCode(error, PgErrorCode.FOREIGN_KEY_VIOLATION)) {
      throw new AppError<SetNicknameErrorType>(
        "USER_NOT_FOUND",
        "Target user does not exist.",
        404,
      );
    }

    console.error(`[ERROR] Unexpected error in use case: Set nickname\n`, error);
    throw new AppError<SetNicknameErrorType>("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
