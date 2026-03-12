import { Elysia } from "elysia";
import { AuthorizationError } from "./middleware/require_auth.ts";

type ErrorConstructor = new (...args: any[]) => Error;
type ErrorRegistry = Record<string, ErrorConstructor>;

type ApiErrorHandlerOptions = {
  validationErrorType?: string;
};

type TypedAppError = Error & {
  type: string;
  statusCode: number;
};

const isTypedAppError = (error: unknown): error is TypedAppError => {
  return (
    error instanceof Error &&
    "type" in error &&
    "statusCode" in error &&
    typeof error.type === "string" &&
    typeof error.statusCode === "number"
  );
};

function getValidationMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeSummary = (error as { summary?: unknown }).summary;
    if (typeof maybeSummary === "string" && maybeSummary.trim()) {
      return maybeSummary;
    }

    const maybeErrors = (error as { all?: unknown }).all;
    if (Array.isArray(maybeErrors) && maybeErrors.length > 0) {
      const first = maybeErrors[0] as { summary?: unknown; message?: unknown } | undefined;
      if (first && typeof first.summary === "string" && first.summary.trim()) {
        return first.summary;
      }
      if (first && typeof first.message === "string" && first.message.trim()) {
        return first.message;
      }
    }
  }

  return "Invalid request input.";
}

export const withApiErrorHandler = (
  app: Elysia,
  errors: ErrorRegistry = {},
  options: ApiErrorHandlerOptions = {},
) =>
  app
    .error({
      AuthorizationError,
      ...errors,
    })
    .onError(({ code, error, set }) => {
      const validationErrorType = options.validationErrorType ?? "INVALID_INPUT";

      if (code === "VALIDATION") {
        set.status = 400;
        return {
          error: {
            type: validationErrorType,
            message: getValidationMessage(error),
          },
        };
      }

      if (error instanceof AuthorizationError) {
        set.status = 401;
        return {
          error: {
            type: "UNAUTHORIZED",
            message: error.message,
          },
        };
      }

      if (isTypedAppError(error)) {
        set.status = error.statusCode;
        return {
          error: {
            type: error.type,
            message: error.message,
          },
        };
      }

      set.status = 500;
      return {
        error: {
          type: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Internal server error.",
        },
      };
    });
