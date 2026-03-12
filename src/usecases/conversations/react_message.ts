import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { v7 } from "@std/uuid";
import { withDb } from "../../db/postgres_client.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { sendPushNotification } from "../../utils/fcm.ts";
import { isPgError } from "../postgres_error.ts";

export type ReactMessageInput = {
  userId: string;
  messageId: string;
  emoji: string;
};

export type ReactMessageResult = {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: Date;
};

export type ReactMessageErrorType =
  | "MISSING_INPUT"
  | "INVALID_EMOJI"
  | "UNAUTHORIZED_OR_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ReactMessageError extends Error {
  readonly type: ReactMessageErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: ReactMessageErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "ReactMessageError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export function isSingleEmoji(input: string): boolean {
  const emojiRegex = /^\p{RGI_Emoji}$/v;
  return emojiRegex.test(input);
}

export async function reactMessage(input: ReactMessageInput): Promise<ReactMessageResult> {
  const trimmedEmoji = input.emoji?.trim();
  if (!input.userId || !input.messageId || !trimmedEmoji) {
    throw new ReactMessageError(
      "MISSING_INPUT",
      "User ID, Message ID, and Emoji are required.",
      400,
    );
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new ReactMessageError("INVALID_EMOJI", "Invalid emoji.", 400);
  }

  const reactionId = v7.generate();

  try {
    const { reactionResult, pushData } = await withDb(async (client) => {
      const tx = client.createTransaction("react_message_tx");
      await tx.begin();

      try {
        const msgResult = await tx.queryObject<{ sender_id: string; conversation_id: string }>`
          SELECT m.sender_id, m.conversation_id
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE m.id = ${input.messageId}
            AND (
              (c.user_low = ${input.userId} AND (c.user_low_cleared_at IS NULL OR m.created_at >= c.user_low_cleared_at))
              OR
              (c.user_high = ${input.userId} AND (c.user_high_cleared_at IS NULL OR m.created_at >= c.user_high_cleared_at))
            )
          LIMIT 1
        `;

        if (msgResult.rows.length === 0) {
          throw new ReactMessageError(
            "UNAUTHORIZED_OR_NOT_FOUND",
            "Message not found or authorized.",
            404,
          );
        }

        const msg = msgResult.rows[0];
        const result = await tx.queryObject<{ id: string; created_at: Date }>`
          INSERT INTO message_reactions (id, message_id, user_id, emoji)
          VALUES (${reactionId}, ${input.messageId}, ${input.userId}, ${trimmedEmoji})
          ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji
          RETURNING id, created_at
        `;

        let pushData = null;
        if (msg.sender_id !== input.userId) {
          const reactorResult = await tx.queryObject<
            { username: string; display_name: string | null; avatar_key: string | null }
          >`
            SELECT username, display_name, avatar_key FROM users WHERE id = ${input.userId} LIMIT 1
          `;
          const reactor = reactorResult.rows[0];
          const tokensResult = await tx.queryObject<{ device_token: string }>`
            SELECT device_token FROM user_devices WHERE user_id = ${msg.sender_id}
          `;

          pushData = {
            tokens: tokensResult.rows.map((r) => r.device_token),
            reactorName: reactor?.display_name || reactor?.username || "Someone",
            reactorAvatarKey: reactor?.avatar_key,
            conversationId: msg.conversation_id,
          };
        }

        await tx.commit();
        return {
          reactionResult: {
            id: result.rows[0].id,
            messageId: input.messageId,
            userId: input.userId,
            emoji: trimmedEmoji,
            createdAt: result.rows[0].created_at,
          },
          pushData,
        };
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    });

    if (pushData && pushData.tokens.length > 0) {
      const avatarUrl = pushData.reactorAvatarKey
        ? await getFileUrl(pushData.reactorAvatarKey)
        : "";
      const extraData = {
        conversationId: pushData.conversationId,
        messageId: reactionResult.messageId,
        avatarUrl,
      };

      Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(
            token,
            "New Reaction",
            `${pushData.reactorName} reacted ${trimmedEmoji}`,
            "NEW_MESSAGE_REACTION",
            extraData,
          )
        ),
      ).catch(console.error);
    }

    return reactionResult;
  } catch (error) {
    if (error instanceof ReactMessageError) throw error;
    if (isPgError(error) && error.code === "22P02") {
      throw new ReactMessageError("UNAUTHORIZED_OR_NOT_FOUND", "Invalid ID.", 404);
    }
    throw new ReactMessageError("INTERNAL_ERROR", "Error adding reaction.", 500);
  }
}
