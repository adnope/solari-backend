import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { deleteFile, uploadFile } from "../../storage/minio.ts";

export type UpdateProfileInput = {
  userId: string;
  email?: string;
  displayName?: string | null;
  avatar?: {
    buffer: Uint8Array;
    contentType: string;
  };
};

export type UpdateProfileResult = {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  avatar_key: string | null;
  updated_at: Date;
};

export type UpdateProfileErrorType =
  | "MISSING_USER"
  | "EMAIL_TAKEN"
  | "INVALID_EMAIL"
  | "INVALID_DISPLAY_NAME"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

export class UpdateProfileError extends Error {
  readonly type: UpdateProfileErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: UpdateProfileErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "UpdateProfileError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  let newAvatarKey: string | undefined = undefined;

  try {
    return await withDb(async (client) => {
      await client.queryArray("BEGIN");

      try {
        const currentUserResult = await client.queryObject<{
          avatar_key: string | null;
        }>(
          `SELECT avatar_key FROM users WHERE id = $1 FOR UPDATE`,
          [input.userId],
        );

        if (currentUserResult.rows.length === 0) {
          throw new UpdateProfileError("MISSING_USER", "User not found.", 404);
        }

        const currentAvatarKey = currentUserResult.rows[0].avatar_key;

        if (input.avatar) {
          const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/avif",
            "image/heif",
            "image/heic",
          ];

          if (!allowedTypes.includes(input.avatar.contentType)) {
            throw new UpdateProfileError(
              "STORAGE_ERROR",
              "Avatar must be a valid image (JPEG, PNG, WEBP, AVIF, HEIF) or GIF.",
              400,
            );
          }

          const fileExtension = input.avatar.contentType.split("/")[1] || "jpeg";
          newAvatarKey = `avatars/${input.userId}-${Date.now()}.${fileExtension}`;

          try {
            await uploadFile(newAvatarKey, input.avatar.buffer, input.avatar.contentType);
          } catch (_error) {
            throw new UpdateProfileError("STORAGE_ERROR", "Failed to upload avatar.", 502);
          }
        }

        const updates: string[] = [];
        const values: unknown[] = [input.userId];
        let paramIndex = 2;

        if (input.email !== undefined) {
          const trimmedEmail = input.email.trim();
          const rfc2822Regex =
            /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

          if (!rfc2822Regex.test(trimmedEmail)) {
            throw new UpdateProfileError(
              "INVALID_EMAIL",
              "Invalid email address format.",
              400,
            );
          }

          updates.push(`email = $${paramIndex++}`);
          values.push(trimmedEmail);
        }

        if (input.displayName !== undefined) {
          if (input.displayName !== null) {
            const trimmedName = input.displayName.trim();
            if (trimmedName === "") {
              throw new UpdateProfileError(
                "INVALID_DISPLAY_NAME",
                "Display name cannot be empty.",
                400,
              );
            }
            updates.push(`display_name = $${paramIndex++}`);
            values.push(trimmedName);
          } else {
            updates.push(`display_name = $${paramIndex++}`);
            values.push(null);
          }
        }

        if (newAvatarKey !== undefined) {
          updates.push(`avatar_key = $${paramIndex++}`);
          values.push(newAvatarKey);
        }

        if (updates.length > 0) {
          updates.push(`updated_at = now()`);

          const updateQuery = `
            UPDATE users
            SET ${updates.join(", ")}
            WHERE id = $1
            RETURNING id, username, email, display_name, avatar_key, updated_at
          `;

          const updatedUserResult = await client.queryObject<UpdateProfileResult>(
            updateQuery,
            values,
          );

          await client.queryArray("COMMIT");

          if (newAvatarKey && currentAvatarKey) {
            deleteFile(currentAvatarKey).catch((err) =>
              console.error(`Failed to delete old avatar ${currentAvatarKey}:`, err)
            );
          }

          return updatedUserResult.rows[0];
        }

        await client.queryArray("COMMIT");

        const fallbackResult = await client.queryObject<UpdateProfileResult>(
          `SELECT id, username, email, display_name, avatar_key, updated_at FROM users WHERE id = $1`,
          [input.userId],
        );
        return fallbackResult.rows[0];
      } catch (error) {
        await client.queryArray("ROLLBACK");

        if (newAvatarKey) {
          deleteFile(newAvatarKey).catch(() => {});
        }
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof UpdateProfileError) throw error;

    if (isPgError(error) && error.fields.code === "23505") {
      throw new UpdateProfileError("EMAIL_TAKEN", "Email address is already in use.", 409);
    }

    throw new UpdateProfileError(
      "INTERNAL_ERROR",
      "Internal server error during profile update.",
      500,
    );
  }
}
