import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { passwordResetCodes, users } from "../../db/schema.ts";

export type VerifyPasswordResetCodeInput = {
  email: string;
  code: string;
};

export type VerifyPasswordResetCodeResult = {
  verified: true;
};

export type VerifyPasswordResetCodeErrorType =
  | "MISSING_EMAIL"
  | "INVALID_EMAIL"
  | "MISSING_CODE"
  | "INVALID_CODE"
  | "INTERNAL_ERROR";

export class VerifyPasswordResetCodeError extends Error {
  readonly type: VerifyPasswordResetCodeErrorType;
  readonly statusCode: number;

  constructor(type: VerifyPasswordResetCodeErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "VerifyPasswordResetCodeError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const MAX_ATTEMPTS = 5;

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();

  if (value.length === 0) {
    throw new VerifyPasswordResetCodeError("MISSING_EMAIL", "Email is required.", 400);
  }

  const rfc2822Regex =
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

  if (!rfc2822Regex.test(value)) {
    throw new VerifyPasswordResetCodeError("INVALID_EMAIL", "Invalid email format.", 400);
  }

  return value;
}

function normalizeCode(code: string): string {
  const value = code.trim();

  if (value.length === 0) {
    throw new VerifyPasswordResetCodeError("MISSING_CODE", "Code is required.", 400);
  }

  if (!/^\d{6}$/.test(value)) {
    throw new VerifyPasswordResetCodeError("INVALID_CODE", "Code must be a 6-digit number.", 400);
  }

  return value;
}

export async function verifyPasswordResetCode(
  input: VerifyPasswordResetCodeInput,
): Promise<VerifyPasswordResetCodeResult> {
  const email = normalizeEmail(input.email);
  const code = normalizeCode(input.code);

  try {
    const [user] = await db
      .select({
        id: users.id,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      throw new VerifyPasswordResetCodeError("INVALID_CODE", "Invalid or expired reset code.", 400);
    }

    const [resetRow] = await db
      .select({
        id: passwordResetCodes.id,
        codeHash: passwordResetCodes.codeHash,
        expiresAt: passwordResetCodes.expiresAt,
        verifiedAt: passwordResetCodes.verifiedAt,
        usedAt: passwordResetCodes.usedAt,
        attemptCount: passwordResetCodes.attemptCount,
      })
      .from(passwordResetCodes)
      .where(
        and(
          eq(passwordResetCodes.userId, user.id),
          isNull(passwordResetCodes.usedAt),
          gt(passwordResetCodes.expiresAt, new Date().toISOString()),
        ),
      )
      .orderBy(sql`${passwordResetCodes.createdAt} DESC`)
      .limit(1);

    if (!resetRow) {
      throw new VerifyPasswordResetCodeError("INVALID_CODE", "Invalid or expired reset code.", 400);
    }

    if (resetRow.attemptCount >= MAX_ATTEMPTS) {
      throw new VerifyPasswordResetCodeError("INVALID_CODE", "Invalid or expired reset code.", 400);
    }

    const ok = await Bun.password.verify(code, resetRow.codeHash);

    if (!ok) {
      const nextAttemptCount = resetRow.attemptCount + 1;

      await db
        .update(passwordResetCodes)
        .set({
          attemptCount: nextAttemptCount,
          ...(nextAttemptCount >= MAX_ATTEMPTS ? { usedAt: new Date().toISOString() } : {}),
        })
        .where(eq(passwordResetCodes.id, resetRow.id));

      throw new VerifyPasswordResetCodeError("INVALID_CODE", "Invalid or expired reset code.", 400);
    }

    if (!resetRow.verifiedAt) {
      await db
        .update(passwordResetCodes)
        .set({
          verifiedAt: new Date().toISOString(),
        })
        .where(eq(passwordResetCodes.id, resetRow.id));
    }

    return {
      verified: true,
    };
  } catch (error) {
    if (error instanceof VerifyPasswordResetCodeError) {
      throw error;
    }

    throw new VerifyPasswordResetCodeError(
      "INTERNAL_ERROR",
      "Internal server error verifying password reset code.",
      500,
    );
  }
}
