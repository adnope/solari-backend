import { isValidUuid } from "../../utils/uuid.ts";
import { eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { postMedia, posts, users } from "../../db/schema.ts";
import { deleteFile } from "../../storage/s3.ts";

export type DeleteAccountErrorType = "USER_NOT_FOUND" | "INTERNAL_ERROR";

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

export async function deleteAccount(userId: string): Promise<void> {
  const normalizedUserId = userId.trim();
  const keysToDelete: string[] = [];

  if (!normalizedUserId || !isValidUuid(normalizedUserId)) {
    throw new DeleteAccountError("USER_NOT_FOUND", "User not found.", 404);
  }

  try {
    await withTx(async (tx) => {
      const [userRow] = await tx
        .select({
          avatarKey: users.avatarKey,
        })
        .from(users)
        .where(eq(users.id, normalizedUserId))
        .limit(1);

      if (!userRow) {
        throw new DeleteAccountError("USER_NOT_FOUND", "User not found.", 404);
      }

      if (userRow.avatarKey) {
        keysToDelete.push(userRow.avatarKey);
      }

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
