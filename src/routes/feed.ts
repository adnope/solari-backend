import { Hono } from "@hono/hono";
import { type AuthVariables, requireAuth } from "../middleware/require_auth.ts";
import { getFeed, GetFeedError } from "../usecases/feed/get_feed.ts";

const feedRouter = new Hono<{ Variables: AuthVariables }>();

feedRouter.get("/feed", requireAuth, async (c) => {
  try {
    const viewerId = c.get("authUserId");

    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 20;
    const cursor = c.req.query("cursor");

    let authorIds: string[] | undefined = undefined;
    const authorsQuery = c.req.query("authors");
    if (authorsQuery && authorsQuery.trim().length > 0) {
      authorIds = authorsQuery
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    }

    const result = await getFeed(viewerId, limit, cursor, authorIds);

    return c.json(
      {
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
      },
      200,
    );
  } catch (error) {
    if (error instanceof GetFeedError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

export default feedRouter;
