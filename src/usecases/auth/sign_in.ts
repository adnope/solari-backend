import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../../db/client.ts";
import { sessions, userPasswords, users } from "../../db/schema.ts";
import { createAccessToken } from "../../lib/jwt.ts";
import { AuthError } from "./error_type.ts";

export type SigninInput = {
  identifier: string; // username or email
  password: string;
};
export type SigninResult = {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function normalizeIdentifier(identifier: string): string {
  const value = identifier.trim();

  if (value.length === 0) {
    throw new AuthError("MISSING_IDENTIFIER", "Username or email is required.", 400);
  }

  return value;
}

function requirePassword(password: string): string {
  if (password.length === 0) {
    throw new AuthError("MISSING_PASSWORD", "Password is required.", 400);
  }

  return password;
}

function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function signIn(input: SigninInput): Promise<SigninResult> {
  const identifier = normalizeIdentifier(input.identifier);
  const password = requirePassword(input.password);

  try {
    const userLookupCondition = identifier.includes("@")
      ? eq(users.email, identifier)
      : eq(users.username, identifier);

    const [row] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
        createdAt: users.createdAt,
        passwordHash: userPasswords.passwordHash,
      })
      .from(users)
      .leftJoin(userPasswords, eq(userPasswords.userId, users.id))
      .where(userLookupCondition)
      .limit(1);

    if (!row) {
      throw new AuthError("INVALID_CREDENTIALS", "Invalid username/email or password.", 401);
    }

    if (!row.passwordHash) {
      throw new AuthError(
        "LINKED_THIRD_PARTY_ACCOUNT",
        "Please sign in using your linked third-party account.",
        401,
      );
    }

    const ok = await Bun.password.verify(password, row.passwordHash);
    if (!ok) {
      throw new AuthError("INVALID_CREDENTIALS", "Invalid username/email or password.", 401);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString();

    const sessionId = Bun.randomUUIDv7();
    const refreshToken = generateSecureToken();
    const refreshTokenHash = sha256Hex(refreshToken);

    await db.insert(sessions).values({
      id: sessionId,
      userId: row.id,
      refreshTokenHash,
      createdAt: nowIso,
      lastUsedAt: nowIso,
      expiresAt,
    });

    const accessToken = createAccessToken({
      sub: row.id,
      sid: sessionId,
      type: "access",
    });

    return {
      sessionId,
      accessToken,
      refreshToken,
      expiresAt,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Sign in\n${error}`)
    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
