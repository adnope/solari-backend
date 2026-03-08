import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import argon2 from "argon2";
import { withDb } from "../../db/postgres_client.ts";
import { createAccessToken } from "../../lib/jwt.ts";
import { isPgError } from "../postgres_error.ts";
import { newUUIDv7 } from "../../utils/uuid.ts";

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

  constructor(
    type: AuthErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
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
  password_hash: string;
};

const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function normalizeUsername(username: string): string {
  const value = username.trim();

  if (value.length === 0) {
    throw new AuthError("MISSING_USERNAME", "Username is required.", 400);
  }

  if (value.length < 4 || value.length > 32) {
    throw new AuthError(
      "INVALID_USERNAME",
      "Username must be between 4 and 32 characters.",
      400,
    );
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
    throw new AuthError(
      "MISSING_IDENTIFIER",
      "Username or email is required.",
      400,
    );
  }

  return value;
}

function validatePassword(password: string): string {
  if (password.length === 0) {
    throw new AuthError("MISSING_PASSWORD", "Password is required.", 400);
  }

  if (password.length < 6) {
    throw new AuthError(
      "WEAK_PASSWORD",
      "Password must be at least 6 characters.",
      400,
    );
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateSecureToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export async function signUp(input: SignupInput): Promise<PublicUser> {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
  });

  const userId = newUUIDv7();

  try {
    return await withDb(async (client) => {
      const result = await client.queryObject<UserRow>(
        `
        INSERT INTO users (
          id,
          username,
          email,
          password_hash
        )
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          username,
          email,
          display_name,
          avatar_key,
          created_at
        `,
        [userId, username, email, passwordHash],
      );

      const row = result.rows[0];
      if (!row) {
        throw new AuthError(
          "INTERNAL_ERROR",
          "Failed to create user.",
          500,
        );
      }

      return mapUser(row);
    });
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    if (isPgError(error) && error.fields.code === "23505") {
      if (error.fields.constraint === "users_username_key") {
        throw new AuthError(
          "USERNAME_TAKEN",
          "Username is already taken.",
          409,
        );
      }
      if (error.fields.constraint === "users_email_key") {
        throw new AuthError("EMAIL_TAKEN", "Email is already in use.", 409);
      }
      throw new AuthError(
        "IDENTIFIER_ALREADY_IN_USE",
        "Username or email is already in use.",
        409,
      );
    }

    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

export async function signIn(input: SigninInput): Promise<SigninResult> {
  const identifier = normalizeIdentifier(input.identifier);
  const password = requirePassword(input.password);

  try {
    return await withDb(async (client) => {
      const userResult = await client.queryObject<UserAuthRow>(
        `
        SELECT
          id,
          username,
          email,
          display_name,
          avatar_key,
          password_hash,
          created_at
        FROM users
        WHERE username = $1 OR email = $1
        LIMIT 1
        `,
        [identifier],
      );

      const row = userResult.rows[0];
      if (!row) {
        throw new AuthError(
          "INVALID_CREDENTIALS",
          "Invalid username/email or password.",
          401,
        );
      }

      const ok = await argon2.verify(row.password_hash, password);
      if (!ok) {
        throw new AuthError(
          "INVALID_CREDENTIALS",
          "Invalid username/email or password.",
          401,
        );
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

      const sessionId = newUUIDv7();
      const refreshToken = generateSecureToken();
      const refreshTokenHash = await sha256Hex(refreshToken);

      await client.queryArray(
        `
        INSERT INTO sessions (
          id,
          user_id,
          refresh_token_hash,
          created_at,
          last_used_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [sessionId, row.id, refreshTokenHash, now, now, expiresAt],
      );

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

export async function logOut(sessionId: string): Promise<boolean> {
  sessionId = sessionId.trim();

  if (!sessionId) {
    throw new AuthError(
      "MISSING_SESSION_ID",
      "Session id is missing.",
      400,
    );
  }

  try {
    return await withDb(async (client) => {
      const result = await client.queryObject<{ id: string }>(
        `
        DELETE FROM sessions
        WHERE id = $1
        RETURNING id
        `,
        [sessionId],
      );

      if (result.rows.length === 0) {
        throw new AuthError("SESSION_NOT_FOUND", "Session not found.", 404);
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
      const result = await client.queryObject<UserRow>(
        `
        SELECT
          id,
          username,
          email,
          display_name,
          avatar_key,
          created_at
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [userId],
      );

      const row = result.rows[0];
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
