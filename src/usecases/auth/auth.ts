import type { ContentfulStatusCode } from "hono/utils/http-status";
import { randomBytes } from "node:crypto";
import { withDb } from "../../db/postgres_client.ts";
import { createAccessToken } from "../../lib/jwt.ts";
import { isPgError } from "../postgres_error.ts";

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
  createdAt: Date;
};

export type SigninResult = {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
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
  readonly statusCode: ContentfulStatusCode;

  constructor(type: AuthErrorType, message: string, statusCode: ContentfulStatusCode) {
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
  display_name: string | null;
  avatar_key: string | null;
  created_at: Date;
};

type UserAuthRow = UserRow & {
  password_hash: string | null;
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
    displayName: row.display_name,
    avatarKey: row.avatar_key,
    createdAt: row.created_at,
  };
}

function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

function sha256Hex(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

export async function signUp(input: SignupInput): Promise<PublicUser> {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);

  const passwordHash = await Bun.password.hash(password);

  const userId = Bun.randomUUIDv7();

  try {
    return await withDb(async (client) => {
      return await client.begin(async (tx) => {
        const result = await tx<UserRow[]>`
          INSERT INTO users (
            id,
            username,
            email
          )
          VALUES (${userId}, ${username}, ${email})
          RETURNING
            id,
            username,
            email,
            display_name,
            avatar_key,
            created_at
        `;

        const row = result[0];
        if (!row) {
          throw new AuthError("INTERNAL_ERROR", "Failed to create user.", 500);
        }

        await tx`
          INSERT INTO user_passwords (user_id, password_hash)
          VALUES (${userId}, ${passwordHash})
        `;

        return mapUser(row);
      });
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      throw error;
    }

    if (isPgError(error) && error.code === "23505") {
      const constraint = error.constraint || error.constraint_name;
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
    return await withDb(async (client) => {
      const userResult = await client<UserAuthRow[]>`
        SELECT
          u.id,
          u.username,
          u.email,
          u.display_name,
          u.avatar_key,
          up.password_hash,
          u.created_at
        FROM users u
        LEFT JOIN user_passwords up ON up.user_id = u.id
        WHERE u.username = ${identifier} OR u.email = ${identifier}
        LIMIT 1
      `;

      const row = userResult[0];
      if (!row) {
        throw new AuthError("INVALID_CREDENTIALS", "Invalid username/email or password.", 401);
      }

      if (!row.password_hash) {
        throw new AuthError(
          "INVALID_CREDENTIALS",
          "Please sign in using your linked third-party account.",
          401,
        );
      }

      const ok = await Bun.password.verify(password, row.password_hash);
      if (!ok) {
        throw new AuthError("INVALID_CREDENTIALS", "Invalid username/email or password.", 401);
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

      const sessionId = Bun.randomUUIDv7();
      const refreshToken = generateSecureToken();
      const refreshTokenHash = sha256Hex(refreshToken);

      await client`
        INSERT INTO sessions (
          id,
          user_id,
          refresh_token_hash,
          created_at,
          last_used_at,
          expires_at
        )
        VALUES (${sessionId}, ${row.id}, ${refreshTokenHash}, ${now}, ${now}, ${expiresAt})
      `;

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
    });
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

export async function logOut(sessionId: string, deviceToken?: string): Promise<boolean> {
  sessionId = sessionId.trim();

  if (!sessionId) {
    throw new AuthError("MISSING_SESSION_ID", "Session id is missing.", 400);
  }

  try {
    return await withDb(async (client) => {
      const result = await client<{ id: string }[]>`
        DELETE FROM sessions
        WHERE id = ${sessionId}
        RETURNING id
      `;

      if (result.length === 0) {
        throw new AuthError("SESSION_NOT_FOUND", "Session not found.", 404);
      }

      if (deviceToken) {
        const normalizedToken = deviceToken.trim();
        if (normalizedToken) {
          await client`
            DELETE FROM user_devices
            WHERE device_token = ${normalizedToken}
          `;
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
  userId = userId.trim();

  if (!userId) {
    throw new AuthError("MISSING_USER_ID", "User id is missing.", 400);
  }

  try {
    return await withDb(async (client) => {
      const result = await client<UserRow[]>`
        SELECT
          id,
          username,
          email,
          display_name,
          avatar_key,
          created_at
        FROM users
        WHERE id = ${userId}
        LIMIT 1
      `;

      const row = result[0];
      if (!row) {
        throw new AuthError("USER_NOT_FOUND", "User not found.", 404);
      }

      return mapUser(row);
    });
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
