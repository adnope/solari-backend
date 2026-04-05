import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { postReactions, postVisibility, posts, users } from "../../db/schema.ts";
import { enqueueJob } from "../../jobs/queue.ts";
import { hasBlockingRelationship } from "../common_queries.ts";

export type ReactPostInput = {
  userId: string;
  postId: string;
  emoji: string;
  note?: string;
};

export type ReactPostResult = {
  id: string;
  postId: string;
  userId: string;
  emoji: string;
  note: string | null;
  createdAt: string;
};

export type ReactPostErrorType =
  | "MISSING_INPUT"
  | "INVALID_NOTE"
  | "UNAUTHORIZED"
  | "POST_NOT_FOUND"
  | "INTERNAL_ERROR"
  | "INVALID_EMOJI";

export class ReactPostError extends Error {
  readonly type: ReactPostErrorType;
  readonly statusCode: number;

  constructor(type: ReactPostErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ReactPostError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function isSingleEmoji(input: string): boolean {
  const emojiRegex = /^\p{RGI_Emoji}$/v;
  return emojiRegex.test(input);
}

export async function reactPost(input: ReactPostInput): Promise<ReactPostResult> {
  const normalizedUserId = input.userId.trim();
  const normalizedPostId = input.postId.trim();
  const trimmedEmoji = input.emoji.trim();
  const trimmedNote = input.note?.trim();

  if (!normalizedUserId || !normalizedPostId || !trimmedEmoji) {
    throw new ReactPostError("MISSING_INPUT", "User ID, Post ID, and Emoji are required.", 400);
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedPostId)) {
    throw new ReactPostError("POST_NOT_FOUND", "Post not found.", 404);
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new ReactPostError("INVALID_EMOJI", "Reaction must be a single valid emoji.", 400);
  }

  if (trimmedNote && trimmedNote.length > 20) {
    throw new ReactPostError("INVALID_NOTE", "Note must be 20 characters or fewer.", 400);
  }

  const reactionId = Bun.randomUUIDv7();

  try {
    const { reactionResult, pushData } = await withTx(async (tx) => {
      const [postInfo] = await tx
        .select({
          authorId: posts.authorId,
        })
        .from(posts)
        .where(eq(posts.id, normalizedPostId))
        .limit(1);

      if (!postInfo) {
        throw new ReactPostError("POST_NOT_FOUND", "Post not found.", 404);
      }

      if (postInfo.authorId === normalizedUserId) {
        throw new ReactPostError(
          "UNAUTHORIZED",
          "You are not authorized to react to this post, or it is your own post.",
          403,
        );
      }

      const isBlocked = await hasBlockingRelationship(normalizedUserId, postInfo.authorId, tx);
      if (isBlocked) {
        throw new ReactPostError("POST_NOT_FOUND", "Post not found.", 404);
      }

      const [visible] = await tx
        .select({ viewerId: postVisibility.viewerId })
        .from(postVisibility)
        .where(
          and(
            eq(postVisibility.postId, normalizedPostId),
            eq(postVisibility.viewerId, normalizedUserId),
          ),
        )
        .limit(1);

      if (!visible) {
        throw new ReactPostError(
          "UNAUTHORIZED",
          "You are not authorized to react to this post, or it is your own post.",
          403,
        );
      }

      const [inserted] = await tx
        .insert(postReactions)
        .values({
          id: reactionId,
          postId: normalizedPostId,
          userId: normalizedUserId,
          emoji: trimmedEmoji,
          note: trimmedNote || null,
        })
        .returning({
          createdAt: postReactions.createdAt,
        });

      if (!inserted) {
        throw new ReactPostError("INTERNAL_ERROR", "Internal server error sending reaction.", 500);
      }

      const [reactor] = await tx
        .select({
          username: users.username,
          displayName: users.displayName,
          avatarKey: users.avatarKey,
        })
        .from(users)
        .where(eq(users.id, normalizedUserId))
        .limit(1);

      return {
        reactionResult: {
          id: reactionId,
          postId: normalizedPostId,
          userId: normalizedUserId,
          emoji: trimmedEmoji,
          note: trimmedNote || null,
          createdAt: inserted.createdAt,
        },
        pushData: {
          postOwnerId: postInfo.authorId,
          reactorName: reactor?.displayName || reactor?.username || "Someone",
          reactorAvatarKey: reactor?.avatarKey || "",
        },
      };
    });

    void (async () => {
      try {
        const extraData = {
          reactionId: reactionResult.id,
          postId: reactionResult.postId,
          emoji: reactionResult.emoji,
          avatarKey: pushData.reactorAvatarKey,
        };

        await enqueueJob("push-notification-processing", Bun.randomUUIDv7(), {
          recipientUserId: pushData.postOwnerId,
          title: "New Reaction",
          body: `${pushData.reactorName} reacted ${trimmedEmoji} to your post.`,
          notificationType: "NEW_POST_REACTION",
          extraData: extraData,
        });
      } catch (err) {
        console.error(`[ERROR] Failed to enqueue background push notification: ${err}`);
      }
    })();

    return reactionResult;
  } catch (error) {
    if (error instanceof ReactPostError) throw error;
    console.error(`[ERROR] Unexpected error in use case: React post\n${error}`);
    throw new ReactPostError("INTERNAL_ERROR", "Internal server error sending reaction.", 500);
  }
}
