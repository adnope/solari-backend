import { DrizzleQueryError } from "drizzle-orm/errors";

export type PgLikeError = Error & {
  code?: string;
  constraint?: string;
  constraint_name?: string;
  detail?: string;
  fields?: {
    code?: string;
    constraint?: string;
    constraint_name?: string;
    [key: string]: unknown;
  };
};

export function unwrapDbError(error: unknown): PgLikeError | null {
  if (error instanceof DrizzleQueryError && error.cause && typeof error.cause === "object") {
    return error.cause as PgLikeError;
  }

  if (typeof error === "object" && error !== null) {
    return error as PgLikeError;
  }

  return null;
}

export function isPgError(error: unknown): error is PgLikeError & { code: string } {
  const target = unwrapDbError(error);
  if (!target) return false;

  const code = target.code ?? target.fields?.code;

  if (typeof code !== "string") {
    return false;
  }

  target.code = code;

  const constraint =
    target.constraint ??
    target.constraint_name ??
    target.fields?.constraint ??
    target.fields?.constraint_name;

  if (typeof constraint === "string") {
    target.constraint = constraint;
  }

  return true;
}
