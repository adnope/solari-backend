import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { passwordResetCodes, sessions, userPasswords, users } from "../../db/migrations/schema.ts";

export type ResetPasswordInput = {
  email: string;
  newPassword: string;
};

export type ResetPasswordErrorType =
  | "MISSING_EMAIL"
  | "INVALID_EMAIL"
  | "MISSING_PASSWORD"
  | "INVALID_PASSWORD"
  | "RESET_NOT_VERIFIED"
  | "INTERNAL_ERROR";

export class ResetPasswordError extends Error {
  readonly type: ResetPasswordErrorType;
  readonly statusCode: number;

  constructor(type: ResetPasswordErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ResetPasswordAfterVerifiedCodeError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();

  if (!value) {
    throw new ResetPasswordError("MISSING_EMAIL", "Email required.", 400);
  }

  const rfc2822Regex =
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

  if (!rfc2822Regex.test(value)) {
    throw new ResetPasswordError("INVALID_EMAIL", "Invalid email.", 400);
  }

  return value;
}

function normalizePassword(password: string): string {
  const value = password.trim();

  if (!value) {
    throw new ResetPasswordError("MISSING_PASSWORD", "Password required.", 400);
  }

  if (value.length < 6) {
    throw new ResetPasswordError(
      "INVALID_PASSWORD",
      "Password must be at least 6 characters.",
      400,
    );
  }

  return value;
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.newPassword);

  try {
    await withTx(async (tx) => {
      const [user] = await tx
        .select({
          id: users.id,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        throw new ResetPasswordError("RESET_NOT_VERIFIED", "Password reset not verified.", 400);
      }

      const [resetRow] = await tx
        .select({
          id: passwordResetCodes.id,
        })
        .from(passwordResetCodes)
        .where(
          and(
            eq(passwordResetCodes.userId, user.id),
            isNull(passwordResetCodes.usedAt),
            gt(passwordResetCodes.expiresAt, new Date().toISOString()),
            sql`${passwordResetCodes.verifiedAt} IS NOT NULL`,
          ),
        )
        .orderBy(sql`${passwordResetCodes.createdAt} DESC`)
        .limit(1);

      if (!resetRow) {
        throw new ResetPasswordError("RESET_NOT_VERIFIED", "Password reset not verified.", 400);
      }

      const passwordHash = await Bun.password.hash(password, {
        algorithm: "argon2id",
      });

      await tx
        .insert(userPasswords)
        .values({
          userId: user.id,
          passwordHash,
        })
        .onConflictDoUpdate({
          target: userPasswords.userId,
          set: {
            passwordHash,
          },
        });

      await tx
        .update(passwordResetCodes)
        .set({
          usedAt: new Date().toISOString(),
        })
        .where(eq(passwordResetCodes.id, resetRow.id));

      await tx.delete(sessions).where(eq(sessions.userId, user.id));
    });
  } catch (error) {
    if (error instanceof ResetPasswordError) throw error;

    throw new ResetPasswordError(
      "INTERNAL_ERROR",
      "Internal server error resetting password.",
      500,
    );
  }
}
