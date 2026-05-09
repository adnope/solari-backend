import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendNicknames } from "../../db/schema.ts";
import { cacheNickname } from "../../cache/nickname_cache.ts";
import { AppError } from "../app_error.ts";

export type RemoveNicknameResult = {
  success: boolean;
};

export type RemoveNicknameErrorType = "MISSING_INPUT" | "INVALID_FORMAT" | "INTERNAL_ERROR";

export async function removeNickname(
  setterId: string,
  targetId: string,
): Promise<RemoveNicknameResult> {
  const normalizedSetterId = setterId.trim();
  const normalizedTargetId = targetId.trim();

  if (!normalizedSetterId || !normalizedTargetId) {
    throw new AppError<RemoveNicknameErrorType>("MISSING_INPUT", "User IDs are required.", 400);
  }

  if (!isValidUuid(normalizedSetterId) || !isValidUuid(normalizedTargetId)) {
    throw new AppError<RemoveNicknameErrorType>("INVALID_FORMAT", "Invalid user ID format.", 400);
  }

  try {
    await db
      .delete(friendNicknames)
      .where(
        and(
          eq(friendNicknames.setterId, normalizedSetterId),
          eq(friendNicknames.targetId, normalizedTargetId),
        ),
      );

    await cacheNickname(normalizedSetterId, normalizedTargetId, null);

    return { success: true };
  } catch (error) {
    if (error instanceof AppError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Remove nickname\n${error}`);
    throw new AppError<RemoveNicknameErrorType>("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
