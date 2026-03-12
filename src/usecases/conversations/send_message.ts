import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { v7 } from "@std/uuid";
import { withDb } from "../../db/postgres_client.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { sendPushNotification } from "../../utils/fcm.ts";
import { isPgError } from "../postgres_error.ts";

export type SendMessageInput = {
  senderId: string;
  conversationId: string;
  content: string;
  referencedPostId?: string;
};

export type SendMessageResult = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  referencedPostId: string | null;
  createdAt: Date;
};

export type SendMessageErrorType =
  | "MISSING_INPUT"
  | "EMPTY_CONTENT"
  | "CONVERSATION_NOT_FOUND"
  | "POST_NOT_FOUND"
  | "CANNOT_REFERENCE_OWN_POST"
  | "INTERNAL_ERROR";

export class SendMessageError extends Error {
  readonly type: SendMessageErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: SendMessageErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "SendMessageError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const trimmedContent = input.content?.trim();
  if (!input.senderId || !input.conversationId) {
    throw new SendMessageError("MISSING_INPUT", "Required fields missing.", 400);
  }
  if (!trimmedContent) throw new SendMessageError("EMPTY_CONTENT", "Content is empty.", 400);

  const messageId = v7.generate();

  try {
    const { messageResult, pushData } = await withDb(async (client) => {
      const tx = client.createTransaction("send_message_tx");
      await tx.begin();

      try {
        if (input.referencedPostId) {
          const post = await tx.queryObject<
            { author_id: string }
          >`SELECT author_id FROM posts WHERE id = ${input.referencedPostId}`;
          if (post.rows.length === 0) {
            throw new SendMessageError("POST_NOT_FOUND", "Post not found.", 404);
          }
          if (post.rows[0].author_id === input.senderId) {
            throw new SendMessageError(
              "CANNOT_REFERENCE_OWN_POST",
              "Cannot reference own post.",
              400,
            );
          }
        }

        const convCheck = await tx.queryObject<
          { user_low: string; user_high: string }
        >`SELECT user_low, user_high FROM conversations WHERE id = ${input.conversationId}`;
        if (convCheck.rows.length === 0) {
          throw new SendMessageError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
        }

        const conv = convCheck.rows[0];
        if (conv.user_low !== input.senderId && conv.user_high !== input.senderId) {
          throw new SendMessageError("CONVERSATION_NOT_FOUND", "Unauthorized.", 404);
        }

        const receiverId = conv.user_low === input.senderId ? conv.user_high : conv.user_low;
        const insertResult = await tx.queryObject<{ created_at: Date }>`
          INSERT INTO messages (id, conversation_id, sender_id, content, referenced_post_id)
          VALUES (${messageId}, ${input.conversationId}, ${input.senderId}, ${trimmedContent}, ${
          input.referencedPostId || null
        })
          RETURNING created_at
        `;

        await tx.queryObject`UPDATE conversations SET updated_at = ${
          insertResult.rows[0].created_at
        } WHERE id = ${input.conversationId}`;

        const senderResult = await tx.queryObject<
          { username: string; display_name: string | null; avatar_key: string | null }
        >`SELECT username, display_name, avatar_key FROM users WHERE id = ${input.senderId} LIMIT 1`;
        const sender = senderResult.rows[0];
        const tokensResult = await tx.queryObject<
          { device_token: string }
        >`SELECT device_token FROM user_devices WHERE user_id = ${receiverId}`;

        await tx.commit();
        return {
          messageResult: {
            id: messageId,
            conversationId: input.conversationId,
            senderId: input.senderId,
            content: trimmedContent,
            referencedPostId: input.referencedPostId || null,
            createdAt: insertResult.rows[0].created_at,
          },
          pushData: {
            tokens: tokensResult.rows.map((r) => r.device_token),
            senderName: sender?.display_name || sender?.username || "Someone",
            senderAvatarKey: sender?.avatar_key,
          },
        };
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    });

    if (pushData.tokens.length > 0) {
      const avatarUrl = pushData.senderAvatarKey ? await getFileUrl(pushData.senderAvatarKey) : "";
      const isReply = !!input.referencedPostId;
      const title = isReply ? "New Post Reply" : "New Message";
      const body = isReply
        ? `${pushData.senderName} replied to your post.`
        : `${pushData.senderName} sent a message.`;

      Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(token, title, body, "NEW_MESSAGE", {
            conversationId: input.conversationId,
            messageId: messageResult.id,
            avatarUrl,
          })
        ),
      ).catch(console.error);
    }

    return messageResult;
  } catch (error) {
    if (error instanceof SendMessageError) throw error;
    if (isPgError(error)) {
      if (error.code === "23503") {
        throw new SendMessageError("POST_NOT_FOUND", "Post not found.", 404);
      }
      if (error.code === "22P02") {
        throw new SendMessageError("MISSING_INPUT", "Invalid format.", 400);
      }
    }
    throw new SendMessageError("INTERNAL_ERROR", "Error sending message.", 500);
  }
}
