import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { getFileUrl } from "../../storage/minio.ts";
import { sendPushNotification } from "../../utils/fcm.ts";
import { isPgError } from "../postgres_error.ts";

export type SendReactionInput = {
  userId: string;
  postId: string;
  emoji: string;
  note?: string;
};

export type SendReactionResult = {
  id: string;
  postId: string;
  userId: string;
  emoji: string;
  note: string | null;
  createdAt: Date;
};

export type SendReactionErrorType =
  | "MISSING_INPUT"
  | "INVALID_NOTE"
  | "UNAUTHORIZED"
  | "POST_NOT_FOUND"
  | "INTERNAL_ERROR"
  | "INVALID_EMOJI";

export class SendReactionError extends Error {
  readonly type: SendReactionErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: SendReactionErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "SendReactionError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export function isSingleEmoji(input: string): boolean {
  const emojiRegex = /^\p{RGI_Emoji}$/v;
  return emojiRegex.test(input);
}

export async function sendReaction(input: SendReactionInput): Promise<SendReactionResult> {
  const trimmedEmoji = input.emoji.trim();
  const trimmedNote = input.note?.trim();

  if (!input.userId || !input.postId || !trimmedEmoji) {
    throw new SendReactionError("MISSING_INPUT", "User ID, Post ID, and Emoji are required.", 400);
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new SendReactionError("INVALID_EMOJI", "Reaction must be a single valid emoji.", 400);
  }

  if (trimmedNote && trimmedNote.length > 20) {
    throw new SendReactionError("INVALID_NOTE", "Note must be 20 characters or fewer.", 400);
  }

  const reactionId = Bun.randomUUIDv7();

  try {
    const { reactionResult, pushData } = await withDb(async (client) => {
      return await client.begin(async (tx) => {
        const postCheckResult = await tx<{ author_id: string; is_visible: boolean }[]>`
          SELECT
            p.author_id,
            EXISTS (
              SELECT 1 FROM post_visibility pv
              WHERE pv.post_id = p.id AND pv.viewer_id = ${input.userId}
            ) AS is_visible
          FROM posts p
          WHERE p.id = ${input.postId}
          LIMIT 1
        `;

        const postInfo = postCheckResult[0];
        if (!postInfo) {
          throw new SendReactionError("POST_NOT_FOUND", "Post not found.", 404);
        }

        if (!postInfo.is_visible || postInfo.author_id === input.userId) {
          throw new SendReactionError(
            "UNAUTHORIZED",
            "You are not authorized to react to this post, or it is your own post.",
            403,
          );
        }

        const insertResult = await tx<{ created_at: Date }[]>`
          INSERT INTO post_reactions (id, post_id, user_id, emoji, note)
          VALUES (${reactionId}, ${input.postId}, ${input.userId}, ${trimmedEmoji}, ${trimmedNote || null})
          RETURNING created_at
        `;

        const reactorResult = await tx<
          { username: string; display_name: string | null; avatar_key: string | null }[]
        >`
          SELECT username, display_name, avatar_key FROM users WHERE id = ${input.userId} LIMIT 1
        `;
        const reactorName =
          reactorResult[0]?.display_name || reactorResult[0]?.username || "Someone";
        const reactorAvatarKey = reactorResult[0]?.avatar_key;

        const devicesResult = await tx<{ device_token: string }[]>`
          SELECT device_token FROM user_devices WHERE user_id = ${postInfo.author_id}
        `;
        const tokens = devicesResult.map((row) => row.device_token);

        return {
          reactionResult: {
            id: reactionId,
            postId: input.postId,
            userId: input.userId,
            emoji: trimmedEmoji,
            note: trimmedNote || null,
            createdAt: insertResult[0]!.created_at,
          },
          pushData: { tokens, reactorName, reactorAvatarKey },
        };
      });
    });

    if (pushData.tokens.length > 0) {
      const title = "New Reaction";
      const body = `${pushData.reactorName} reacted ${trimmedEmoji} to your post.`;

      let avatarUrl = "";
      if (pushData.reactorAvatarKey) {
        avatarUrl = await getFileUrl(pushData.reactorAvatarKey);
      }

      const extraData = {
        reactionId: reactionResult.id,
        postId: reactionResult.postId,
        emoji: reactionResult.emoji,
        avatarUrl: avatarUrl,
      };

      Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(token, title, body, "NEW_POST_REACTION", extraData),
        ),
      ).catch(console.error);
    }

    return reactionResult;
  } catch (error: any) {
    if (error instanceof SendReactionError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new SendReactionError("POST_NOT_FOUND", "Post not found.", 404);
    }

    throw new SendReactionError("INTERNAL_ERROR", "Internal server error sending reaction.", 500);
  }
}
