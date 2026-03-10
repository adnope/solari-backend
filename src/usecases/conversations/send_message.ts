import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { getFileUrl } from "../../storage/minio.ts";
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
    throw new SendMessageError("MISSING_INPUT", "Sender ID and Conversation ID are required.", 400);
  }

  if (!trimmedContent) {
    throw new SendMessageError("EMPTY_CONTENT", "Message content cannot be empty.", 400);
  }

  const messageId = Bun.randomUUIDv7();

  try {
    const { messageResult, pushData } = await withDb(async (client) => {
      return await client.begin(async (tx) => {
        if (input.referencedPostId) {
          const postCheckResult = await tx<{ author_id: string }[]>`
            SELECT author_id FROM posts WHERE id = ${input.referencedPostId}
          `;

          if (postCheckResult.length === 0) {
            throw new SendMessageError("POST_NOT_FOUND", "Referenced post does not exist.", 404);
          }

          if (postCheckResult[0]!.author_id === input.senderId) {
            throw new SendMessageError(
              "CANNOT_REFERENCE_OWN_POST",
              "You cannot reference your own post in a message.",
              400,
            );
          }
        }

        const convCheck = await tx<{ user_low: string; user_high: string }[]>`
          SELECT user_low, user_high FROM conversations WHERE id = ${input.conversationId}
        `;

        if (convCheck.length === 0) {
          throw new SendMessageError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
        }

        const conv = convCheck[0]!;
        if (conv.user_low !== input.senderId && conv.user_high !== input.senderId) {
          throw new SendMessageError("CONVERSATION_NOT_FOUND", "You are not a participant.", 404);
        }

        const receiverId = conv.user_low === input.senderId ? conv.user_high : conv.user_low;

        const insertResult = await tx<{ created_at: Date }[]>`
          INSERT INTO messages (id, conversation_id, sender_id, content, referenced_post_id)
          VALUES (${messageId}, ${input.conversationId}, ${input.senderId}, ${trimmedContent}, ${input.referencedPostId || null})
          RETURNING created_at
        `;

        await tx`
          UPDATE conversations
          SET updated_at = ${insertResult[0]!.created_at}
          WHERE id = ${input.conversationId}
        `;

        const senderResult = await tx<
          { username: string; display_name: string | null; avatar_key: string | null }[]
        >`
          SELECT username, display_name, avatar_key FROM users WHERE id = ${input.senderId} LIMIT 1
        `;
        const senderName = senderResult[0]?.display_name || senderResult[0]?.username || "Someone";
        const senderAvatarKey = senderResult[0]?.avatar_key;

        const devicesResult = await tx<{ device_token: string }[]>`
          SELECT device_token FROM user_devices WHERE user_id = ${receiverId}
        `;
        const tokens = devicesResult.map((row) => row.device_token);

        return {
          messageResult: {
            id: messageId,
            conversationId: input.conversationId,
            senderId: input.senderId,
            content: trimmedContent,
            referencedPostId: input.referencedPostId || null,
            createdAt: insertResult[0]!.created_at,
          },
          pushData: { tokens, senderName, senderAvatarKey },
        };
      });
    });

    if (pushData.tokens.length > 0) {
      const isReply = !!input.referencedPostId;
      const title = isReply ? "New Post Reply" : "New Message";
      const body = isReply
        ? `${pushData.senderName} replied to your post.`
        : `${pushData.senderName} sent you a new message.`;

      let avatarUrl = "";
      if (pushData.senderAvatarKey) {
        avatarUrl = await getFileUrl(pushData.senderAvatarKey);
      }

      const extraData = {
        conversationId: input.conversationId,
        messageId: messageResult.id,
        avatarUrl: avatarUrl,
      };

      Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(token, title, body, "NEW_MESSAGE", extraData),
        ),
      ).catch(console.error);
    }

    return messageResult;
  } catch (error: any) {
    if (error instanceof SendMessageError) throw error;

    if (isPgError(error)) {
      const constraint = error.constraint || error.constraint_name;
      if (error.code === "23503" && constraint === "messages_referenced_post_id_fkey") {
        throw new SendMessageError("POST_NOT_FOUND", "Referenced post does not exist.", 404);
      }
      if (error.code === "22P02") {
        throw new SendMessageError("MISSING_INPUT", "Invalid ID format.", 400);
      }
    }

    throw new SendMessageError("INTERNAL_ERROR", "Internal server error sending message.", 500);
  }
}
