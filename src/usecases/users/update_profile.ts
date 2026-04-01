import { eq, or } from "drizzle-orm";
import { db, withTx } from "../../db/client.ts";
import { friendships, users } from "../../db/schema.ts";
import { deleteFile, uploadFile } from "../../storage/s3.ts";
import { isPgError } from "../postgres_error.ts";
import { wsPublisher } from "../../websocket/publisher.ts";

export type UpdateProfileInput = {
  userId: string;
  email?: string;
  displayName?: string;
  removeDisplayName?: boolean;
  removeAvatar?: boolean;
  avatar?:
    | {
        buffer: Uint8Array;
        contentType: string;
      }
    | undefined;
};

export type UpdateProfileResult = {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  avatar_key: string | null;
  updated_at: string;
};

export type UpdateProfileErrorType =
  | "MISSING_USER"
  | "EMAIL_TAKEN"
  | "INVALID_EMAIL"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

export class UpdateProfileError extends Error {
  readonly type: UpdateProfileErrorType;
  readonly statusCode: number;

  constructor(type: UpdateProfileErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "UpdateProfileError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function isValidEmail(email: string): boolean {
  const rfc2822Regex =
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

  return rfc2822Regex.test(email);
}

export async function updateProfile(input: UpdateProfileInput): Promise<UpdateProfileResult> {
  const normalizedUserId = input.userId.trim();

  if (!normalizedUserId || !isValidUuid(normalizedUserId)) {
    throw new UpdateProfileError("MISSING_USER", "User not found.", 404);
  }

  let newAvatarKey: string | undefined;

  try {
    const updatedProfile = await withTx(async (tx) => {
      const [currentUser] = await tx
        .select({
          avatarKey: users.avatarKey,
        })
        .from(users)
        .where(eq(users.id, normalizedUserId))
        .limit(1);

      if (!currentUser) {
        throw new UpdateProfileError("MISSING_USER", "User not found.", 404);
      }

      const currentAvatarKey = currentUser.avatarKey;

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
          throw new UpdateProfileError("STORAGE_ERROR", "Avatar must be a valid image.", 400);
        }

        const fileExtension = input.avatar.contentType.split("/")[1] || "jpeg";
        newAvatarKey = `avatars/${normalizedUserId}-${Date.now()}.${fileExtension}`;

        try {
          await uploadFile(newAvatarKey, input.avatar.buffer, input.avatar.contentType);
        } catch {
          throw new UpdateProfileError("STORAGE_ERROR", "Failed to upload avatar.", 502);
        }
      }

      const updateData: {
        email?: string;
        displayName?: string | null;
        avatarKey?: string | null;
        updatedAt?: string;
      } = {};

      if (input.email !== undefined) {
        const trimmedEmail = input.email.trim();
        if (trimmedEmail !== "") {
          if (!isValidEmail(trimmedEmail)) {
            throw new UpdateProfileError("INVALID_EMAIL", "Invalid email address format.", 400);
          }
          updateData.email = trimmedEmail;
        }
      }

      if (input.removeDisplayName) {
        updateData.displayName = null;
      } else if (input.displayName !== undefined) {
        const trimmedName = input.displayName.trim();
        if (trimmedName !== "") {
          updateData.displayName = trimmedName;
        }
      }

      if (input.removeAvatar) {
        updateData.avatarKey = null;
      } else if (newAvatarKey !== undefined) {
        updateData.avatarKey = newAvatarKey;
      }

      let finalUser: UpdateProfileResult;

      if (Object.keys(updateData).length > 0) {
        updateData.updatedAt = new Date().toISOString();

        const [updatedUser] = await tx
          .update(users)
          .set(updateData)
          .where(eq(users.id, normalizedUserId))
          .returning({
            id: users.id,
            username: users.username,
            email: users.email,
            display_name: users.displayName,
            avatar_key: users.avatarKey,
            updated_at: users.updatedAt,
          });

        if (!updatedUser) {
          throw new UpdateProfileError("MISSING_USER", "User not found.", 404);
        }

        finalUser = updatedUser;

        if (currentAvatarKey && (newAvatarKey || input.removeAvatar)) {
          void deleteFile(currentAvatarKey).catch((err) =>
            console.error(`Failed to delete old avatar ${currentAvatarKey}:`, err),
          );
        }
      } else {
        const [existingUser] = await tx
          .select({
            id: users.id,
            username: users.username,
            email: users.email,
            display_name: users.displayName,
            avatar_key: users.avatarKey,
            updated_at: users.updatedAt,
          })
          .from(users)
          .where(eq(users.id, normalizedUserId))
          .limit(1);

        if (!existingUser) {
          throw new UpdateProfileError("MISSING_USER", "User not found.", 404);
        }

        finalUser = existingUser;
      }

      return finalUser;
    });

    if (
      input.displayName !== undefined ||
      input.removeDisplayName ||
      input.avatar !== undefined ||
      input.removeAvatar
    ) {
      void (async () => {
        try {
          const friends = await db
            .select({ userLow: friendships.userLow, userHigh: friendships.userHigh })
            .from(friendships)
            .where(
              or(
                eq(friendships.userLow, normalizedUserId),
                eq(friendships.userHigh, normalizedUserId),
              ),
            );

          if (friends.length === 0) return;

          const eventPayload = {
            type: "FRIEND_PROFILE_UPDATED" as const,
            payload: {
              userId: updatedProfile.id,
              username: updatedProfile.username,
              displayName: updatedProfile.display_name,
              avatarKey: updatedProfile.avatar_key,
            },
          };

          wsPublisher.sendToUser(normalizedUserId, eventPayload);

          for (const friend of friends) {
            const targetId = friend.userLow === normalizedUserId ? friend.userHigh : friend.userLow;
            wsPublisher.sendToUser(targetId, eventPayload);
          }
        } catch (err) {
          console.error(
            `[ERROR] Failed to broadcast profile update for user ${normalizedUserId}:`,
            err,
          );
        }
      })();
    }

    return updatedProfile;
  } catch (error) {
    if (error instanceof UpdateProfileError) throw error;

    if (isPgError(error) && error.code === "23505") {
      if (newAvatarKey) {
        void deleteFile(newAvatarKey).catch(() => {});
      }
      throw new UpdateProfileError("EMAIL_TAKEN", "Email address is already in use.", 409);
    }

    if (newAvatarKey) {
      void deleteFile(newAvatarKey).catch(() => {});
    }

    console.error(`[ERROR] Unexpected error in use case: Update profile\n${error}`);
    throw new UpdateProfileError(
      "INTERNAL_ERROR",
      "Internal server error during profile update.",
      500,
    );
  }
}
