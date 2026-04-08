// import { DrizzleQueryError } from "drizzle-orm/errors";

// export type PgLikeError = Error & {
//   code?: string;
//   constraint?: string;
//   constraint_name?: string;
//   detail?: string;
//   fields?: {
//     code?: string;
//     constraint?: string;
//     constraint_name?: string;
//     [key: string]: unknown;
//   };
// };

// export function unwrapDbError(error: unknown): PgLikeError | null {
//   if (error instanceof DrizzleQueryError && error.cause && typeof error.cause === "object") {
//     return error.cause as PgLikeError;
//   }

//   if (typeof error === "object" && error !== null) {
//     return error as PgLikeError;
//   }

//   return null;
// }

// export function isPgError(error: unknown): error is PgLikeError & { code: string } {
//   const target = unwrapDbError(error);
//   if (!target) return false;

//   const code = target.code ?? target.fields?.code;

//   if (typeof code !== "string") {
//     return false;
//   }

//   target.code = code;

//   const constraint =
//     target.constraint ??
//     target.constraint_name ??
//     target.fields?.constraint ??
//     target.fields?.constraint_name;

//   if (typeof constraint === "string") {
//     target.constraint = constraint;
//   }

//   return true;
// }

export const PgErrorCode = {
  NOT_NULL_VIOLATION: "23502",
  FOREIGN_KEY_VIOLATION: "23503",
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
  INVALID_TEXT_REPRESENTATION: "22P02",
} as const;

export type PgErrorCodeType = (typeof PgErrorCode)[keyof typeof PgErrorCode];

export function getPgErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const errObj = error as Record<string, unknown>;

  if ("code" in errObj && typeof errObj["code"] === "string") return errObj["code"];

  if ("cause" in errObj) {
    const cause = errObj["cause"];
    if (typeof cause === "object" && cause !== null) {
      const causeObj = cause as Record<string, unknown>;
      if ("code" in causeObj && typeof causeObj["code"] === "string") return causeObj["code"];
    }
  }
  return null;
}

export function isPgErrorCode(error: unknown, code: PgErrorCodeType): boolean {
  return getPgErrorCode(error) === code;
}

export function getPgConstraintName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;

  const errObj = error as Record<string, unknown>;

  const extractName = (obj: Record<string, unknown>) => {
    if ("constraint_name" in obj && typeof obj["constraint_name"] === "string")
      return obj["constraint_name"];
    if ("constraint" in obj && typeof obj["constraint"] === "string") return obj["constraint"];
    return null;
  };

  const rawName = extractName(errObj);
  if (rawName) return rawName;

  if ("cause" in errObj) {
    const cause = errObj["cause"];
    if (typeof cause === "object" && cause !== null) {
      return extractName(cause as Record<string, unknown>);
    }
  }

  return null;
}
