import { eq, or } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { friendships, postMedia, posts, postVisibility } from "../../db/schema.ts";
import { uploadFile } from "../../storage/s3.ts";
import { generateThumbnail } from "../../utils/thumbnail.ts";

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
  createdAt: string;
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
  | "CAPTION_TOO_LONG"
  | "INTERNAL_ERROR";

export class UploadPostError extends Error {
  readonly type: UploadPostErrorType;
  readonly statusCode: number;

  constructor(type: UploadPostErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "UploadPostError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function validatePostInput(input: UploadPostInput) {
  if (!input.contentType.startsWith("image/") && !input.contentType.startsWith("video/")) {
    throw new UploadPostError("INVALID_MEDIA", "Only images and videos are allowed.", 400);
  }

  if (input.caption && input.caption.length >= 48) {
    throw new UploadPostError(
      "CAPTION_TOO_LONG",
      "Captions mustn't be longer than 48 characters",
      400,
    );
  }

  if (!input.authorId || !input.buffer || !input.contentType) {
    throw new UploadPostError("MISSING_INPUT", "Missing required fields or media buffer.", 400);
  }

  if (!isValidUuid(input.authorId.trim())) {
    throw new UploadPostError("MISSING_INPUT", "Invalid author ID.", 400);
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

  if (input.viewerIds && !input.viewerIds.every((id) => isValidUuid(id.trim()))) {
    throw new UploadPostError("INVALID_AUDIENCE", "Invalid UUID format.", 400);
  }
}

export async function uploadPost(input: UploadPostInput): Promise<UploadPostResult> {
  validatePostInput(input);

  const normalizedAuthorId = input.authorId.trim();
  const postId = Bun.randomUUIDv7();
  const fileExtension = input.contentType.split("/")[1] || "bin";

  const objectKey = `posts/${postId}.${fileExtension}`;
  const thumbnailKey = `posts/${postId}_thumb.webp`;

  let thumbBuffer: Uint8Array;
  try {
    thumbBuffer = await generateThumbnail(input.buffer, input.mediaType);
  } catch {
    throw new UploadPostError("INVALID_MEDIA", "Failed to process media file.", 400);
  }

  try {
    await Promise.all([
      uploadFile(objectKey, input.buffer, input.contentType),
      uploadFile(thumbnailKey, thumbBuffer, "image/webp"),
    ]);
  } catch {
    throw new UploadPostError("STORAGE_ERROR", "Failed to upload media to storage.", 502);
  }

  try {
    return await withTx(async (tx) => {
      let uniqueViewerIds: string[] | undefined;

      if (input.audienceType === "selected" && input.viewerIds) {
        uniqueViewerIds = [...new Set(input.viewerIds.map((id) => id.trim()))];

        const friendshipRows = await tx
          .select({
            userLow: friendships.userLow,
            userHigh: friendships.userHigh,
          })
          .from(friendships)
          .where(
            or(
              eq(friendships.userLow, normalizedAuthorId),
              eq(friendships.userHigh, normalizedAuthorId),
            ),
          );

        const friendIds = new Set(
          friendshipRows.map((row) =>
            row.userLow === normalizedAuthorId ? row.userHigh : row.userLow,
          ),
        );

        const allValid = uniqueViewerIds.every((viewerId) => friendIds.has(viewerId));
        if (!allValid) {
          throw new UploadPostError(
            "INVALID_AUDIENCE",
            "One or more viewer IDs are invalid or not on your friends list.",
            403,
          );
        }
      }

      const [insertedPost] = await tx
        .insert(posts)
        .values({
          id: postId,
          authorId: normalizedAuthorId,
          caption: input.caption || null,
          audienceType: input.audienceType,
        })
        .returning({
          createdAt: posts.createdAt,
        });

      if (!insertedPost) {
        throw new UploadPostError(
          "INTERNAL_ERROR",
          "Internal server error during post creation.",
          500,
        );
      }

      await tx.insert(postMedia).values({
        postId,
        mediaType: input.mediaType,
        objectKey,
        thumbnailKey,
        contentType: input.contentType,
        byteSize: input.byteSize,
        durationMs: input.durationMs ?? null,
        width: input.width,
        height: input.height,
      });

      if (input.audienceType === "all") {
        const friendshipRows = await tx
          .select({
            userLow: friendships.userLow,
            userHigh: friendships.userHigh,
          })
          .from(friendships)
          .where(
            or(
              eq(friendships.userLow, normalizedAuthorId),
              eq(friendships.userHigh, normalizedAuthorId),
            ),
          );

        const viewerIds = friendshipRows.map((row) =>
          row.userLow === normalizedAuthorId ? row.userHigh : row.userLow,
        );

        if (viewerIds.length > 0) {
          await tx.insert(postVisibility).values(
            viewerIds.map((viewerId) => ({
              postId,
              viewerId,
            })),
          );
        }
      } else if (uniqueViewerIds && uniqueViewerIds.length > 0) {
        await tx.insert(postVisibility).values(
          uniqueViewerIds.map((viewerId) => ({
            postId,
            viewerId,
          })),
        );
      }

      return {
        id: postId,
        authorId: normalizedAuthorId,
        caption: input.caption || null,
        audienceType: input.audienceType,
        createdAt: insertedPost.createdAt,
        media: {
          objectKey,
          thumbnailKey,
          mediaType: input.mediaType,
          width: input.width,
          height: input.height,
        },
      };
    });
  } catch (error) {
    if (error instanceof UploadPostError) throw error;

    throw new UploadPostError("INTERNAL_ERROR", "Internal server error during post creation.", 500);
  }
}
