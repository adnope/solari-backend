import { eq, or } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { friendships, postMedia, posts, postVisibility } from "../../db/schema.ts";
import { uploadFile, deleteFile, getFileBuffer } from "../../storage/s3.ts";
import { generateThumbnail } from "../../utils/thumbnail.ts";
import { extractMediaMetadata } from "../../utils/media_parser.ts";
import { publishWebSocketEvent } from "../queue.ts";
import type { UploadPostJobPayload } from "../types.ts";

export async function handlePostProcessing(
  jobId: string,
  payload: UploadPostJobPayload,
): Promise<void> {
  console.log(`[HANDLER] Processing post media for job ${jobId}...`);

  const thumbnailKey = `posts/${jobId}_thumb.webp`;
  const mediaType = payload.contentType.startsWith("video/") ? "video" : "image";

  try {
    const buffer = await getFileBuffer(payload.objectKey);
    const actualByteSize = buffer.byteLength;

    let actualMetadata;
    try {
      actualMetadata = await extractMediaMetadata(buffer, payload.contentType);
    } catch (e) {
      console.error("[MEDIA PARSER] Failed to parse media:", e);
      throw new Error("Malicious or corrupted media file detected.");
    }

    if (
      actualMetadata.width <= 0 ||
      actualMetadata.height <= 0 ||
      actualMetadata.width !== actualMetadata.height
    ) {
      throw new Error(
        `Media must have positive, square dimensions. Got: ${actualMetadata.width}x${actualMetadata.height}`,
      );
    }

    if (mediaType === "video") {
      if (
        !actualMetadata.durationMs ||
        actualMetadata.durationMs <= 0 ||
        actualMetadata.durationMs > 4000
      ) {
        throw new Error(`Video exceeds maximum duration limit: ${actualMetadata.durationMs}ms`);
      }
    } else if (actualMetadata.durationMs != null) {
      throw new Error("Images cannot have a duration.");
    }

    const thumbBuffer = await generateThumbnail(buffer, mediaType);
    await uploadFile(thumbnailKey, thumbBuffer, "image/webp");

    await withTx(async (tx) => {
      await tx.insert(posts).values({
        id: payload.postId,
        authorId: payload.authorId,
        caption: payload.caption || null,
        audienceType: payload.audienceType,
      });

      await tx.insert(postMedia).values({
        postId: payload.postId,
        mediaType: mediaType,
        objectKey: payload.objectKey,
        thumbnailKey,
        contentType: payload.contentType,
        byteSize: actualByteSize,
        durationMs: actualMetadata.durationMs ?? null,
        width: actualMetadata.width,
        height: actualMetadata.height,
      });

      if (payload.audienceType === "all") {
        const friendshipRows = await tx
          .select({ userLow: friendships.userLow, userHigh: friendships.userHigh })
          .from(friendships)
          .where(
            or(
              eq(friendships.userLow, payload.authorId),
              eq(friendships.userHigh, payload.authorId),
            ),
          );

        const viewerIds = friendshipRows.map((row) =>
          row.userLow === payload.authorId ? row.userHigh : row.userLow,
        );

        if (viewerIds.length > 0) {
          await tx
            .insert(postVisibility)
            .values(viewerIds.map((viewerId) => ({ postId: payload.postId, viewerId })));
        }
      } else if (payload.viewerIds && payload.viewerIds.length > 0) {
        await tx
          .insert(postVisibility)
          .values(payload.viewerIds.map((viewerId) => ({ postId: payload.postId, viewerId })));
      }
    });

    await publishWebSocketEvent(payload.authorId, {
      type: "POST_PROCESSED",
      payload: { postId: payload.postId, status: "completed" },
    });
  } catch (error) {
    console.error(`[HANDLER] Post processing failed for ${jobId}:`, error);

    await deleteFile(payload.objectKey).catch(() => {});

    await publishWebSocketEvent(payload.authorId, {
      type: "POST_FAILED",
      payload: { postId: payload.postId, error: "Failed to process media." },
    });

    throw error;
  }
}
