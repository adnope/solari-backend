export type PgError = Error & {
  code: string;
  constraint?: string;
  fields: {
    code: string;
    message: string;
    constraint?: string;
    [key: string]: unknown;
  };
  query?: unknown;
};

export function isPgError(error: unknown): error is PgError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const target = "cause" in error && typeof error.cause === "object" && error.cause !== null
    ? error.cause
    : error;

  const fields = (target as Record<string, unknown>).fields;
  if (typeof fields !== "object" || fields === null || !("code" in fields)) {
    return false;
  }

  const err = error as Record<string, unknown>;
  const pgFields = fields as Record<string, unknown>;

  err.code = pgFields.code;
  err.constraint = pgFields.constraint;
  err.fields = pgFields;

  return true;
}
