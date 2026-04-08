import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendNicknames } from "../../db/schema.ts";

export type RemoveNicknameResult = {
  success: boolean;
};

export type RemoveNicknameErrorType = "MISSING_INPUT" | "INVALID_FORMAT" | "INTERNAL_ERROR";

export class RemoveNicknameError extends Error {
  readonly type: RemoveNicknameErrorType;
  readonly statusCode: number;

  constructor(type: RemoveNicknameErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "RemoveNicknameError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function removeNickname(
  setterId: string,
  targetId: string,
): Promise<RemoveNicknameResult> {
  const normalizedSetterId = setterId.trim();
  const normalizedTargetId = targetId.trim();

  if (!normalizedSetterId || !normalizedTargetId) {
    throw new RemoveNicknameError("MISSING_INPUT", "User IDs are required.", 400);
  }

  if (!isValidUuid(normalizedSetterId) || !isValidUuid(normalizedTargetId)) {
    throw new RemoveNicknameError("INVALID_FORMAT", "Invalid user ID format.", 400);
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

    return { success: true };
  } catch (error) {
    if (error instanceof RemoveNicknameError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Remove nickname\n${error}`);
    throw new RemoveNicknameError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
