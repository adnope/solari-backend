export type PgError = {
  fields: {
    code?: string;
    message?: string;
    constraint?: string;
    [key: string]: unknown;
  };
  query?: unknown;
};

export function isPgError(error: unknown): error is PgError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if (!("fields" in error)) {
    return false;
  }

  const fields = (error as { fields?: unknown }).fields;

  if (typeof fields !== "object" || fields === null) {
    return false;
  }

  return "code" in fields;
}