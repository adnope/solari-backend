import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, withTx } from "../../db/client.ts";
import { passwordResetCodes, users } from "../../db/schema.ts";
import { sendPasswordResetCodeEmail } from "../../utils/send_password_reset_email.ts";

export type RequestPasswordResetCodeErrorType =
  | "MISSING_EMAIL"
  | "INVALID_EMAIL"
  | "INTERNAL_ERROR";

export class RequestPasswordResetCodeError extends Error {
  readonly type: RequestPasswordResetCodeErrorType;
  readonly statusCode: number;

  constructor(type: RequestPasswordResetCodeErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "RequestPasswordResetCodeError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const RESET_CODE_TTL_MS = 1000 * 60 * 5;

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();

  if (value.length === 0) {
    throw new RequestPasswordResetCodeError("MISSING_EMAIL", "Email is required.", 400);
  }

  const rfc2822Regex =
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

  if (!rfc2822Regex.test(value)) {
    throw new RequestPasswordResetCodeError("INVALID_EMAIL", "Invalid email format.", 400);
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
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return;
    }

    const rawCode = generateSixDigitCode();
    const codeHash = await Bun.password.hash(rawCode, {
      algorithm: "argon2id",
    });
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();

    await withTx(async (tx) => {
      await tx.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, user.id));

      await tx.insert(passwordResetCodes).values({
        id: Bun.randomUUIDv7(),
        userId: user.id,
        codeHash,
        expiresAt,
        attemptCount: 0,
      });
    });

    await sendPasswordResetCodeEmail({
      to: user.email,
      username: user.displayName || user.username,
      code: rawCode,
    });
  } catch (error) {
    if (error instanceof RequestPasswordResetCodeError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Request password reset code\n${error}`);
    throw new RequestPasswordResetCodeError(
      "INTERNAL_ERROR",
      "Internal server error requesting password reset code.",
      500,
    );
  }
}
