import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, withTx } from "../../db/client.ts";
import { passwordResetCodes, userOauthAccounts, userPasswords, users } from "../../db/schema.ts";
import { enqueueSendEmail } from "../../jobs/queue.ts";
import { createUuidV7 } from "../../utils/ids.ts";
import { hashPassword } from "../../utils/password.ts";
import { isValidEmail } from "../../utils/validation.ts";
import { AppError } from "../app_error.ts";

export type RequestPasswordResetCodeErrorType =
  | "MISSING_EMAIL"
  | "INVALID_EMAIL"
  | "LINKED_GOOGLE_ACCOUNT"
  | "INTERNAL_ERROR";

const RESET_CODE_TTL_MS = 1000 * 60 * 5;

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();

  if (value.length === 0) {
    throw new AppError<RequestPasswordResetCodeErrorType>(
      "MISSING_EMAIL",
      "Email is required.",
      400,
    );
  }

  if (!isValidEmail(value)) {
    throw new AppError<RequestPasswordResetCodeErrorType>(
      "INVALID_EMAIL",
      "Invalid email format.",
      400,
    );
  }

  return value;
}

function generateSixDigitCode(): string {
  return randomInt(100001, 999_999).toString();
}

export async function requestPasswordResetCode(email: string): Promise<void> {
  email = normalizeEmail(email);

  try {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        passwordHash: userPasswords.passwordHash,
        googleProviderUserId: userOauthAccounts.providerUserId,
      })
      .from(users)
      .leftJoin(userPasswords, eq(userPasswords.userId, users.id))
      .leftJoin(
        userOauthAccounts,
        and(eq(userOauthAccounts.userId, users.id), eq(userOauthAccounts.provider, "google")),
      )
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return;
    }

    if (user.googleProviderUserId) {
      throw new AppError<RequestPasswordResetCodeErrorType>(
        "LINKED_GOOGLE_ACCOUNT",
        "This account uses Google sign-in and does not have a password to reset.",
        400,
      );
    }

    const rawCode = generateSixDigitCode();
    const codeHash = await hashPassword(rawCode);
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();

    const resetCodeId = createUuidV7();
    await withTx(async (tx) => {
      await tx.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, user.id));

      await tx.insert(passwordResetCodes).values({
        id: resetCodeId,
        userId: user.id,
        codeHash,
        expiresAt,
        attemptCount: 0,
      });
    });

    await enqueueSendEmail(
      {
        emailType: "PASSWORD_RESET",
        to: user.email,
        username: user.displayName || user.username,
        code: rawCode,
      },
      `send-email-password-reset-${resetCodeId}`,
    );
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Request password reset code\n${error}`);
    throw new AppError<RequestPasswordResetCodeErrorType>(
      "INTERNAL_ERROR",
      "Internal server error requesting password reset code.",
      500,
    );
  }
}
