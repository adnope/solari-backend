import { isValidUuid } from "../../utils/uuid.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";
import { getNickname as getNicknameValue } from "../common_queries.ts";

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
    return {
      nickname: await getNicknameValue(normalizedSetterId, normalizedTargetId),
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
