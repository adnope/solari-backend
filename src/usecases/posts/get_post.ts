import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { postVisibility } from "../../db/schema.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { isValidUuid } from "../../utils/uuid.ts";
import { getNickname, getUserSummaryById, hasBlockingRelationship } from "../common_queries.ts";
import { getPostDetailById } from "../post_details.ts";
import type { CaptionMetadata } from "../../db/schema.ts";

export type GetPostAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type GetPostMedia = {
  url: string;
  thumbnailUrl: string;
  mediaType: string;
  width: number;
  height: number;
  durationMs: number | null;
};

export type GetPostResult = {
  id: string;
  caption: string | null;
  captionType: string;
  captionMetadata: CaptionMetadata | null;
  audienceType: "all" | "selected";
  createdAt: string;
  author: GetPostAuthor;
  media: GetPostMedia;
};

export type GetPostErrorType =
  | "MISSING_INPUT"
  | "POST_NOT_FOUND"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export class GetPostError extends Error {
  readonly type: GetPostErrorType;
  readonly statusCode: number;

  constructor(type: GetPostErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "GetPostError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function getPost(viewerId: string, postId: string): Promise<GetPostResult> {
  const normalizedViewerId = viewerId.trim();
  const normalizedPostId = postId.trim();

  if (!normalizedViewerId || !normalizedPostId) {
    throw new GetPostError("MISSING_INPUT", "Viewer ID and Post ID are required.", 400);
  }

  if (!isValidUuid(normalizedViewerId) || !isValidUuid(normalizedPostId)) {
    throw new GetPostError("POST_NOT_FOUND", "Post not found.", 404);
  }

  try {
    const post = await getPostDetailById(normalizedPostId);

    if (!post) {
      throw new GetPostError("POST_NOT_FOUND", "Post not found.", 404);
    }

    const isAuthor = post.authorId === normalizedViewerId;

    if (!isAuthor) {
      const isBlocked = await hasBlockingRelationship(normalizedViewerId, post.authorId);
      if (isBlocked) {
        throw new GetPostError("POST_NOT_FOUND", "Post not found.", 404);
      }

      const [visible] = await db
        .select({ viewerId: postVisibility.viewerId })
        .from(postVisibility)
        .where(
          and(
            eq(postVisibility.postId, normalizedPostId),
            eq(postVisibility.viewerId, normalizedViewerId),
          ),
        )
        .limit(1);

      if (!visible) {
        throw new GetPostError("UNAUTHORIZED", "You are not authorized to view this post.", 403);
      }
    }

    const [author, nickname, mediaUrl, thumbnailUrl] = await Promise.all([
      getUserSummaryById(post.authorId),
      isAuthor
        ? Promise.resolve<string | null>(null)
        : getNickname(normalizedViewerId, post.authorId),
      getFileUrl(post.objectKey),
      post.thumbnailKey ? getFileUrl(post.thumbnailKey) : Promise.resolve<string | null>(null),
    ]);

    if (!author) {
      throw new GetPostError("INTERNAL_ERROR", "Post author not found.", 500);
    }

    const avatarUrl = author.avatarKey ? await getFileUrl(author.avatarKey) : null;

    return {
      id: post.id,
      caption: post.caption,
      captionType: post.captionType,
      captionMetadata: post.captionMetadata,
      audienceType: post.audienceType,
      createdAt: post.createdAt,
      author: {
        id: author.id,
        username: author.username,
        displayName: nickname ?? author.displayName,
        avatarUrl,
      },
      media: {
        url: mediaUrl,
        thumbnailUrl: thumbnailUrl ?? mediaUrl,
        mediaType: post.mediaType,
        width: post.width,
        height: post.height,
        durationMs: post.durationMs,
      },
    };
  } catch (error) {
    if (error instanceof GetPostError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Get post\n${error}`);
    throw new GetPostError("INTERNAL_ERROR", "Internal server error fetching post.", 500);
  }
}
