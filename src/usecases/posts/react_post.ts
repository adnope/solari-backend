import { isValidUuid } from "../../utils/validation.ts";
import { withTx } from "../../db/client.ts";
import { postReactions } from "../../db/schema.ts";
import { enqueuePushNotification } from "../../jobs/queue.ts";
import { getNickname, getUserSummaryById } from "../common_queries.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";
import { getPostAccessContext } from "../../db/queries/get_post_access_context.ts";
import { AppError } from "../app_error.ts";

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
    throw new AppError<ReactPostErrorType>(
      "MISSING_INPUT",
      "User ID, Post ID, and Emoji are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedPostId)) {
    throw new AppError<ReactPostErrorType>("POST_NOT_FOUND", "Post not found.", 404);
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new AppError<ReactPostErrorType>(
      "INVALID_EMOJI",
      "Reaction must be a single valid emoji.",
      400,
    );
  }

  if (trimmedNote && trimmedNote.length > 20) {
    throw new AppError<ReactPostErrorType>(
      "INVALID_NOTE",
      "Note must be 20 characters or fewer.",
      400,
    );
  }

  const reactionId = Bun.randomUUIDv7();

  try {
    const { reactionResult, pushData } = await withTx(async (tx) => {
      const postInfo = await getPostAccessContext(normalizedUserId, normalizedPostId, tx);

      if (!postInfo) {
        throw new AppError<ReactPostErrorType>("POST_NOT_FOUND", "Post not found.", 404);
      }

      if (postInfo.authorId === normalizedUserId) {
        throw new AppError<ReactPostErrorType>(
          "UNAUTHORIZED",
          "You cannot react to your own post.",
          403,
        );
      }

      if (postInfo.isBlocked) {
        throw new AppError<ReactPostErrorType>("POST_NOT_FOUND", "Post not found.", 404);
      }

      if (!postInfo.isVisible) {
        throw new AppError<ReactPostErrorType>(
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
        throw new AppError<ReactPostErrorType>(
          "INTERNAL_ERROR",
          "Internal server error saving reaction.",
          500,
        );
      }

      const [reactor, nickname] = await Promise.all([
        getUserSummaryById(normalizedUserId, tx),
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
        },
      };
    });

    void (async () => {
      try {
        await enqueuePushNotification({
          recipientUserId: pushData.postOwnerId,
          title: "New Reaction",
          body: `${pushData.reactorName} reacted ${trimmedEmoji} to your post`,
          notificationType: "NEW_POST_REACTION",
          extraData: {
            reactionId: reactionResult.id,
            postId: reactionResult.postId,
            emoji: reactionResult.emoji,
          },
        });
      } catch (err) {
        console.error(`[ERROR] Background notification failure:`, err);
      }
    })();

    return reactionResult;
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;

    if (isPgErrorCode(error, PgErrorCode.INVALID_TEXT_REPRESENTATION)) {
      throw new AppError<ReactPostErrorType>("POST_NOT_FOUND", "Post not found.", 404);
    }

    console.error(`[ERROR] Unexpected error in use case: React post\n`, error);
    throw new AppError<ReactPostErrorType>(
      "INTERNAL_ERROR",
      "Internal server error sending reaction.",
      500,
    );
  }
}
