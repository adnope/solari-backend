import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { uploadFile } from "../../storage/minio.ts";
import { newUUIDv7 } from "../../utils/uuid.ts";

export type UploadPostInput = {
  authorId: string;
  caption?: string;
  audienceType: "all" | "selected";
  viewerIds?: string[];
  mediaType: "image" | "video";
  buffer: Uint8Array;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  durationMs?: number;
};

export type UploadPostResult = {
  id: string;
  authorId: string;
  caption: string | null;
  audienceType: string;
  createdAt: Date;
  media: {
    objectKey: string;
    mediaType: string;
    width: number;
    height: number;
  };
};

export type UploadPostErrorType =
  | "MISSING_INPUT"
  | "INVALID_DIMENSIONS"
  | "INVALID_DURATION"
  | "INVALID_AUDIENCE"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

export class UploadPostError extends Error {
  readonly type: UploadPostErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: UploadPostErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "UploadPostError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

function validatePostInput(input: UploadPostInput) {
  if (!input.authorId || !input.buffer || !input.contentType) {
    throw new UploadPostError(
      "MISSING_INPUT",
      "Missing required fields or media buffer.",
      400,
    );
  }

  if (input.width <= 0 || input.height <= 0 || input.width !== input.height) {
    throw new UploadPostError(
      "INVALID_DIMENSIONS",
      "Media must have positive, square dimensions (width = height).",
      400,
    );
  }

  if (input.mediaType === "video") {
    if (!input.durationMs || input.durationMs <= 0 || input.durationMs > 3000) {
      throw new UploadPostError(
        "INVALID_DURATION",
        "Video duration must be between 1 and 3000 ms.",
        400,
      );
    }
  } else if (input.durationMs != null) {
    throw new UploadPostError(
      "INVALID_DURATION",
      "Images cannot have a duration.",
      400,
    );
  }

  if (
    input.audienceType === "selected" &&
    (!input.viewerIds || input.viewerIds.length === 0)
  ) {
    throw new UploadPostError(
      "INVALID_AUDIENCE",
      "Selected audience requires at least one viewer ID.",
      400,
    );
  }
}

export async function uploadPost(
  input: UploadPostInput,
): Promise<UploadPostResult> {
  validatePostInput(input);

  const postId = newUUIDv7();
  const fileExtension = input.contentType.split("/")[1] || "bin";
  const objectKey = `posts/${postId}.${fileExtension}`;

  try {
    await uploadFile(objectKey, input.buffer, input.contentType);
  } catch (_error) {
    throw new UploadPostError(
      "STORAGE_ERROR",
      "Failed to upload media to storage.",
      502,
    );
  }

  try {
    return await withDb(async (client) => {
      await client.queryArray("BEGIN");

      try {
        if (input.audienceType === "selected" && input.viewerIds) {
          const uniqueViewerIds = [...new Set(input.viewerIds)];

          const userCheckResult = await client.queryObject<{ count: bigint }>(
            `SELECT COUNT(id) FROM users WHERE id = ANY($1::uuid[])`,
            [uniqueViewerIds],
          );

          if (
            Number(userCheckResult.rows[0].count) !== uniqueViewerIds.length
          ) {
            throw new UploadPostError(
              "INVALID_AUDIENCE",
              "One or more viewer IDs do not exist.",
              404,
            );
          }
        }

        const postResult = await client.queryObject<{ created_at: Date }>(
          `
          INSERT INTO posts (id, author_id, caption, audience_type)
          VALUES ($1, $2, $3, $4)
          RETURNING created_at
          `,
          [postId, input.authorId, input.caption || null, input.audienceType],
        );

        await client.queryArray(
          `
          INSERT INTO post_media (
            post_id, media_type, object_key, content_type,
            byte_size, duration_ms, width, height
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            postId,
            input.mediaType,
            objectKey,
            input.contentType,
            input.byteSize,
            input.durationMs || null,
            input.width,
            input.height,
          ],
        );

        if (input.audienceType === "all") {
          await client.queryArray(
            `
            INSERT INTO post_visibility (post_id, viewer_id)
            SELECT $1, friend_id FROM (
              SELECT user_high AS friend_id FROM friendships WHERE user_low = $2
              UNION
              SELECT user_low AS friend_id FROM friendships WHERE user_high = $2
            ) AS f
            `,
            [postId, input.authorId],
          );
        } else if (input.audienceType === "selected" && input.viewerIds) {
          await client.queryArray(
            `
            INSERT INTO post_visibility (post_id, viewer_id)
            SELECT $1, friend_id FROM (
              SELECT user_high AS friend_id FROM friendships WHERE user_low = $2
              UNION
              SELECT user_low AS friend_id FROM friendships WHERE user_high = $2
            ) AS f
            WHERE friend_id = ANY($3::uuid[])
            `,
            [postId, input.authorId, input.viewerIds],
          );
        }

        await client.queryArray("COMMIT");

        return {
          id: postId,
          authorId: input.authorId,
          caption: input.caption || null,
          audienceType: input.audienceType,
          createdAt: postResult.rows[0].created_at,
          media: {
            objectKey: objectKey,
            mediaType: input.mediaType,
            width: input.width,
            height: input.height,
          },
        };
      } catch (error) {
        await client.queryArray("ROLLBACK");
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof UploadPostError) {
      throw error;
    }

    if (isPgError(error) && error.fields.code === "22P02") {
      throw new UploadPostError(
        "INVALID_AUDIENCE",
        "One or more viewer IDs are invalid UUIDs.",
        400,
      );
    }

    if (isPgError(error) && error.fields.code === "23503") {
      throw new UploadPostError(
        "MISSING_INPUT",
        "Author or viewer ID does not exist.",
        404,
      );
    }

    throw new UploadPostError(
      "INTERNAL_ERROR",
      "Internal server error during post creation.",
      500,
    );
  }
}
