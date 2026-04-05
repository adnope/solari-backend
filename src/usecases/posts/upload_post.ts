import { eq, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { friendships } from "../../db/schema.ts";
import { getUploadPresignedUrl } from "../../storage/s3.ts";
import { redisClient, enqueueJob } from "../../jobs/queue.ts";
import type { UploadPostJobPayload } from "../../jobs/handlers/process_post_upload.ts";

export type UploadPostErrorType =
  | "MISSING_INPUT"
  | "INVALID_MEDIA"
  | "INVALID_DIMENSIONS"
  | "INVALID_DURATION"
  | "INVALID_AUDIENCE"
  | "CAPTION_TOO_LONG"
  | "TICKET_EXPIRED"
  | "UNAUTHORIZED"
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

export type InitiatePostUploadInput = {
  authorId: string;
  contentType: string;
  caption?: string | undefined;
  audienceType: "all" | "selected";
  viewerIds?: string[] | undefined;
  width: number;
  height: number;
  byteSize: number;
  durationMs?: number | undefined;
};

export type InitiatePostUploadResult = {
  postId: string;
  objectKey: string;
  uploadUrl: string;
};

function validateInitiateInput(input: InitiatePostUploadInput) {
  const normalizedContentType = input.contentType.trim().toLowerCase();

  if (!normalizedContentType.startsWith("image/") && !normalizedContentType.startsWith("video/")) {
    throw new UploadPostError("INVALID_MEDIA", "Only image and video files are allowed.", 400);
  }

  if (input.caption && input.caption.length >= 48) {
    throw new UploadPostError(
      "CAPTION_TOO_LONG",
      "Captions mustn't be longer than 48 characters",
      400,
    );
  }

  if (!input.authorId || !isValidUuid(input.authorId.trim())) {
    throw new UploadPostError("MISSING_INPUT", "Invalid author ID.", 400);
  }

  if (input.width <= 0 || input.height <= 0 || input.width !== input.height) {
    throw new UploadPostError(
      "INVALID_DIMENSIONS",
      "Media must have positive, square dimensions.",
      400,
    );
  }

  if (normalizedContentType.startsWith("video/")) {
    if (!input.durationMs || input.durationMs <= 0 || input.durationMs > 4000) {
      throw new UploadPostError("INVALID_DURATION", "Video must be no longer than 4 seconds.", 400);
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
    throw new UploadPostError("INVALID_AUDIENCE", "Invalid viewer UUID format.", 400);
  }
}

export async function initiatePostUpload(
  input: InitiatePostUploadInput,
): Promise<InitiatePostUploadResult> {
  validateInitiateInput(input);

  const normalizedAuthorId = input.authorId.trim();
  let uniqueViewerIds: string[] | undefined;

  if (input.audienceType === "selected" && input.viewerIds) {
    uniqueViewerIds = [...new Set(input.viewerIds.map((id) => id.trim()))];

    const friendshipRows = await db
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

  const normalizedContentType = input.contentType.trim().toLowerCase();
  const postId = Bun.randomUUIDv7();

  // Safely extract extension, ignoring codec metadata like "video/mp4; codecs=avc1"
  const fileExtension = normalizedContentType.split("/")[1]?.split(";")[0]?.trim() || "bin";
  const objectKey = `posts/${postId}.${fileExtension}`;

  const UPLOAD_TTL = 600;
  try {
    const uploadUrl = await getUploadPresignedUrl(objectKey, normalizedContentType, UPLOAD_TTL);

    const ticketData = {
      authorId: normalizedAuthorId,
      contentType: normalizedContentType,
      caption: input.caption,
      audienceType: input.audienceType,
      viewerIds: uniqueViewerIds,
    };

    await redisClient.set(`upload_ticket:${postId}`, JSON.stringify(ticketData), "EX", UPLOAD_TTL);

    return {
      postId,
      objectKey,
      uploadUrl,
    };
  } catch (error) {
    console.error(`[ERROR] Unexpected error in use case: Initiate post upload\n${error}`);
    throw new UploadPostError(
      "INTERNAL_ERROR",
      "Failed to initiate file upload with the storage server.",
      500,
    );
  }
}

export type FinalizePostInput = {
  authorId: string;
  postId: string;
  objectKey: string;
};

export async function finalizePostUpload(input: FinalizePostInput) {
  if (!input.authorId || !input.postId || !input.objectKey) {
    throw new UploadPostError("MISSING_INPUT", "Missing required fields.", 400);
  }

  if (!isValidUuid(input.authorId.trim()) || !isValidUuid(input.postId.trim())) {
    throw new UploadPostError("MISSING_INPUT", "Invalid UUID format.", 400);
  }

  const normalizedAuthorId = input.authorId.trim();
  const normalizedPostId = input.postId.trim();
  const ticketKey = `upload_ticket:${normalizedPostId}`;

  try {
    const ticketString = await redisClient.get(ticketKey);

    if (!ticketString) {
      throw new UploadPostError(
        "TICKET_EXPIRED",
        "Upload session expired or invalid. Please try uploading again.",
        410,
      );
    }

    const ticketData = JSON.parse(ticketString);

    if (ticketData.authorId !== normalizedAuthorId) {
      throw new UploadPostError(
        "UNAUTHORIZED",
        "You are not authorized to finalize this post.",
        403,
      );
    }

    const jobPayload: UploadPostJobPayload = {
      postId: normalizedPostId,
      authorId: normalizedAuthorId,
      objectKey: input.objectKey,
      contentType: ticketData.contentType,
      caption: ticketData.caption,
      audienceType: ticketData.audienceType,
      viewerIds: ticketData.viewerIds,
    };

    await enqueueJob<UploadPostJobPayload>("post-processing", normalizedPostId, jobPayload);

    await redisClient.del(ticketKey);

    return {
      message: "Post upload queued for processing.",
      postId: normalizedPostId,
      status: "processing",
    };
  } catch (error) {
    if (error instanceof UploadPostError) throw error;
    console.error(`[ERROR] Failed to queue post ${normalizedPostId}:\n`, error);
    throw new UploadPostError("INTERNAL_ERROR", "Failed to queue post processing.", 500);
  }
}
