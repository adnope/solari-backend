import { Hono } from "@hono/hono";
import { AuthVariables, requireAuth } from "../middleware/require_auth.ts";
import { uploadPost, UploadPostError } from "../usecases/posts/upload_post.ts";
import { extractMediaMetadata } from "../utils/media_parser.ts";
import { deletePost, DeletePostError } from "../usecases/posts/delete_posts.ts";
import { sendReaction, SendReactionError } from "../usecases/posts/send_reaction.ts";
import { deleteReaction, DeleteReactionError } from "../usecases/posts/delete_reaction.ts";
import {
  viewPostReactions,
  ViewPostReactionsError,
} from "../usecases/posts/view_post_reactions.ts";
import { viewPost, ViewPostError } from "../usecases/posts/view_post.ts";
import { getPostViewers, GetPostViewersError } from "../usecases/posts/get_post_viewers.ts";

const postsRouter = new Hono<{
  Variables: AuthVariables;
}>();

// Upload a post
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

// Delete a post
postsRouter.delete("/posts/:postId", requireAuth, async (c) => {
  try {
    const authorId = c.get("authUserId");
    const postId = c.req.param("postId");

    if (!postId) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Post ID is required." } },
        400,
      );
    }

    await deletePost(authorId, postId);

    return c.json({ message: "Post deleted successfully." }, 200);
  } catch (error) {
    if (error instanceof DeletePostError) {
      return c.json(
        { error: { type: error.type, message: error.message } },
        error.statusCode,
      );
    }

    return c.json(
      { error: { type: "INTERNAL_ERROR", message: "Internal server error." } },
      500,
    );
  }
});

// Send a reaction to a post
postsRouter.post("/posts/:postId/reactions", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const postId = c.req.param("postId");
    const body = await c.req.json();

    const result = await sendReaction({
      userId,
      postId,
      emoji: body.emoji,
      note: body.note,
    });

    return c.json(
      {
        message: "Reaction sent successfully.",
        reaction: {
          id: result.id,
          post_id: result.postId,
          user_id: result.userId,
          emoji: result.emoji,
          note: result.note,
          created_at: result.createdAt,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof SendReactionError) {
      return c.json(
        { error: { type: error.type, message: error.message } },
        error.statusCode,
      );
    }

    if (error instanceof SyntaxError) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Invalid JSON body." } },
        400,
      );
    }

    return c.json(
      { error: { type: "INTERNAL_ERROR", message: "Internal server error." } },
      500,
    );
  }
});

// Delete a reaction of a post
postsRouter.delete("/posts/:postId/reactions/:reactionId", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const postId = c.req.param("postId");
    const reactionId = c.req.param("reactionId");

    if (!postId || !reactionId) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Post ID and Reaction ID are required." } },
        400,
      );
    }

    await deleteReaction(userId, postId, reactionId);

    return c.json({ message: "Reaction deleted successfully." }, 200);
  } catch (error) {
    if (error instanceof DeleteReactionError) {
      return c.json(
        { error: { type: error.type, message: error.message } },
        error.statusCode,
      );
    }

    return c.json(
      { error: { type: "INTERNAL_ERROR", message: "Internal server error." } },
      500,
    );
  }
});

// View the reactions of a post
postsRouter.get("/posts/:postId/reactions", requireAuth, async (c) => {
  try {
    const viewerId = c.get("authUserId");
    const postId = c.req.param("postId");

    if (!postId) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Post ID is required." } },
        400,
      );
    }

    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 100;
    const cursor = c.req.query("cursor");

    const result = await viewPostReactions(viewerId, postId, limit, cursor);

    return c.json(
      {
        items: result.items.map((reaction) => ({
          id: reaction.id,
          emoji: reaction.emoji,
          note: reaction.note,
          created_at: reaction.createdAt,
          user: {
            id: reaction.user.id,
            username: reaction.user.username,
            display_name: reaction.user.displayName,
            avatar_key: reaction.user.avatarKey,
          },
        })),
        next_cursor: result.nextCursor,
      },
      200,
    );
  } catch (error) {
    if (error instanceof ViewPostReactionsError) {
      return c.json(
        { error: { type: error.type, message: error.message } },
        error.statusCode,
      );
    }

    return c.json(
      { error: { type: "INTERNAL_ERROR", message: "Internal server error." } },
      500,
    );
  }
});

// View a post
postsRouter.post("/posts/:postId/views", requireAuth, async (c) => {
  try {
    const viewerId = c.get("authUserId");
    const postId = c.req.param("postId");

    if (!postId) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Post ID is required." } },
        400,
      );
    }

    await viewPost(viewerId, postId);

    return c.json({ message: "Post view recorded successfully." }, 200);
  } catch (error) {
    if (error instanceof ViewPostError) {
      return c.json(
        { error: { type: error.type, message: error.message } },
        error.statusCode,
      );
    }

    return c.json(
      { error: { type: "INTERNAL_ERROR", message: "Internal server error." } },
      500,
    );
  }
});

// Get the viewers of a post
postsRouter.get("/posts/:postId/viewers", requireAuth, async (c) => {
  try {
    const authorId = c.get("authUserId");
    const postId = c.req.param("postId");

    if (!postId) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Post ID is required." } },
        400,
      );
    }

    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 50;
    const cursor = c.req.query("cursor");

    const result = await getPostViewers(authorId, postId, limit, cursor);

    return c.json(
      {
        items: result.items.map((viewer) => ({
          id: viewer.id,
          username: viewer.username,
          display_name: viewer.displayName,
          avatar_key: viewer.avatarKey,
          viewed_at: viewer.viewedAt,
        })),
        next_cursor: result.nextCursor,
      },
      200,
    );
  } catch (error) {
    if (error instanceof GetPostViewersError) {
      return c.json(
        { error: { type: error.type, message: error.message } },
        error.statusCode,
      );
    }

    return c.json(
      { error: { type: "INTERNAL_ERROR", message: "Internal server error." } },
      500,
    );
  }
});

export default postsRouter;
