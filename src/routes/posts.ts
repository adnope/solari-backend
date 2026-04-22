import { Elysia, t } from "elysia";
import { requireAuth } from "./middleware/require_auth.ts";
import { deletePost, DeletePostError } from "../usecases/posts/delete_post.ts";
import { deleteReaction, DeleteReactionError } from "../usecases/posts/delete_reaction.ts";
import { getPostViewers, GetPostViewersError } from "../usecases/posts/get_post_viewers.ts";
import { reactPost, ReactPostError } from "../usecases/posts/react_post.ts";
import { viewPost, ViewPostError } from "../usecases/posts/view_post.ts";
import {
  viewPostReactions,
  ViewPostReactionsError,
} from "../usecases/posts/view_post_reactions.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";
import { UploadPostError } from "../usecases/posts/upload_post.ts";
import { finalizePostUpload, initiatePostUpload } from "../usecases/posts/upload_post.ts";
import { getPostUploadStatuses } from "../usecases/posts/get_post_upload_status.ts";

class PostsRequestError extends Error {
  constructor(
    public type: string,
    public override message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

const protectedPostsRouter = new Elysia()
  .use(requireAuth)

  // Initiate a post upload
  .post(
    "/posts/initiate",
    async ({ authUserId, body, set }) => {
      const audienceType = body.audience_type;
      let viewerIds: string[] | undefined;

      if (body.viewer_ids?.trim()) {
        viewerIds = body.viewer_ids
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
      }

      if (audienceType === "selected" && (!viewerIds || viewerIds.length === 0)) {
        throw new UploadPostError(
          "INVALID_AUDIENCE",
          "At least 1 viewer id must be specified if audience type is 'selected'",
          400,
        );
      }

      if (audienceType === "all" && viewerIds && viewerIds.length > 0) {
        throw new UploadPostError(
          "INVALID_AUDIENCE",
          "No viewer ids should be specified when audience type is 'all'",
          400,
        );
      }

      const caption = body.caption?.trim() ? body.caption : undefined;

      const result = await initiatePostUpload({
        authorId: authUserId,
        contentType: body.content_type,
        caption: caption,
        audienceType: audienceType,
        viewerIds: viewerIds,
        width: body.width,
        height: body.height,
        byteSize: body.byte_size,
        durationMs: body.duration_ms,
        timezone: body.timezone,
      });

      set.status = 200;
      return {
        post_id: result.postId,
        object_key: result.objectKey,
        upload_url: result.uploadUrl,
      };
    },
    {
      body: t.Object({
        content_type: t.String(),
        caption: t.Optional(t.String()),
        audience_type: t.Union([t.Literal("all"), t.Literal("selected")]),
        viewer_ids: t.Optional(t.String()),
        width: t.Number(),
        height: t.Number(),
        byte_size: t.Number(),
        duration_ms: t.Optional(t.Number()),
        timezone: t.String(),
      }),
    },
  )

  // Finalize post upload
  .post(
    "/posts/finalize",
    async ({ authUserId, body, set }) => {
      const result = await finalizePostUpload({
        authorId: authUserId,
        postId: body.post_id,
        objectKey: body.object_key,
      });

      set.status = 202;
      return {
        message: result.message,
        post_id: result.postId,
        status: result.status,
      };
    },
    {
      body: t.Object({
        post_id: t.String(),
        object_key: t.String(),
      }),
    },
  )

  // Check the status of pending uploads
  .get(
    "/posts/statuses",
    async ({ authUserId, query, set }) => {
      const idsString = query.ids;

      if (!idsString?.trim()) {
        return { statuses: {} };
      }

      const idsArray = idsString
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      const statuses = await getPostUploadStatuses(authUserId, idsArray);

      set.status = 200;
      return {
        statuses: statuses,
      };
    },
    {
      query: t.Object({
        ids: t.Optional(
          t.String({
            description: "Comma-separated list of post UUIDs (e.g., id1,id2,id3)",
          }),
        ),
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
        ...(body.note !== undefined && { note: body.note }),
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
            avatar_url: reaction.user.avatarUrl,
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
      const limit = Number(query.limit) || 50;
      const result = await getPostViewers(authUserId, params.postId, limit, query.cursor);

      set.status = 200;
      return {
        items: result.items.map((viewer) => ({
          id: viewer.id,
          username: viewer.username,
          display_name: viewer.displayName,
          avatar_url: viewer.avatarUrl,
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
        limit: t.Optional(t.String()),
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
