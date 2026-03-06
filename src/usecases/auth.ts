import argon2 from "argon2";
import { withDb } from "../db/postgres_client.ts";
import { isPgError } from "./postgres_error.ts";

export type SignupInput = {
  username: string;
  email: string;
  password: string;
};

export type SigninInput = {
  identifier: string; // username or email
  password: string;
};

export type LogoutInput = {
  refreshToken: string;
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
  user: PublicUser;
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
};

type InsertedUserRow = {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  avatar_key: string | null;
  created_at: Date;
};

type UserAuthRow = InsertedUserRow & {
  password_hash: string;
};

const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function normalizeUsername(username: string): string {
  const value = username.trim();

  if (value.length < 4 || value.length > 32) {
    throw new Error("Username must be between 4 and 32 characters.");
  }

  if (!/^[a-zA-Z0-9_.]+$/.test(value)) {
    throw new Error(
      "Username may contain only letters, numbers, underscores, and dots.",
    );
  }

  return value;
}

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();

  if (!/^\S+@\S+\.\S+$/.test(value)) {
    throw new Error("Invalid email format.");
  }

  return value;
}

function normalizeIdentifier(identifier: string): string {
  const value = identifier.trim();

  if (value.length === 0) {
    throw new Error("Username or email is required.");
  }

  return value;
}

function validatePassword(password: string): string {
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  return password;
}

function requirePassword(password: string): string {
  if (password.length === 0) {
    throw new Error("Password is required.");
  }

  return password;
}

function mapUser(row: InsertedUserRow): PublicUser {
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

  const userId = crypto.randomUUID();

  try {
    return await withDb(async (client) => {
      const result = await client.queryObject<InsertedUserRow>(
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
        throw new Error("Failed to create user.");
      }

      return mapUser(row);
    });
  } catch (error) {
    if (isPgError(error) && error.fields.code === "23505") {
      if (error.fields.constraint === "users_username_key") {
        throw new Error("Username is already taken.");
      }
      if (error.fields.constraint === "users_email_key") {
        throw new Error("Email is already in use.");
      }
      throw new Error("Username or email is already in use.");
    }

    throw error;
  }
}

export async function signIn(input: SigninInput): Promise<SigninResult> {
  const identifier = normalizeIdentifier(input.identifier);
  const password = requirePassword(input.password);

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
      throw new Error("Invalid username/email or password.");
    }

    const ok = await argon2.verify(row.password_hash, password);
    if (!ok) {
      throw new Error("Invalid username/email or password.");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

    const sessionId = crypto.randomUUID();
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

    return {
      user: mapUser(row),
      sessionId,
      refreshToken,
      expiresAt,
    };
  });
}

export async function logOut(input: LogoutInput): Promise<boolean> {
  const refreshToken = input.refreshToken.trim();

  if (refreshToken.length === 0) {
    throw new Error("Refresh token is required.");
  }

  const refreshTokenHash = await sha256Hex(refreshToken);

  return await withDb(async (client) => {
    const result = await client.queryObject<{ id: string }>(
      `
      DELETE FROM sessions
      WHERE refresh_token_hash = $1
      RETURNING id
      `,
      [refreshTokenHash],
    );

    return result.rows.length > 0;
  });
}