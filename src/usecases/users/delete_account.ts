import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { deleteFile } from "../../storage/minio.ts";

export type DeleteAccountErrorType = "USER_NOT_FOUND" | "INTERNAL_ERROR";

export class DeleteAccountError extends Error {
  readonly type: DeleteAccountErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: DeleteAccountErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "DeleteAccountError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function deleteAccount(userId: string): Promise<void> {
  const keysToDelete: string[] = [];

  try {
    await withDb(async (client) => {
      await client.queryArray("BEGIN");

      try {
        const userResult = await client.queryObject<{ avatar_key: string | null }>(
          `SELECT avatar_key FROM users WHERE id = $1 FOR UPDATE`,
          [userId],
        );

        if (userResult.rows.length === 0) {
          throw new DeleteAccountError("USER_NOT_FOUND", "User not found.", 404);
        }

        if (userResult.rows[0].avatar_key) {
          keysToDelete.push(userResult.rows[0].avatar_key);
        }

        const mediaResult = await client.queryObject<{ object_key: string }>(
          `
          SELECT pm.object_key
          FROM post_media pm
          JOIN posts p ON p.id = pm.post_id
          WHERE p.author_id = $1
          `,
          [userId],
        );

        for (const row of mediaResult.rows) {
          keysToDelete.push(row.object_key);
        }

        await client.queryArray(`DELETE FROM users WHERE id = $1`, [userId]);

        await client.queryArray("COMMIT");
      } catch (error) {
        await client.queryArray("ROLLBACK");
        throw error;
      }
    });

    if (keysToDelete.length > 0) {
      await Promise.allSettled(
        keysToDelete.map((key) =>
          deleteFile(key).catch((err) =>
            console.error(`Failed to delete orphaned MinIO object: ${key}`, err)
          )
        ),
      );
    }
  } catch (error) {
    if (error instanceof DeleteAccountError) throw error;

    if (isPgError(error) && error.fields.code === "22P02") {
      throw new DeleteAccountError("USER_NOT_FOUND", "User not found.", 404);
    }

    throw new DeleteAccountError(
      "INTERNAL_ERROR",
      "Internal server error during account deletion.",
      500,
    );
  }
}
