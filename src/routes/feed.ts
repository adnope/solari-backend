import { Elysia, t } from "elysia";
import { requireAuth } from "./middleware/require_auth.ts";
import { getFeed, GetFeedError } from "../usecases/feed/get_feed.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";

// Get user's feed (posts of friends)
const protectedFeedRouter = new Elysia().use(requireAuth).get(
  "/feed",
  async ({ authUserId, query, set }) => {
    let authorIds: string[] | undefined;

    if (query.authors?.trim()) {
      authorIds = query.authors
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    }

    const limit = Number(query.limit) || 50;

    const result = await getFeed(authUserId, limit, query.cursor, authorIds);

    set.status = 200;
    return {
      items: result.items.map((post) => ({
        id: post.id,
        caption: post.caption,
        created_at: post.createdAt,
        author: {
          id: post.author.id,
          username: post.author.username,
          display_name: post.author.displayName,
          avatar_key: post.author.avatarKey,
        },
        media: {
          url: post.media.url,
          thumbnail_url: post.media.thumbnailUrl,
          media_type: post.media.mediaType,
          width: post.media.width,
          height: post.media.height,
          duration_ms: post.media.durationMs,
        },
      })),
      next_cursor: result.nextCursor,
    };
  },
  {
    query: t.Object({
      limit: t.Optional(t.String()),
      cursor: t.Optional(t.String()),
      authors: t.Optional(t.String()),
    }),
  },
);

const feedRouter = withApiErrorHandler(new Elysia(), {
  GetFeedError,
}).use(protectedFeedRouter);

export default feedRouter;
