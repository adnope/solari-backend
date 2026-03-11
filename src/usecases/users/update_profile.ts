import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { deleteFile, uploadFile } from "../../storage/minio.ts";

export type UpdateProfileInput = {
  userId: string;
  email?: string;
  displayName?: string;
  removeDisplayName?: boolean;
  removeAvatar?: boolean;
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
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

export class UpdateProfileError extends Error {
  readonly type: UpdateProfileErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: UpdateProfileErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "UpdateProfileError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function updateProfile(input: UpdateProfileInput): Promise<UpdateProfileResult> {
  let newAvatarKey: string | undefined = undefined;

  try {
    return await withDb(async (client) => {
      return await client.begin(async (tx) => {
        const currentUserResult = await tx<{ avatar_key: string | null }[]>`
          SELECT avatar_key FROM users WHERE id = ${input.userId} FOR UPDATE
        `;

        if (currentUserResult.length === 0) {
          throw new UpdateProfileError("MISSING_USER", "User not found.", 404);
        }

        const currentAvatarKey = currentUserResult[0]!.avatar_key;

        if (input.avatar && !input.removeAvatar) {
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

        const updateObj: Record<string, unknown> = {};

        if (input.email !== undefined) {
          const trimmedEmail = input.email.trim();

          if (trimmedEmail !== "") {
            const rfc2822Regex =
              /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

            if (!rfc2822Regex.test(trimmedEmail)) {
              throw new UpdateProfileError("INVALID_EMAIL", "Invalid email address format.", 400);
            }
            updateObj.email = trimmedEmail;
          }
        }

        if (input.removeDisplayName) {
          updateObj.display_name = null;
        } else if (input.displayName !== undefined) {
          const trimmedName = input.displayName.trim();
          if (trimmedName !== "") {
            updateObj.display_name = trimmedName;
          }
        }

        if (input.removeAvatar) {
          updateObj.avatar_key = null;
        } else if (newAvatarKey !== undefined) {
          updateObj.avatar_key = newAvatarKey;
        }

        if (Object.keys(updateObj).length > 0) {
          updateObj.updated_at = new Date();

          const updatedUserResult = await tx<UpdateProfileResult[]>`
            UPDATE users
            SET ${tx(updateObj)}
            WHERE id = ${input.userId}
            RETURNING id, username, email, display_name, avatar_key, updated_at
          `;

          if (currentAvatarKey && (newAvatarKey || input.removeAvatar)) {
            deleteFile(currentAvatarKey).catch((err) =>
              console.error(`Failed to delete old avatar ${currentAvatarKey}:`, err),
            );
          }

          return updatedUserResult[0]!;
        }

        const fallbackResult = await tx<UpdateProfileResult[]>`
          SELECT id, username, email, display_name, avatar_key, updated_at
          FROM users
          WHERE id = ${input.userId}
        `;
        return fallbackResult[0]!;
      });
    });
  } catch (error: any) {
    if (error instanceof UpdateProfileError) throw error;

    if (isPgError(error) && error.code === "23505") {
      throw new UpdateProfileError("EMAIL_TAKEN", "Email address is already in use.", 409);
    }

    if (newAvatarKey) {
      deleteFile(newAvatarKey).catch(() => {});
    }

    throw new UpdateProfileError(
      "INTERNAL_ERROR",
      "Internal server error during profile update.",
      500,
    );
  }
}
