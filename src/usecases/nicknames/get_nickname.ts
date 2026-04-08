import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendNicknames } from "../../db/schema.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";

export type GetNicknameResult = {
  nickname: string | null;
};

export type GetNicknameErrorType = "MISSING_INPUT" | "INVALID_FORMAT" | "INTERNAL_ERROR";

export class GetNicknameError extends Error {
  readonly type: GetNicknameErrorType;
  readonly statusCode: number;

  constructor(type: GetNicknameErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "GetNicknameError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function getNickname(setterId: string, targetId: string): Promise<GetNicknameResult> {
  const normalizedSetterId = setterId.trim();
  const normalizedTargetId = targetId.trim();

  if (!normalizedSetterId || !normalizedTargetId) {
    throw new GetNicknameError("MISSING_INPUT", "User IDs are required.", 400);
  }

  if (!isValidUuid(normalizedSetterId) || !isValidUuid(normalizedTargetId)) {
    throw new GetNicknameError("INVALID_FORMAT", "Invalid user ID format.", 400);
  }

  try {
    const [record] = await db
      .select({ nickname: friendNicknames.nickname })
      .from(friendNicknames)
      .where(
        and(
          eq(friendNicknames.setterId, normalizedSetterId),
          eq(friendNicknames.targetId, normalizedTargetId),
        ),
      )
      .limit(1);

    return {
      nickname: record?.nickname ?? null,
    };
  } catch (error: unknown) {
    if (error instanceof GetNicknameError) throw error;

    if (isPgErrorCode(error, PgErrorCode.INVALID_TEXT_REPRESENTATION)) {
      throw new GetNicknameError("INVALID_FORMAT", "Invalid ID format.", 400);
    }

    console.error(`[ERROR] Unexpected error in use case: Get nickname\n`, error);
    throw new GetNicknameError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
