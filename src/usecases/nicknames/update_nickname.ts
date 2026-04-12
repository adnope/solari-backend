import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendNicknames } from "../../db/schema.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";

export type UpdateNicknameResult = {
  success: boolean;
  nickname: string;
};

export type UpdateNicknameErrorType =
  | "MISSING_INPUT"
  | "INVALID_FORMAT"
  | "NICKNAME_NOT_FOUND"
  | "INTERNAL_ERROR";

export class UpdateNicknameError extends Error {
  readonly type: UpdateNicknameErrorType;
  readonly statusCode: number;

  constructor(type: UpdateNicknameErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "UpdateNicknameError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function updateNickname(
  setterId: string,
  targetId: string,
  newNickname: string,
): Promise<UpdateNicknameResult> {
  const normalizedSetterId = setterId.trim();
  const normalizedTargetId = targetId.trim();
  const trimmedNickname = newNickname.trim();

  if (!normalizedSetterId || !normalizedTargetId || !trimmedNickname) {
    throw new UpdateNicknameError("MISSING_INPUT", "User IDs and nickname are required.", 400);
  }

  if (!isValidUuid(normalizedSetterId) || !isValidUuid(normalizedTargetId)) {
    throw new UpdateNicknameError("INVALID_FORMAT", "Invalid user ID format.", 400);
  }

  try {
    const [updatedRecord] = await db
      .update(friendNicknames)
      .set({
        nickname: trimmedNickname,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(friendNicknames.setterId, normalizedSetterId),
          eq(friendNicknames.targetId, normalizedTargetId),
        ),
      )
      .returning({ nickname: friendNicknames.nickname });

    if (!updatedRecord) {
      throw new UpdateNicknameError(
        "NICKNAME_NOT_FOUND",
        "No existing nickname found to update.",
        404,
      );
    }

    return { success: true, nickname: updatedRecord.nickname };
  } catch (error) {
    if (error instanceof UpdateNicknameError) throw error;

    if (isPgErrorCode(error, PgErrorCode.FOREIGN_KEY_VIOLATION)) {
      throw new UpdateNicknameError("NICKNAME_NOT_FOUND", "User no longer exists.", 404);
    }

    console.error(`[ERROR] Unexpected error in use case: Update nickname\n${error}`);
    throw new UpdateNicknameError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
