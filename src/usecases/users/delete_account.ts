import { isValidUuid } from "../../utils/uuid.ts";
import { eq, or } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import {
  friendNicknames,
  friendships,
  postMedia,
  posts,
  userPasswords,
  users,
} from "../../db/schema.ts";
import { deleteFile } from "../../storage/s3.ts";
import { deleteCachedNicknames } from "../../cache/nickname_cache.ts";
import { deleteCachedFriendIdsForUsers } from "../../cache/friend_cache.ts";
import { deleteCachedUserSummary } from "../../cache/user_summary_cache.ts";

export type DeleteAccountInput = {
  userId: string;
  password: string;
};

export type DeleteAccountErrorType =
  | "MISSING_PASSWORD"
  | "USER_NOT_FOUND"
  | "INVALID_CREDENTIALS"
  | "LINKED_THIRD_PARTY_ACCOUNT"
  | "INTERNAL_ERROR";

export class DeleteAccountError extends Error {
  readonly type: DeleteAccountErrorType;
  readonly statusCode: number;

  constructor(type: DeleteAccountErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "DeleteAccountError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function deleteAccount(input: DeleteAccountInput): Promise<void> {
  const normalizedUserId = input.userId.trim();
  const password = input.password;
  const keysToDelete: string[] = [];
  const nicknamePairsToInvalidate: Array<{ setterId: string; targetId: string }> = [];
  const friendIdsToInvalidate: string[] = [normalizedUserId];

  if (!normalizedUserId || !isValidUuid(normalizedUserId)) {
    throw new DeleteAccountError("USER_NOT_FOUND", "User not found.", 404);
  }

  if (password.length === 0) {
    throw new DeleteAccountError("MISSING_PASSWORD", "Password is required.", 400);
  }

  try {
    await withTx(async (tx) => {
      const [userRow] = await tx
        .select({
          avatarKey: users.avatarKey,
          passwordHash: userPasswords.passwordHash,
        })
        .from(users)
        .leftJoin(userPasswords, eq(userPasswords.userId, users.id))
        .where(eq(users.id, normalizedUserId))
        .limit(1);

      if (!userRow) {
        throw new DeleteAccountError("USER_NOT_FOUND", "User not found.", 404);
      }

      if (!userRow.passwordHash) {
        throw new DeleteAccountError(
          "LINKED_THIRD_PARTY_ACCOUNT",
          "Please sign in using your linked third-party account.",
          401,
        );
      }

      const isPasswordValid = await Bun.password.verify(password, userRow.passwordHash);
      if (!isPasswordValid) {
        throw new DeleteAccountError("INVALID_CREDENTIALS", "Invalid password.", 401);
      }

      if (userRow.avatarKey) {
        keysToDelete.push(userRow.avatarKey);
      }

      const friendshipRows = await tx
        .select({
          userLow: friendships.userLow,
          userHigh: friendships.userHigh,
        })
        .from(friendships)
        .where(
          or(eq(friendships.userLow, normalizedUserId), eq(friendships.userHigh, normalizedUserId)),
        );

      friendIdsToInvalidate.push(
        ...friendshipRows.map((row) =>
          row.userLow === normalizedUserId ? row.userHigh : row.userLow,
        ),
      );

      const nicknameRows = await tx
        .select({
          setterId: friendNicknames.setterId,
          targetId: friendNicknames.targetId,
        })
        .from(friendNicknames)
        .where(
          or(
            eq(friendNicknames.setterId, normalizedUserId),
            eq(friendNicknames.targetId, normalizedUserId),
          ),
        );

      nicknamePairsToInvalidate.push(...nicknameRows);

      const mediaRows = await tx
        .select({
          objectKey: postMedia.objectKey,
          thumbnailKey: postMedia.thumbnailKey,
        })
        .from(postMedia)
        .innerJoin(posts, eq(posts.id, postMedia.postId))
        .where(eq(posts.authorId, normalizedUserId));

      for (const row of mediaRows) {
        keysToDelete.push(row.objectKey);
        if (row.thumbnailKey) {
          keysToDelete.push(row.thumbnailKey);
        }
      }

      await tx.delete(users).where(eq(users.id, normalizedUserId));
    });

    await Promise.all([
      deleteCachedFriendIdsForUsers(friendIdsToInvalidate),
      deleteCachedNicknames(nicknamePairsToInvalidate),
      deleteCachedUserSummary(normalizedUserId),
    ]);

    if (keysToDelete.length > 0) {
      await Promise.allSettled(
        [...new Set(keysToDelete)].map((key) =>
          deleteFile(key).catch((err) =>
            console.error(`Failed to delete orphaned MinIO object: ${key}`, err),
          ),
        ),
      );
    }
  } catch (error) {
    if (error instanceof DeleteAccountError) throw error;
    console.error(`[ERROR] Unexpected error in use case: Delete account\n${error}`);
    throw new DeleteAccountError(
      "INTERNAL_ERROR",
      "Internal server error during account deletion.",
      500,
    );
  }
}
