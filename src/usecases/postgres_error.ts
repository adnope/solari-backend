import { DrizzleQueryError } from "drizzle-orm/errors";

export const PgErrorCode = {
  NOT_NULL_VIOLATION: "23502",
  FOREIGN_KEY_VIOLATION: "23503",
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
  INVALID_TEXT_REPRESENTATION: "22P02",
} as const;

export type PgErrorCodeType = (typeof PgErrorCode)[keyof typeof PgErrorCode];

type PgLikeError = Error & {
  code?: string;
  constraint?: string;
  constraint_name?: string;
};

function unwrapDbError(error: unknown): PgLikeError | null {
  if (error instanceof DrizzleQueryError && error.cause && typeof error.cause === "object") {
    return error.cause as PgLikeError;
  }

  if (error instanceof Error && "code" in error) {
    return error as PgLikeError;
  }

  return null;
}

export function getPgErrorCode(error: unknown): string | null {
  const pgError = unwrapDbError(error);
  if (!pgError?.code) return null;
  return pgError.code;
}

export function isPgErrorCode(error: unknown, code: PgErrorCodeType): boolean {
  return getPgErrorCode(error) === code;
}

export function getPgConstraintName(error: unknown): string | null {
  const pgError = unwrapDbError(error);
  if (!pgError) return null;
  return pgError.constraint ?? pgError.constraint_name ?? null;
}
