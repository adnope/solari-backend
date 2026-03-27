import { withTx } from "../../db/client.ts";
import { userPasswords, users } from "../../db/migrations/schema.ts";
import { isPgError, unwrapDbError } from "../postgres_error.ts";
import { AuthError } from "./error_type.ts";

export type PublicUser = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarKey: string | null;
  createdAt: string;
};

export type SignupInput = {
  username: string;
  email: string;
  password: string;
};

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

function validatePassword(password: string): string {
  if (password.length === 0) {
    throw new AuthError("MISSING_PASSWORD", "Password is required.", 400);
  }

  if (password.length < 6) {
    throw new AuthError("WEAK_PASSWORD", "Password must be at least 6 characters.", 400);
  }

  return password;
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

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        avatarKey: user.avatarKey,
        createdAt: user.createdAt,
      };
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
