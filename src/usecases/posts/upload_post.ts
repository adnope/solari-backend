import { isValidUuid } from "../../utils/validation.ts";
import { eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { userStreaks } from "../../db/schema.ts";
import { getUploadPresignedUrl } from "../../storage/s3.ts";
import {
  enqueuePostUploadProcessing,
  enqueuePushNotification,
  redisClient,
} from "../../jobs/queue.ts";
import type { UploadPostJobPayload } from "../../jobs/types.ts";
import { createUuidV7 } from "../../utils/ids.ts";
import { calculateNewStreak } from "../../utils/streak.ts";
import { getFriendIds } from "../common_queries.ts";
import type { CaptionMetadata } from "../../db/schema.ts";
import { AppError } from "../app_error.ts";

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

export type InitiatePostUploadInput = {
  authorId: string;
  contentType: string;
  caption?: string | undefined;
  captionType?: "text" | "ootd" | "weather" | "location" | "rating" | "clock" | undefined;
  captionMetadata?: CaptionMetadata | undefined;
  audienceType: "all" | "selected";
  viewerIds?: string[] | undefined;
  width: number;
  height: number;
  byteSize: number;
  durationMs?: number | undefined;
  timezone: string; // (e.g., "Asia/Ho_Chi_Minh")
};

export type InitiatePostUploadResult = {
  postId: string;
  objectKey: string;
  uploadUrl: string;
};

function validateInitiateInput(input: InitiatePostUploadInput) {
  const normalizedContentType = input.contentType.trim().toLowerCase();

  if (!normalizedContentType.startsWith("image/") && !normalizedContentType.startsWith("video/")) {
    throw new AppError<UploadPostErrorType>(
      "INVALID_MEDIA",
      "Only image and video files are allowed.",
      400,
    );
  }

  if (input.caption && input.caption.length >= 48) {
    throw new AppError<UploadPostErrorType>(
      "CAPTION_TOO_LONG",
      "Captions mustn't be longer than 48 characters",
      400,
    );
  }

  if (!input.authorId || !isValidUuid(input.authorId.trim())) {
    throw new AppError<UploadPostErrorType>("MISSING_INPUT", "Invalid author ID.", 400);
  }

  if (!input.timezone || input.timezone.trim().length === 0) {
    throw new AppError<UploadPostErrorType>(
      "MISSING_INPUT",
      "A valid IANA timezone is required.",
      400,
    );
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: input.timezone.trim() });
  } catch (err) {
    throw new AppError<UploadPostErrorType>("MISSING_INPUT", "Invalid timezone format.", 400);
  }

  if (input.width <= 0 || input.height <= 0 || input.width !== input.height) {
    throw new AppError<UploadPostErrorType>(
      "INVALID_DIMENSIONS",
      "Media must have positive, square dimensions.",
      400,
    );
  }

  if (normalizedContentType.startsWith("video/")) {
    if (!input.durationMs || input.durationMs <= 0 || input.durationMs > 4000) {
      throw new AppError<UploadPostErrorType>(
        "INVALID_DURATION",
        "Video must be no longer than 4 seconds.",
        400,
      );
    }
  } else if (input.durationMs != null) {
    throw new AppError<UploadPostErrorType>(
      "INVALID_DURATION",
      "Images cannot have a duration.",
      400,
    );
  }

  if (input.audienceType === "selected" && (!input.viewerIds || input.viewerIds.length === 0)) {
    throw new AppError<UploadPostErrorType>(
      "INVALID_AUDIENCE",
      "Selected audience requires at least one viewer ID.",
      400,
    );
  }

  if (input.viewerIds && !input.viewerIds.every((id) => isValidUuid(id.trim()))) {
    throw new AppError<UploadPostErrorType>("INVALID_AUDIENCE", "Invalid viewer UUID format.", 400);
  }
}

export async function initiatePostUpload(
  input: InitiatePostUploadInput,
): Promise<InitiatePostUploadResult> {
  console.log(
    `[DEBUG] [initiatePostUpload] Initiating post upload for authorId: ${input.authorId}, contentType: ${input.contentType}`,
  );
  validateInitiateInput(input);

  const normalizedAuthorId = input.authorId.trim();
  let uniqueViewerIds: string[] | undefined;

  if (input.audienceType === "selected" && input.viewerIds) {
    uniqueViewerIds = [...new Set(input.viewerIds.map((id) => id.trim()))];

    const friendIds = new Set(await getFriendIds(normalizedAuthorId));

    const allValid = uniqueViewerIds.every((viewerId) => friendIds.has(viewerId));
    if (!allValid) {
      console.warn(
        `[DEBUG] [initiatePostUpload] Audience validation failed for authorId: ${normalizedAuthorId}`,
      );
      throw new AppError<UploadPostErrorType>(
        "INVALID_AUDIENCE",
        "One or more viewer IDs are invalid or not on your friends list.",
        403,
      );
    }
  }

  const normalizedContentType = input.contentType.trim().toLowerCase();
  const postId = createUuidV7();

  const fileExtension = normalizedContentType.split("/")[1]?.split(";")[0]?.trim() || "bin";
  const objectKey = `posts/${postId}.${fileExtension}`;

  const UPLOAD_TTL = 600;
  try {
    console.log(
      `[DEBUG] [initiatePostUpload] Generating presigned upload URL for objectKey: ${objectKey}`,
    );
    const uploadUrl = await getUploadPresignedUrl(objectKey, normalizedContentType, UPLOAD_TTL);

    const ticketData = {
      authorId: normalizedAuthorId,
      contentType: normalizedContentType,
      caption: input.caption,
      captionType: input.captionType,
      captionMetadata: input.captionMetadata,
      audienceType: input.audienceType,
      viewerIds: uniqueViewerIds,
      timezone: input.timezone.trim(),
    };

    console.log(
      `[DEBUG] [initiatePostUpload] Creating upload ticket in Redis for postId: ${postId}`,
    );
    await redisClient.set(`upload_ticket:${postId}`, JSON.stringify(ticketData), "EX", UPLOAD_TTL);

    console.log(
      `[DEBUG] [initiatePostUpload] Post upload initiated successfully. postId: ${postId}`,
    );
    return {
      postId,
      objectKey,
      uploadUrl,
    };
  } catch (error) {
    console.error(`[ERROR] Unexpected error in use case: Initiate post upload\n${error}`);
    throw new AppError<UploadPostErrorType>(
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
  console.log(
    `[DEBUG] [finalizePostUpload] Finalize request received for postId: ${input.postId}, authorId: ${input.authorId}`,
  );
  if (!input.authorId || !input.postId || !input.objectKey) {
    throw new AppError<UploadPostErrorType>("MISSING_INPUT", "Missing required fields.", 400);
  }

  if (!isValidUuid(input.authorId.trim()) || !isValidUuid(input.postId.trim())) {
    throw new AppError<UploadPostErrorType>("MISSING_INPUT", "Invalid UUID format.", 400);
  }

  const normalizedAuthorId = input.authorId.trim();
  const normalizedPostId = input.postId.trim();
  const ticketKey = `upload_ticket:${normalizedPostId}`;

  try {
    console.log(`[DEBUG] [finalizePostUpload] Fetching upload ticket from Redis: ${ticketKey}`);
    const ticketString = await redisClient.get(ticketKey);

    if (!ticketString) {
      console.warn(
        `[DEBUG] [finalizePostUpload] Ticket not found or expired for key: ${ticketKey}`,
      );
      throw new AppError<UploadPostErrorType>(
        "TICKET_EXPIRED",
        "Upload session expired or invalid. Please try uploading again.",
        410,
      );
    }

    const ticketData = JSON.parse(ticketString);

    if (ticketData.authorId !== normalizedAuthorId) {
      console.warn(
        `[DEBUG] [finalizePostUpload] Author ID mismatch! Ticket authorId: ${ticketData.authorId}, Input authorId: ${normalizedAuthorId}`,
      );
      throw new AppError<UploadPostErrorType>(
        "UNAUTHORIZED",
        "You are not authorized to finalize this post.",
        403,
      );
    }

    console.log(
      `[DEBUG] [finalizePostUpload] Processing user streaks transaction for userId: ${normalizedAuthorId}`,
    );
    await withTx(async (tx) => {
      const [streakRow] = await tx
        .select()
        .from(userStreaks)
        .where(eq(userStreaks.userId, normalizedAuthorId))
        .limit(1);

      const currentStreak = streakRow?.currentStreak || 0;
      const longestStreak = streakRow?.longestStreak || 0;

      const lastPostDateUtc = streakRow?.lastPostDate ? new Date(streakRow.lastPostDate) : null;

      const streakMath = calculateNewStreak(
        currentStreak,
        longestStreak,
        lastPostDateUtc,
        ticketData.timezone,
      );

      console.log(
        `[DEBUG] [finalizePostUpload] Streak math result: currentStreak: ${currentStreak}, longestStreak: ${longestStreak}, newStreak: ${streakMath.newStreak}, isValidIncrement: ${streakMath.isValidIncrement}`,
      );

      if (streakMath.isValidIncrement) {
        const now = new Date().toISOString();

        await tx
          .insert(userStreaks)
          .values({
            id: createUuidV7(),
            userId: normalizedAuthorId,
            currentStreak: streakMath.newStreak,
            longestStreak: streakMath.isNewRecord ? streakMath.newStreak : longestStreak,
            lastPostDate: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: userStreaks.userId,
            set: {
              currentStreak: streakMath.newStreak,
              longestStreak: streakMath.isNewRecord ? streakMath.newStreak : longestStreak,
              lastPostDate: now,
              updatedAt: now,
            },
          });

        console.log(
          `[DEBUG] [finalizePostUpload] Updated user streak in DB to: ${streakMath.newStreak}`,
        );

        const milestones = [3, 7, 10, 30, 50, 100];
        if (milestones.includes(streakMath.newStreak)) {
          console.log(
            `[DEBUG] [finalizePostUpload] Enqueueing streak milestone push notification for user: ${normalizedAuthorId}`,
          );
          void enqueuePushNotification({
            recipientUserId: normalizedAuthorId,
            title: `🔥 ${streakMath.newStreak} Day Streak!`,
            body: "You're on fire! Keep the momentum going tomorrow",
            notificationType: "STREAK_MILESTONE",
          }).catch(console.error);
        }
      }
    });

    const jobPayload: UploadPostJobPayload = {
      postId: normalizedPostId,
      authorId: normalizedAuthorId,
      objectKey: input.objectKey,
      contentType: ticketData.contentType,
      caption: ticketData.caption,
      captionType: ticketData.captionType,
      captionMetadata: ticketData.captionMetadata,
      audienceType: ticketData.audienceType,
      viewerIds: ticketData.viewerIds,
    };

    console.log(
      `[DEBUG] [finalizePostUpload] Enqueueing post processing job for postId: ${normalizedPostId}`,
    );
    await enqueuePostUploadProcessing(jobPayload);

    console.log(`[DEBUG] [finalizePostUpload] Deleting upload ticket from Redis: ${ticketKey}`);
    await redisClient.del(ticketKey);

    return {
      message: "Post upload queued for processing.",
      postId: normalizedPostId,
      status: "processing",
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(`[ERROR] Failed to queue post ${normalizedPostId}:\n`, error);
    throw new AppError<UploadPostErrorType>(
      "INTERNAL_ERROR",
      "Failed to queue post processing.",
      500,
    );
  }
}
