import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { deleteFile } from "../../storage/minio.ts";

export type DeletePostErrorType =
  | "MISSING_INPUT"
  | "POST_NOT_FOUND"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export class DeletePostError extends Error {
  readonly type: DeletePostErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: DeletePostErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "DeletePostError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function deletePost(authorId: string, postId: string): Promise<void> {
  if (!authorId || !postId) {
    throw new DeletePostError("MISSING_INPUT", "Author ID and Post ID are required.", 400);
  }

  try {
    await withDb(async (client) => {
      await client.begin(async (tx) => {
        const postResult = await tx<{ author_id: string; object_key: string }[]>`
          SELECT p.author_id, pm.object_key
          FROM posts p
          JOIN post_media pm ON pm.post_id = p.id
          WHERE p.id = ${postId}
          FOR UPDATE
        `;

        if (postResult.length === 0) {
          throw new DeletePostError("POST_NOT_FOUND", "Post not found.", 404);
        }

        const post = postResult[0]!;

        if (post.author_id !== authorId) {
          throw new DeletePostError(
            "UNAUTHORIZED",
            "You are not authorized to delete this post.",
            403,
          );
        }

        await tx`DELETE FROM posts WHERE id = ${postId}`;

        try {
          await deleteFile(post.object_key);
        } catch (error) {
          console.error(`Failed to delete MinIO object: ${post.object_key}`, error);
        }
      });
    });
  } catch (error: any) {
    if (error instanceof DeletePostError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new DeletePostError("POST_NOT_FOUND", "Post not found.", 404);
    }

    throw new DeletePostError("INTERNAL_ERROR", "Internal server error during post deletion.", 500);
  }
}
