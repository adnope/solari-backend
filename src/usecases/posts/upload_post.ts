import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { uploadFile } from "../../storage/minio.ts";
import { generateThumbnail } from "../../utils/thumbnail.ts";
import { isPgError } from "../postgres_error.ts";

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
    thumbnailKey: string;
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
  | "INVALID_MEDIA"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

export class UploadPostError extends Error {
  readonly type: UploadPostErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: UploadPostErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "UploadPostError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

function validatePostInput(input: UploadPostInput) {
  if (!input.contentType.startsWith("image/") && !input.contentType.startsWith("video/")) {
    throw new UploadPostError("INVALID_MEDIA", "Only images and videos are allowed.", 400);
  }

  if (!input.authorId || !input.buffer || !input.contentType) {
    throw new UploadPostError("MISSING_INPUT", "Missing required fields or media buffer.", 400);
  }

  if (input.width <= 0 || input.height <= 0 || input.width !== input.height) {
    throw new UploadPostError(
      "INVALID_DIMENSIONS",
      "Media must have positive, square dimensions (width = height).",
      400,
    );
  }

  if (input.mediaType === "video") {
    if (!input.durationMs || input.durationMs <= 0 || input.durationMs > 4000) {
      throw new UploadPostError("INVALID_DURATION", "Video must be no longer than 3 seconds.", 400);
    }
  } else if (input.durationMs != null) {
    throw new UploadPostError("INVALID_DURATION", "Images cannot have a duration.", 400);
  }

  if (input.audienceType === "selected" && (!input.viewerIds || input.viewerIds.length === 0)) {
    throw new UploadPostError(
      "INVALID_AUDIENCE",
      "Selected audience requires at least one viewer ID.",
      400,
    );
  }
}

export async function uploadPost(input: UploadPostInput): Promise<UploadPostResult> {
  validatePostInput(input);

  const postId = Bun.randomUUIDv7();
  const fileExtension = input.contentType.split("/")[1] || "bin";

  const objectKey = `posts/${postId}.${fileExtension}`;
  const thumbnailKey = `posts/${postId}_thumb.webp`;

  let thumbBuffer: Uint8Array;
  try {
    thumbBuffer = await generateThumbnail(input.buffer, input.mediaType);
  } catch (error) {
    throw new UploadPostError("INVALID_MEDIA", "Failed to process media file.", 400);
  }

  try {
    await Promise.all([
      uploadFile(objectKey, input.buffer, input.contentType),
      uploadFile(thumbnailKey, thumbBuffer, "image/webp"),
    ]);
  } catch (_error) {
    throw new UploadPostError("STORAGE_ERROR", "Failed to upload media to storage.", 502);
  }

  try {
    return await withDb(async (client) => {
      return await client.begin(async (tx) => {
        if (input.audienceType === "selected" && input.viewerIds) {
          const uniqueViewerIds = [...new Set(input.viewerIds)];

          const userCheckResult = await tx<{ count: bigint }[]>`
            SELECT COUNT(id) FROM users WHERE id = ANY(${uniqueViewerIds}::uuid[])
          `;

          if (Number(userCheckResult[0]!.count) !== uniqueViewerIds.length) {
            throw new UploadPostError(
              "INVALID_AUDIENCE",
              "One or more viewer IDs do not exist.",
              404,
            );
          }
        }

        const postResult = await tx<{ created_at: Date }[]>`
          INSERT INTO posts (id, author_id, caption, audience_type)
          VALUES (${postId}, ${input.authorId}, ${input.caption || null}, ${input.audienceType})
          RETURNING created_at
        `;

        await tx`
          INSERT INTO post_media (
            post_id, media_type, object_key, thumbnail_key, content_type,
            byte_size, duration_ms, width, height
          )
          VALUES (
            ${postId}, ${input.mediaType}, ${objectKey}, ${thumbnailKey}, ${input.contentType},
            ${input.byteSize}, ${input.durationMs || null}, ${input.width}, ${input.height}
          )
        `;

        if (input.audienceType === "all") {
          await tx`
            INSERT INTO post_visibility (post_id, viewer_id)
            SELECT ${postId}, friend_id FROM (
              SELECT user_high AS friend_id FROM friendships WHERE user_low = ${input.authorId}
              UNION
              SELECT user_low AS friend_id FROM friendships WHERE user_high = ${input.authorId}
            ) AS f
          `;
        } else if (input.audienceType === "selected" && input.viewerIds) {
          await tx`
            INSERT INTO post_visibility (post_id, viewer_id)
            SELECT ${postId}, friend_id FROM (
              SELECT user_high AS friend_id FROM friendships WHERE user_low = ${input.authorId}
              UNION
              SELECT user_low AS friend_id FROM friendships WHERE user_high = ${input.authorId}
            ) AS f
            WHERE friend_id = ANY(${input.viewerIds}::uuid[])
          `;
        }

        return {
          id: postId,
          authorId: input.authorId,
          caption: input.caption || null,
          audienceType: input.audienceType,
          createdAt: postResult[0]!.created_at,
          media: {
            objectKey: objectKey,
            thumbnailKey: thumbnailKey,
            mediaType: input.mediaType,
            width: input.width,
            height: input.height,
          },
        };
      });
    });
  } catch (error: any) {
    if (error instanceof UploadPostError) {
      throw error;
    }

    if (isPgError(error) && error.code === "22P02") {
      throw new UploadPostError(
        "INVALID_AUDIENCE",
        "One or more viewer IDs are invalid UUIDs.",
        400,
      );
    }

    if (isPgError(error) && error.code === "23503") {
      throw new UploadPostError("MISSING_INPUT", "Author or viewer ID does not exist.", 404);
    }

    throw new UploadPostError("INTERNAL_ERROR", "Internal server error during post creation.", 500);
  }
}
