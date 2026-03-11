import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { getFileUrl } from "../../storage/minio.ts";
import { sendPushNotification } from "../../utils/fcm.ts";
import { isPgError } from "../postgres_error.ts";
import { v7 } from "@std/uuid";

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
  createdAt: Date;
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
  readonly statusCode: ContentfulStatusCode;

  constructor(type: ReactPostErrorType, message: string, statusCode: ContentfulStatusCode) {
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
  const trimmedEmoji = input.emoji.trim();
  const trimmedNote = input.note?.trim();

  if (!input.userId || !input.postId || !trimmedEmoji) {
    throw new ReactPostError("MISSING_INPUT", "User ID, Post ID, and Emoji are required.", 400);
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new ReactPostError("INVALID_EMOJI", "Reaction must be a single valid emoji.", 400);
  }

  if (trimmedNote && trimmedNote.length > 20) {
    throw new ReactPostError("INVALID_NOTE", "Note must be 20 characters or fewer.", 400);
  }

  const reactionId = v7.generate();

  try {
    const { reactionResult, pushData } = await withDb(async (client) => {
      const tx = client.createTransaction("send_reaction_tx");
      await tx.begin();

      try {
        const postCheckResult = await tx.queryObject<{ author_id: string; is_visible: boolean }>`
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

        const postInfo = postCheckResult.rows[0];
        if (!postInfo) {
          throw new ReactPostError("POST_NOT_FOUND", "Post not found.", 404);
        }

        if (!postInfo.is_visible || postInfo.author_id === input.userId) {
          throw new ReactPostError(
            "UNAUTHORIZED",
            "You are not authorized to react to this post, or it is your own post.",
            403,
          );
        }

        const insertResult = await tx.queryObject<{ created_at: Date }>`
            INSERT INTO post_reactions (id, post_id, user_id, emoji, note)
            VALUES (${reactionId}, ${input.postId}, ${input.userId}, ${trimmedEmoji}, ${
          trimmedNote || null
        })
            RETURNING created_at
          `;

        const reactorResult = await tx.queryObject<{
          username: string;
          display_name: string | null;
          avatar_key: string | null;
        }>`
            SELECT username, display_name, avatar_key FROM users WHERE id = ${input.userId} LIMIT 1
          `;

        const reactor = reactorResult.rows[0];
        const reactorName = reactor?.display_name || reactor?.username || "Someone";
        const reactorAvatarKey = reactor?.avatar_key;

        const devicesResult = await tx.queryObject<{ device_token: string }>`
            SELECT device_token FROM user_devices WHERE user_id = ${postInfo.author_id}
          `;
        const tokens = devicesResult.rows.map((row) => row.device_token);

        await tx.commit();

        return {
          reactionResult: {
            id: reactionId,
            postId: input.postId,
            userId: input.userId,
            emoji: trimmedEmoji,
            note: trimmedNote || null,
            createdAt: insertResult.rows[0]!.created_at,
          },
          pushData: { tokens, reactorName, reactorAvatarKey },
        };
      } catch (error) {
        await tx.rollback();
        throw error;
      }
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
          sendPushNotification(token, title, body, "NEW_POST_REACTION", extraData)
        ),
      ).catch(console.error);
    }

    return reactionResult;
  } catch (error) {
    if (error instanceof ReactPostError) throw error;

    if (isPgError(error) && error.code === "22P02") {
      throw new ReactPostError("POST_NOT_FOUND", "Post not found.", 404);
    }

    throw new ReactPostError("INTERNAL_ERROR", "Internal server error sending reaction.", 500);
  }
}
