import { and, eq, ne } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { sessions, userPasswords, users } from "../../db/schema.ts";

export type UpdatePasswordInput = {
  userId: string;
  currentSessionId: string;
  oldPassword: string;
  newPassword: string;
};

export type UpdatePasswordErrorType =
  | "MISSING_USER_ID"
  | "MISSING_SESSION_ID"
  | "MISSING_OLD_PASSWORD"
  | "MISSING_NEW_PASSWORD"
  | "WEAK_PASSWORD"
  | "INVALID_OLD_PASSWORD"
  | "PASSWORD_NOT_SET"
  | "USER_NOT_FOUND"
  | "INTERNAL_ERROR";

export class UpdatePasswordError extends Error {
  readonly type: UpdatePasswordErrorType;
  readonly statusCode: number;

  constructor(type: UpdatePasswordErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "UpdatePasswordError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function normalizeUserId(userId: string): string {
  const value = userId.trim();

  if (!value) {
    throw new UpdatePasswordError("MISSING_USER_ID", "User ID is required.", 400);
  }

  if (!isValidUuid(value)) {
    throw new UpdatePasswordError("MISSING_USER_ID", "Invalid user ID format.", 400);
  }

  return value;
}

function normalizeSessionId(sessionId: string): string {
  const value = sessionId.trim();

  if (!value) {
    throw new UpdatePasswordError("MISSING_SESSION_ID", "Session ID is required.", 400);
  }

  if (!isValidUuid(value)) {
    throw new UpdatePasswordError("MISSING_SESSION_ID", "Invalid session ID format.", 400);
  }

  return value;
}

function requireOldPassword(password: string): string {
  if (password.length === 0) {
    throw new UpdatePasswordError("MISSING_OLD_PASSWORD", "Old password is required.", 400);
  }

  return password;
}

function validateNewPassword(password: string): string {
  if (password.length === 0) {
    throw new UpdatePasswordError("MISSING_NEW_PASSWORD", "New password is required.", 400);
  }

  if (password.length < 6) {
    throw new UpdatePasswordError("WEAK_PASSWORD", "Password must be at least 6 characters.", 400);
  }

  return password;
}

export async function updatePassword(input: UpdatePasswordInput): Promise<void> {
  const userId = normalizeUserId(input.userId);
  const currentSessionId = normalizeSessionId(input.currentSessionId);
  const oldPassword = requireOldPassword(input.oldPassword);
  const newPassword = validateNewPassword(input.newPassword);

  try {
    await withTx(async (tx) => {
      const [row] = await tx
        .select({
          id: users.id,
          passwordHash: userPasswords.passwordHash,
        })
        .from(users)
        .leftJoin(userPasswords, eq(userPasswords.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1);

      if (!row) {
        throw new UpdatePasswordError("USER_NOT_FOUND", "User not found.", 404);
      }

      if (!row.passwordHash) {
        throw new UpdatePasswordError(
          "PASSWORD_NOT_SET",
          "This account does not have a password set. Please sign in using your linked third-party account.",
          400,
        );
      }

      const isOldPasswordValid = await Bun.password.verify(oldPassword, row.passwordHash);
      if (!isOldPasswordValid) {
        throw new UpdatePasswordError("INVALID_OLD_PASSWORD", "Old password is incorrect.", 401);
      }

      const newPasswordHash = await Bun.password.hash(newPassword, {
        algorithm: "argon2id",
      });

      await tx
        .update(userPasswords)
        .set({
          passwordHash: newPasswordHash,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userPasswords.userId, userId));

      await tx
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)));
    });
  } catch (error) {
    if (error instanceof UpdatePasswordError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Update password\n${error}`)
    throw new UpdatePasswordError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
