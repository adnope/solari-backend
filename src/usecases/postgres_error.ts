export type PgError = Error & {
  code?: string;
  message?: string;
  constraint?: string;
  detail?: string;
  table_name?: string;
  column_name?: string;
  [key: string]: unknown;
};

export function isPgError(error: unknown): error is PgError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return "code" in error && typeof (error as Record<string, unknown>).code === "string";
}
