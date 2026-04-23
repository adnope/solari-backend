import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { blockedUsers } from "../../db/schema.ts";
import { deleteCachedBlockingStateForPair } from "../../cache/block_relationship_cache.ts";

export type UnblockUserErrorType =
  | "MISSING_INPUT"
  | "CANNOT_UNBLOCK_SELF"
  | "NOT_BLOCKED"
  | "INTERNAL_ERROR";

export class UnblockUserError extends Error {
  readonly type: UnblockUserErrorType;
  readonly statusCode: number;

  constructor(type: UnblockUserErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "UnblockUserError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function unblockUser(blockerId: string, targetUserId: string): Promise<void> {
  const normalizedBlockerId = blockerId.trim();
  const normalizedTargetId = targetUserId.trim();

  if (!normalizedBlockerId || !normalizedTargetId) {
    throw new UnblockUserError("MISSING_INPUT", "User IDs are required.", 400);
  }

  if (!isValidUuid(normalizedBlockerId) || !isValidUuid(normalizedTargetId)) {
    throw new UnblockUserError("MISSING_INPUT", "Invalid user ID format.", 400);
  }

  if (normalizedBlockerId === normalizedTargetId) {
    throw new UnblockUserError("CANNOT_UNBLOCK_SELF", "You cannot unblock yourself.", 400);
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
      throw new UnblockUserError("NOT_BLOCKED", "User is not blocked.", 404);
    }

    await deleteCachedBlockingStateForPair(normalizedBlockerId, normalizedTargetId);
  } catch (error: unknown) {
    if (error instanceof UnblockUserError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Unblock user\n`, error);
    throw new UnblockUserError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
