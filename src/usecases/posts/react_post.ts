import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { postReactions, postVisibility, posts, users } from "../../db/schema.ts";
import { enqueuePushNotification } from "../../jobs/queue.ts";
import { hasBlockingRelationship, getNickname } from "../common_queries.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";

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
        .select({ authorId: posts.authorId })
        .from(posts)
        .where(eq(posts.id, normalizedPostId))
        .limit(1);

      if (!postInfo) {
        throw new ReactPostError("POST_NOT_FOUND", "Post not found.", 404);
      }

      if (postInfo.authorId === normalizedUserId) {
        throw new ReactPostError("UNAUTHORIZED", "You cannot react to your own post.", 403);
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
          "You are not authorized to react to this post.",
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
        throw new ReactPostError("INTERNAL_ERROR", "Internal server error saving reaction.", 500);
      }

      const [reactor, nickname] = await Promise.all([
        tx
          .select({
            username: users.username,
            displayName: users.displayName,
            avatarKey: users.avatarKey,
          })
          .from(users)
          .where(eq(users.id, normalizedUserId))
          .limit(1)
          .then((res) => res[0]),

        getNickname(postInfo.authorId, normalizedUserId, tx),
      ]);

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
          reactorName: nickname ?? reactor?.displayName ?? reactor?.username ?? "Someone",
          reactorAvatarKey: reactor?.avatarKey || "",
        },
      };
    });

    void (async () => {
      try {
        await enqueuePushNotification({
          recipientUserId: pushData.postOwnerId,
          title: "New Reaction",
          body: `${pushData.reactorName} reacted ${trimmedEmoji} to your post.`,
          notificationType: "NEW_POST_REACTION",
          extraData: {
            reactionId: reactionResult.id,
            postId: reactionResult.postId,
            emoji: reactionResult.emoji,
            avatarKey: pushData.reactorAvatarKey,
          },
        });
      } catch (err) {
        console.error(`[ERROR] Background notification failure:`, err);
      }
    })();

    return reactionResult;
  } catch (error: unknown) {
    if (error instanceof ReactPostError) throw error;

    if (isPgErrorCode(error, PgErrorCode.INVALID_TEXT_REPRESENTATION)) {
      throw new ReactPostError("POST_NOT_FOUND", "Post not found.", 404);
    }

    console.error(`[ERROR] Unexpected error in use case: React post\n`, error);
    throw new ReactPostError("INTERNAL_ERROR", "Internal server error sending reaction.", 500);
  }
}
