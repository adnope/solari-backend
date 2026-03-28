import { eq } from "drizzle-orm";
import { getFileUrl } from "../../storage/s3.ts";
import { withTx } from "../../db/client.ts";
import { conversations, messages, posts, userDevices, users } from "../../db/schema.ts";
import { sendPushNotification } from "../../utils/fcm.ts";

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
  createdAt: string;
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
  readonly statusCode: number;

  constructor(type: SendMessageErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "SendMessageError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const normalizedSenderId = input.senderId.trim();
  const normalizedConversationId = input.conversationId.trim();
  const normalizedReferencedPostId = input.referencedPostId?.trim();
  const trimmedContent = input.content?.trim();

  if (!normalizedSenderId || !normalizedConversationId) {
    throw new SendMessageError("MISSING_INPUT", "Required fields missing.", 400);
  }

  if (
    !isValidUuid(normalizedSenderId) ||
    !isValidUuid(normalizedConversationId) ||
    (normalizedReferencedPostId && !isValidUuid(normalizedReferencedPostId))
  ) {
    throw new SendMessageError("MISSING_INPUT", "Invalid format.", 400);
  }

  if (!trimmedContent) {
    throw new SendMessageError("EMPTY_CONTENT", "Content is empty.", 400);
  }

  const messageId = Bun.randomUUIDv7();
  const createdAt = new Date().toISOString();

  try {
    const { messageResult, pushData } = await withTx(async (tx) => {
      if (normalizedReferencedPostId) {
        const [referencedPost] = await tx
          .select({
            authorId: posts.authorId,
          })
          .from(posts)
          .where(eq(posts.id, normalizedReferencedPostId))
          .limit(1);

        if (!referencedPost) {
          throw new SendMessageError("POST_NOT_FOUND", "Post not found.", 404);
        }

        if (referencedPost.authorId === normalizedSenderId) {
          throw new SendMessageError(
            "CANNOT_REFERENCE_OWN_POST",
            "Cannot reference own post.",
            400,
          );
        }
      }

      const [conversation] = await tx
        .select({
          userLow: conversations.userLow,
          userHigh: conversations.userHigh,
        })
        .from(conversations)
        .where(eq(conversations.id, normalizedConversationId))
        .limit(1);

      if (!conversation) {
        throw new SendMessageError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
      }

      if (
        conversation.userLow !== normalizedSenderId &&
        conversation.userHigh !== normalizedSenderId
      ) {
        throw new SendMessageError("CONVERSATION_NOT_FOUND", "Unauthorized.", 404);
      }

      const isSenderLow = conversation.userLow === normalizedSenderId;

      const receiverId = isSenderLow ? conversation.userHigh : conversation.userLow;

      const [insertedMessage] = await tx
        .insert(messages)
        .values({
          id: messageId,
          conversationId: normalizedConversationId,
          senderId: normalizedSenderId,
          content: trimmedContent,
          referencedPostId: normalizedReferencedPostId ?? null,
          createdAt,
        })
        .returning({
          createdAt: messages.createdAt,
        });

      if (!insertedMessage) {
        throw new SendMessageError("INTERNAL_ERROR", "Error sending message.", 500);
      }

      await tx
        .update(conversations)
        .set(
          isSenderLow
            ? {
                updatedAt: insertedMessage.createdAt,
                userLowLastReadAt: insertedMessage.createdAt,
              }
            : {
                updatedAt: insertedMessage.createdAt,
                userHighLastReadAt: insertedMessage.createdAt,
              },
        )
        .where(eq(conversations.id, normalizedConversationId));

      const [sender] = await tx
        .select({
          username: users.username,
          displayName: users.displayName,
          avatarKey: users.avatarKey,
        })
        .from(users)
        .where(eq(users.id, normalizedSenderId))
        .limit(1);

      const tokenRows = await tx
        .select({
          deviceToken: userDevices.deviceToken,
        })
        .from(userDevices)
        .where(eq(userDevices.userId, receiverId));

      return {
        messageResult: {
          id: messageId,
          conversationId: normalizedConversationId,
          senderId: normalizedSenderId,
          content: trimmedContent,
          referencedPostId: normalizedReferencedPostId ?? null,
          createdAt: insertedMessage.createdAt,
        },
        pushData: {
          tokens: tokenRows.map((row) => row.deviceToken),
          senderName: sender?.displayName || sender?.username || "Someone",
          senderAvatarKey: sender?.avatarKey ?? null,
        },
      };
    });

    if (pushData.tokens.length > 0) {
      const avatarUrl = pushData.senderAvatarKey ? await getFileUrl(pushData.senderAvatarKey) : "";
      const isReply = !!normalizedReferencedPostId;
      const title = isReply ? "New Post Reply" : "New Message";
      const body = isReply
        ? `${pushData.senderName} replied to your post.`
        : `${pushData.senderName} sent a message.`;

      void Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(token, title, body, "NEW_MESSAGE", {
            conversationId: normalizedConversationId,
            messageId: messageResult.id,
            avatarUrl,
          }),
        ),
      ).catch(console.error);
    }

    return messageResult;
  } catch (error) {
    if (error instanceof SendMessageError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Send message\n${error}`)
    throw new SendMessageError("INTERNAL_ERROR", "Error sending message.", 500);
  }
}
