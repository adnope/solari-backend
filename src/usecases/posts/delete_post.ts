import { isValidUuid } from "../../utils/validation.ts";
import { eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { deleteCachedPostDetail } from "../../cache/post_detail_cache.ts";
import { postMedia, posts } from "../../db/schema.ts";
import { deleteFile } from "../../storage/s3.ts";
import { AppError } from "../app_error.ts";

export type DeletePostErrorType =
  | "MISSING_INPUT"
  | "POST_NOT_FOUND"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export async function deletePost(authorId: string, postId: string): Promise<void> {
  const normalizedAuthorId = authorId.trim();
  const normalizedPostId = postId.trim();

  if (!normalizedAuthorId || !normalizedPostId) {
    throw new AppError<DeletePostErrorType>(
      "MISSING_INPUT",
      "Author ID and Post ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedAuthorId) || !isValidUuid(normalizedPostId)) {
    throw new AppError<DeletePostErrorType>("POST_NOT_FOUND", "Post not found.", 404);
  }

  let keysToDelete: string[] = [];

  try {
    await withTx(async (tx) => {
      const [postRow] = await tx
        .select({
          authorId: posts.authorId,
          objectKey: postMedia.objectKey,
          thumbnailKey: postMedia.thumbnailKey,
        })
        .from(posts)
        .innerJoin(postMedia, eq(postMedia.postId, posts.id))
        .where(eq(posts.id, normalizedPostId))
        .limit(1);

      if (!postRow) {
        throw new AppError<DeletePostErrorType>("POST_NOT_FOUND", "Post not found.", 404);
      }

      if (postRow.authorId !== normalizedAuthorId) {
        throw new AppError<DeletePostErrorType>(
          "UNAUTHORIZED",
          "You are not authorized to delete this post.",
          403,
        );
      }

      keysToDelete = [postRow.objectKey, postRow.thumbnailKey].filter((key): key is string =>
        Boolean(key),
      );

      await tx.delete(posts).where(eq(posts.id, normalizedPostId));
    });

    await deleteCachedPostDetail(normalizedPostId);

    if (keysToDelete.length > 0) {
      void Promise.allSettled(
        keysToDelete.map(async (key) => {
          try {
            await deleteFile(key);
          } catch (error) {
            console.error(`Failed to delete S3 object: ${key}`, error);
          }
        }),
      ).catch(console.error);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(`[ERROR] Unexpected error in use case: Delete post\n${error}`);
    throw new AppError<DeletePostErrorType>(
      "INTERNAL_ERROR",
      "Internal server error during post deletion.",
      500,
    );
  }
}
