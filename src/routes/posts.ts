import { Elysia, t } from "elysia";
import { requireAuth } from "./middleware/require_auth.ts";
import { deletePost, DeletePostError } from "../usecases/posts/delete_post.ts";
import { deleteReaction, DeleteReactionError } from "../usecases/posts/delete_reaction.ts";
import { getPostViewers, GetPostViewersError } from "../usecases/posts/get_post_viewers.ts";
import { reactPost, ReactPostError } from "../usecases/posts/react_post.ts";
import { uploadPost, UploadPostError } from "../usecases/posts/upload_post.ts";
import { viewPost, ViewPostError } from "../usecases/posts/view_post.ts";
import {
  viewPostReactions,
  ViewPostReactionsError,
} from "../usecases/posts/view_post_reactions.ts";
import { extractMediaMetadata } from "../utils/media_parser.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";

class PostsRequestError extends Error {
  constructor(
    public type: string,
    public override message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

const isInvalidMediaParseError = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes("Could not parse") || error.message.includes("ffprobe"));

const protectedPostsRouter = new Elysia()
  .use(requireAuth)

  // Upload a post
  .post(
    "/posts",
    async ({ authUserId, body, set }) => {
      const mediaFile = body.media;

      const contentType = mediaFile.type;
      const byteSize = mediaFile.size;

      if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
        throw new PostsRequestError(
          "INVALID_MEDIA",
          "Only image and video files are allowed.",
          400,
        );
      }

      const caption = body.caption?.trim() ? body.caption : undefined;
      const audienceType = body.audience_type;

      let viewerIds: string[] | undefined;

      if (body.viewer_ids?.trim()) {
        viewerIds = body.viewer_ids
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
      }

      if (audienceType === "selected" && (!viewerIds || viewerIds.length === 0)) {
        throw new PostsRequestError(
          "INVALID_AUDIENCE",
          "At least 1 viewer id must be specified if audience type is 'selected'",
          400,
        );
      }

      if (audienceType === "all" && viewerIds && viewerIds.length > 0) {
        throw new PostsRequestError(
          "INVALID_AUDIENCE",
          "No viewer ids should be specified when audience type is 'all'",
          400,
        );
      }

      const buffer = new Uint8Array(await mediaFile.arrayBuffer());

      let metadata;
      try {
        metadata = await extractMediaMetadata(buffer, contentType);
      } catch (error) {
        if (isInvalidMediaParseError(error)) {
          throw new PostsRequestError(
            "INVALID_MEDIA",
            "The uploaded media file is invalid or corrupt.",
            400,
          );
        }
        throw error;
      }

      const result = await uploadPost({
        authorId: authUserId,
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

      set.status = 201;
      return {
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
      };
    },
    {
      parse: "formdata",
      body: t.Object({
        media: t.File(),
        caption: t.Optional(t.String()),
        audience_type: t.Union([t.Literal("all"), t.Literal("selected")]),
        viewer_ids: t.Optional(t.String()),
      }),
    },
  )

  // Delete a post
  .delete(
    "/posts/:postId",
    async ({ authUserId, params, set }) => {
      await deletePost(authUserId, params.postId);

      set.status = 200;
      return {
        message: "Post deleted successfully.",
      };
    },
    {
      params: t.Object({
        postId: t.String(),
      }),
    },
  )

  // Send a reaction to a post
  .post(
    "/posts/:postId/reactions",
    async ({ authUserId, params, body, set }) => {
      const result = await reactPost({
        userId: authUserId,
        postId: params.postId,
        emoji: body.emoji,
        note: body.note,
      });

      set.status = 201;
      return {
        message: "Reaction sent successfully.",
        reaction: {
          id: result.id,
          post_id: result.postId,
          user_id: result.userId,
          emoji: result.emoji,
          note: result.note,
          created_at: result.createdAt,
        },
      };
    },
    {
      params: t.Object({
        postId: t.String(),
      }),
      body: t.Object({
        emoji: t.String(),
        note: t.Optional(t.String()),
      }),
    },
  )

  // Delete a reaction of a post
  .delete(
    "/posts/:postId/reactions/:reactionId",
    async ({ authUserId, params, set }) => {
      await deleteReaction(authUserId, params.postId, params.reactionId);

      set.status = 200;
      return {
        message: "Reaction deleted successfully.",
      };
    },
    {
      params: t.Object({
        postId: t.String(),
        reactionId: t.String(),
      }),
    },
  )

  // View the reactions of a post
  .get(
    "/posts/:postId/reactions",
    async ({ authUserId, params, query, set }) => {
      const limit = query.limit === undefined || query.limit === "" ? 100 : Number(query.limit);
      const result = await viewPostReactions(authUserId, params.postId, limit, query.cursor);

      set.status = 200;
      return {
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
      };
    },
    {
      params: t.Object({
        postId: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.Union([t.Numeric(), t.Literal("")])),
        cursor: t.Optional(t.String()),
      }),
    },
  )

  // View a post
  .post(
    "/posts/:postId/views",
    async ({ authUserId, params, set }) => {
      await viewPost(authUserId, params.postId);

      set.status = 200;
      return {
        message: "Post view recorded successfully.",
      };
    },
    {
      params: t.Object({
        postId: t.String(),
      }),
    },
  )

  // Get the viewers of a post
  .get(
    "/posts/:postId/viewers",
    async ({ authUserId, params, query, set }) => {
      const limit = query.limit === undefined || query.limit === "" ? 50 : Number(query.limit);
      const result = await getPostViewers(authUserId, params.postId, limit, query.cursor);

      set.status = 200;
      return {
        items: result.items.map((viewer) => ({
          id: viewer.id,
          username: viewer.username,
          display_name: viewer.displayName,
          avatar_key: viewer.avatarKey,
          viewed_at: viewer.viewedAt,
        })),
        next_cursor: result.nextCursor,
      };
    },
    {
      params: t.Object({
        postId: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.Union([t.Numeric(), t.Literal("")])),
        cursor: t.Optional(t.String()),
      }),
    },
  );

const postsRouter = withApiErrorHandler(new Elysia(), {
  PostsRequestError,
  UploadPostError,
  DeletePostError,
  ReactPostError,
  DeleteReactionError,
  ViewPostReactionsError,
  ViewPostError,
  GetPostViewersError,
}).use(protectedPostsRouter);

export default postsRouter;
