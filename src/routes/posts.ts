import { Hono } from "@hono/hono";
import { AuthVariables, requireAuth } from "../middleware/require_auth.ts";
import { uploadPost, UploadPostError } from "../usecases/upload_post.ts";
import { extractMediaMetadata } from "../utils/media_parser.ts";

const postsRouter = new Hono<{
  Variables: AuthVariables;
}>();

postsRouter.post("/posts", requireAuth, async (c) => {
  try {
    const authorId = c.get("authUserId");
    const body = await c.req.parseBody();

    const mediaFile = body["media"];
    if (!(mediaFile instanceof File)) {
      return c.json(
        {
          error: { type: "MISSING_INPUT", message: "Media file is required." },
        },
        400,
      );
    }

    if (
      body["audience_type"] !== "selected" && body["audience_type"] !== "all"
    ) {
      return c.json({
        error: {
          type: "INVALID_AUDIENCE",
          message: `Invalid audience type, it should be 'all' or 'selected'`,
        },
      }, 400);
    }
    const audienceType = body["audience_type"];

    const buffer = new Uint8Array(await mediaFile.arrayBuffer());
    const contentType = mediaFile.type;
    const byteSize = mediaFile.size;

    const metadata = await extractMediaMetadata(buffer, contentType);

    const caption = typeof body["caption"] === "string" ? body["caption"] : undefined;

    let viewerIds: string[] | undefined = undefined;
    const rawViewerIds = body["viewer_ids"];

    if (typeof rawViewerIds === "string" && rawViewerIds.trim().length > 0) {
      viewerIds = rawViewerIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    }

    if (audienceType === "selected" && (!viewerIds || viewerIds.length === 0)) {
      return c.json(
        {
          error: {
            type: "INVALID_AUDIENCE",
            message: "At least 1 viewer id must be specified if audience type is 'selected'",
          },
        },
        400,
      );
    }

    if (audienceType === "all" && viewerIds) {
      return c.json(
        {
          error: {
            type: "INVALID_AUDIENCE",
            message: "No viewer ids should be specified when audience type is 'all'",
          },
        },
        400,
      );
    }

    const result = await uploadPost({
      authorId,
      caption,
      audienceType,
      viewerIds,
      buffer,
      contentType,
      byteSize,
      mediaType: metadata.mediaType,
      width: metadata.width,
      height: metadata.height,
      durationMs: metadata.durationMs,
    });

    return c.json(
      {
        message: "Post uploaded successfully.",
        post: {
          id: result.id,
          author_id: result.authorId,
          caption: result.caption,
          audience_type: result.audienceType,
          created_at: result.createdAt,
          media: {
            object_key: result.media.objectKey,
            media_type: result.media.mediaType,
            width: result.media.width,
            height: result.media.height,
          },
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof UploadPostError) {
      return c.json(
        { error: { type: error.type, message: error.message } },
        error.statusCode,
      );
    }

    if (
      error instanceof Error &&
      (error.message.includes("Could not parse") ||
        error.message.includes("ffprobe"))
    ) {
      return c.json({
        error: {
          type: "INVALID_MEDIA",
          message: "The uploaded media file is invalid or corrupt.",
        },
      }, 400);
    }

    return c.json({
      error: { type: "INTERNAL_ERROR", message: "Internal server error." },
    }, 500);
  }
});

export default postsRouter;
