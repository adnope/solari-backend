import { and, eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db, withTx } from "../../db/client.ts";
import { sessions, userDevices, userPasswords, users } from "../../db/migrations/schema.ts";
import { createAccessToken } from "../../lib/jwt.ts";
import { isPgError, unwrapDbError } from "../postgres_error.ts";

export type SignupInput = {
  username: string;
  email: string;
  password: string;
};

export type SigninInput = {
  identifier: string; // username or email
  password: string;
};

export type PublicUser = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarKey: string | null;
  createdAt: string;
};

export type SigninResult = {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type AuthErrorType =
  | "MISSING_USERNAME"
  | "INVALID_USERNAME"
  | "MISSING_EMAIL"
  | "INVALID_EMAIL"
  | "MISSING_IDENTIFIER"
  | "MISSING_PASSWORD"
  | "WEAK_PASSWORD"
  | "USERNAME_TAKEN"
  | "EMAIL_TAKEN"
  | "IDENTIFIER_ALREADY_IN_USE"
  | "INVALID_CREDENTIALS"
  | "MISSING_SESSION_ID"
  | "SESSION_NOT_FOUND"
  | "MISSING_USER_ID"
  | "USER_NOT_FOUND"
  | "INTERNAL_ERROR";

export class AuthError extends Error {
  readonly type: AuthErrorType;
  readonly statusCode: number;

  constructor(type: AuthErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "AuthError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

type UserRow = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarKey: string | null;
  createdAt: string;
};

type UserAuthRow = UserRow & {
  passwordHash: string | null;
};

const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function normalizeUsername(username: string): string {
  const value = username.trim();

  if (value.length === 0) {
    throw new AuthError("MISSING_USERNAME", "Username is required.", 400);
  }

  if (value.length < 4 || value.length > 32) {
    throw new AuthError("INVALID_USERNAME", "Username must be between 4 and 32 characters.", 400);
  }

  if (!/^[a-zA-Z0-9_.]+$/.test(value)) {
    throw new AuthError(
      "INVALID_USERNAME",
      "Username may contain only letters, numbers, underscores, and dots.",
      400,
    );
  }

  return value;
}

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();

  if (value.length === 0) {
    throw new AuthError("MISSING_EMAIL", "Email is required.", 400);
  }

  const rfc2822Regex =
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

  if (!rfc2822Regex.test(value)) {
    throw new AuthError("INVALID_EMAIL", "Invalid email format.", 400);
  }

  return value;
}

function normalizeIdentifier(identifier: string): string {
  const value = identifier.trim();

  if (value.length === 0) {
    throw new AuthError("MISSING_IDENTIFIER", "Username or email is required.", 400);
  }

  return value;
}

function validatePassword(password: string): string {
  if (password.length === 0) {
    throw new AuthError("MISSING_PASSWORD", "Password is required.", 400);
  }

  if (password.length < 6) {
    throw new AuthError("WEAK_PASSWORD", "Password must be at least 6 characters.", 400);
  }

  return password;
}

function requirePassword(password: string): string {
  if (password.length === 0) {
    throw new AuthError("MISSING_PASSWORD", "Password is required.", 400);
  }

  return password;
}

function mapUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.displayName,
    avatarKey: row.avatarKey,
    createdAt: row.createdAt,
  };
}

function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function signUp(input: SignupInput): Promise<PublicUser> {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);

  const passwordHash = await Bun.password.hash(password, {
    algorithm: "argon2id",
  });
  const userId = Bun.randomUUIDv7();

  try {
    return await withTx(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          id: userId,
          username,
          email,
        })
        .returning({
          id: users.id,
          username: users.username,
          email: users.email,
          displayName: users.displayName,
          avatarKey: users.avatarKey,
          createdAt: users.createdAt,
        });

      if (!user) {
        throw new AuthError("INTERNAL_ERROR", "Failed to create user.", 500);
      }

      await tx.insert(userPasswords).values({
        userId,
        passwordHash,
      });

      return mapUser(user);
    });
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    const pgError = unwrapDbError(error);
    if (isPgError(error) && pgError?.code === "23505") {
      const constraint =
        pgError.constraint ??
        pgError.constraint_name ??
        pgError.fields?.constraint ??
        pgError.fields?.constraint_name;

      if (constraint === "users_username_key") {
        throw new AuthError("USERNAME_TAKEN", "Username is already taken.", 409);
      }
      if (constraint === "users_email_key") {
        throw new AuthError("EMAIL_TAKEN", "Email is already in use.", 409);
      }

      throw new AuthError("IDENTIFIER_ALREADY_IN_USE", "Username or email is already in use.", 409);
    }

    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
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

    const user: UserAuthRow = {
      id: row.id,
      username: row.username,
      email: row.email,
      displayName: row.displayName,
      avatarKey: row.avatarKey,
      createdAt: row.createdAt,
      passwordHash: row.passwordHash,
    };

    if (!user.passwordHash) {
      throw new AuthError(
        "INVALID_CREDENTIALS",
        "Please sign in using your linked third-party account.",
        401,
      );
    }

    const ok = await Bun.password.verify(password, user.passwordHash);
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
      userId: user.id,
      refreshTokenHash,
      createdAt: nowIso,
      lastUsedAt: nowIso,
      expiresAt,
    });

    const accessToken = createAccessToken({
      sub: user.id,
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

    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

export async function logOut(sessionId: string, deviceToken?: string): Promise<boolean> {
  const normalizedSessionId = sessionId.trim();

  if (!normalizedSessionId) {
    throw new AuthError("MISSING_SESSION_ID", "Session id is missing.", 400);
  }

  try {
    return await withTx(async (tx) => {
      const [deletedSession] = await tx
        .delete(sessions)
        .where(eq(sessions.id, normalizedSessionId))
        .returning({
          id: sessions.id,
          userId: sessions.userId,
        });

      if (!deletedSession) {
        throw new AuthError("SESSION_NOT_FOUND", "Session not found.", 404);
      }

      if (deviceToken) {
        const normalizedToken = deviceToken.trim();

        if (normalizedToken) {
          await tx
            .delete(userDevices)
            .where(
              and(
                eq(userDevices.userId, deletedSession.userId),
                eq(userDevices.deviceToken, normalizedToken),
              ),
            );
        }
      }

      return true;
    });
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

export async function me(userId: string): Promise<PublicUser> {
  const normalizedUserId = userId.trim();

  if (!normalizedUserId) {
    throw new AuthError("MISSING_USER_ID", "User id is missing.", 400);
  }

  try {
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, normalizedUserId))
      .limit(1);

    if (!user) {
      throw new AuthError("USER_NOT_FOUND", "User not found.", 404);
    }

    return mapUser(user);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
