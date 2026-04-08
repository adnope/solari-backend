import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendNicknames } from "../../db/schema.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";

export type NicknameEntry = {
  targetId: string;
  nickname: string;
};

export type GetAllNicknamesResult = {
  nicknames: NicknameEntry[];
};

export type GetAllNicknamesErrorType = "MISSING_INPUT" | "INVALID_FORMAT" | "INTERNAL_ERROR";

export class GetAllNicknamesError extends Error {
  readonly type: GetAllNicknamesErrorType;
  readonly statusCode: number;

  constructor(type: GetAllNicknamesErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "GetAllNicknamesError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function getAllNicknames(setterId: string): Promise<GetAllNicknamesResult> {
  const normalizedSetterId = setterId.trim();

  if (!normalizedSetterId) {
    throw new GetAllNicknamesError("MISSING_INPUT", "User ID is required.", 400);
  }

  if (!isValidUuid(normalizedSetterId)) {
    throw new GetAllNicknamesError("INVALID_FORMAT", "Invalid user ID format.", 400);
  }

  try {
    const results = await db
      .select({
        targetId: friendNicknames.targetId,
        nickname: friendNicknames.nickname,
      })
      .from(friendNicknames)
      .where(eq(friendNicknames.setterId, normalizedSetterId));

    return {
      nicknames: results,
    };
  } catch (error: unknown) {
    if (error instanceof GetAllNicknamesError) throw error;

    if (isPgErrorCode(error, PgErrorCode.INVALID_TEXT_REPRESENTATION)) {
      throw new GetAllNicknamesError("INVALID_FORMAT", "Invalid ID format.", 400);
    }

    console.error(`[ERROR] Unexpected error in use case: Get all nicknames\n`, error);
    throw new GetAllNicknamesError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
