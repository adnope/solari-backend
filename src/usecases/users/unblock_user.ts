import { isValidUuid } from "../../utils/validation.ts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { blockedUsers } from "../../db/schema.ts";
import { deleteCachedBlockingStateForPair } from "../../cache/block_relationship_cache.ts";
import { AppError } from "../app_error.ts";

export type UnblockUserErrorType =
  | "MISSING_INPUT"
  | "CANNOT_UNBLOCK_SELF"
  | "NOT_BLOCKED"
  | "INTERNAL_ERROR";

export async function unblockUser(blockerId: string, targetUserId: string): Promise<void> {
  const normalizedBlockerId = blockerId.trim();
  const normalizedTargetId = targetUserId.trim();

  if (!normalizedBlockerId || !normalizedTargetId) {
    throw new AppError<UnblockUserErrorType>("MISSING_INPUT", "User IDs are required.", 400);
  }

  if (!isValidUuid(normalizedBlockerId) || !isValidUuid(normalizedTargetId)) {
    throw new AppError<UnblockUserErrorType>("MISSING_INPUT", "Invalid user ID format.", 400);
  }

  if (normalizedBlockerId === normalizedTargetId) {
    throw new AppError<UnblockUserErrorType>(
      "CANNOT_UNBLOCK_SELF",
      "You cannot unblock yourself.",
      400,
    );
  }

  try {
    const [deletedBlock] = await db
      .delete(blockedUsers)
      .where(
        and(
          eq(blockedUsers.blockerId, normalizedBlockerId),
          eq(blockedUsers.blockedId, normalizedTargetId),
        ),
      )
      .returning({
        blockerId: blockedUsers.blockerId,
      });

    if (!deletedBlock) {
      throw new AppError<UnblockUserErrorType>("NOT_BLOCKED", "User is not blocked.", 404);
    }

    await deleteCachedBlockingStateForPair(normalizedBlockerId, normalizedTargetId);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Unblock user\n`, error);
    throw new AppError<UnblockUserErrorType>("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
