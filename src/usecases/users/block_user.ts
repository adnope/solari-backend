import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { blockedUsers, friendships, users } from "../../db/schema.ts";
import { isPgError } from "../postgres_error.ts";
import { wsPublisher } from "../../websocket/publisher.ts";

export type BlockUserErrorType =
  | "MISSING_INPUT"
  | "CANNOT_BLOCK_SELF"
  | "USER_NOT_FOUND"
  | "ALREADY_BLOCKED"
  | "INTERNAL_ERROR";

export class BlockUserError extends Error {
  readonly type: BlockUserErrorType;
  readonly statusCode: number;

  constructor(type: BlockUserErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "BlockUserError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function blockUser(blockerId: string, targetUserId: string): Promise<void> {
  const normalizedBlockerId = blockerId.trim();
  const normalizedTargetId = targetUserId.trim();

  if (!normalizedBlockerId || !normalizedTargetId) {
    throw new BlockUserError("MISSING_INPUT", "User IDs are required.", 400);
  }

  if (!isValidUuid(normalizedBlockerId) || !isValidUuid(normalizedTargetId)) {
    throw new BlockUserError("MISSING_INPUT", "Invalid user ID format.", 400);
  }

  if (normalizedBlockerId === normalizedTargetId) {
    throw new BlockUserError("CANNOT_BLOCK_SELF", "You cannot block yourself.", 400);
  }

  const [userLow, userHigh]: [string, string] =
    normalizedBlockerId < normalizedTargetId
      ? [normalizedBlockerId, normalizedTargetId]
      : [normalizedTargetId, normalizedBlockerId];

  try {
    const wasFriends = await withTx(async (tx) => {
      const [targetUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, normalizedTargetId))
        .limit(1);

      if (!targetUser) {
        throw new BlockUserError("USER_NOT_FOUND", "User not found.", 404);
      }

      await tx.insert(blockedUsers).values({
        blockerId: normalizedBlockerId,
        blockedId: normalizedTargetId,
      });

      const [deletedFriendship] = await tx
        .delete(friendships)
        .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
        .returning({ userLow: friendships.userLow });

      return !!deletedFriendship;
    });

    if (wasFriends) {
      const unfriendPayload = {
        type: "FRIENDSHIP_STATUS_CHANGED" as const,
        payload: { partnerId: "", isFriend: false },
      };

      wsPublisher.sendToUser(normalizedBlockerId, {
        ...unfriendPayload,
        payload: { partnerId: normalizedTargetId, isFriend: false },
      });

      wsPublisher.sendToUser(normalizedTargetId, {
        ...unfriendPayload,
        payload: { partnerId: normalizedBlockerId, isFriend: false },
      });
    }
  } catch (error) {
    if (error instanceof BlockUserError) {
      throw error;
    }

    if (isPgError(error) && error.code === "23505") {
      throw new BlockUserError("ALREADY_BLOCKED", "You have already blocked this user.", 409);
    }

    console.error(`[ERROR] Unexpected error in use case: Block user\n${error}`);
    throw new BlockUserError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
