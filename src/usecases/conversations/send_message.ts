import { and, eq } from "drizzle-orm";
import { db, withTx } from "../../db/client.ts";
import {
  conversations,
  friendships,
  messages,
  mutedConversations,
  posts,
  users,
} from "../../db/schema.ts";
import { wsPublisher } from "../../websocket/publisher.ts";
import { hasBlockingRelationship } from "../common_queries.ts";
import { enqueueJob } from "../../jobs/queue.ts";

export type SendMessageInput = {
  senderId: string;
  conversationId: string;
  content: string;
  referencedPostId?: string;
  repliedMessageId?: string;
};

export type SendMessageResult = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  referencedPostId: string | null;
  repliedMessageId: string | null;
  createdAt: string;
};

export type SendMessageErrorType =
  | "MISSING_INPUT"
  | "EMPTY_CONTENT"
  | "CONVERSATION_NOT_FOUND"
  | "POST_NOT_FOUND"
  | "CANNOT_REFERENCE_OWN_POST"
  | "INVALID_REFERENCE_COMBINATION"
  | "REPLIED_MESSAGE_UNSENT"
  | "REPLIED_MESSAGE_NOT_FOUND"
  | "NOT_FRIENDS"
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
  const normalizedRepliedMessageId = input.repliedMessageId?.trim();
  const trimmedContent = input.content?.trim();

  if (!normalizedSenderId || !normalizedConversationId) {
    throw new SendMessageError("MISSING_INPUT", "Required fields missing.", 400);
  }

  if (
    !isValidUuid(normalizedSenderId) ||
    !isValidUuid(normalizedConversationId) ||
    (normalizedReferencedPostId && !isValidUuid(normalizedReferencedPostId)) ||
    (normalizedRepliedMessageId && !isValidUuid(normalizedRepliedMessageId))
  ) {
    throw new SendMessageError("MISSING_INPUT", "Invalid format.", 400);
  }

  if (normalizedReferencedPostId && normalizedRepliedMessageId) {
    throw new SendMessageError(
      "INVALID_REFERENCE_COMBINATION",
      "A message cannot reply to both a post and a message simultaneously.",
      400,
    );
  }

  if (!trimmedContent) {
    throw new SendMessageError("EMPTY_CONTENT", "Content is empty.", 400);
  }

  const messageId = Bun.randomUUIDv7();
  const createdAt = new Date().toISOString();

  try {
    const [conversation, referencedPost, repliedMessage] = await Promise.all([
      db
        .select({ userLow: conversations.userLow, userHigh: conversations.userHigh })
        .from(conversations)
        .where(eq(conversations.id, normalizedConversationId))
        .limit(1)
        .then((res) => res[0]),

      normalizedReferencedPostId
        ? db
            .select({ authorId: posts.authorId })
            .from(posts)
            .where(eq(posts.id, normalizedReferencedPostId))
            .limit(1)
            .then((res) => res[0])
        : Promise.resolve(null),

      normalizedRepliedMessageId
        ? db
            .select({ conversationId: messages.conversationId, isDeleted: messages.isDeleted })
            .from(messages)
            .where(eq(messages.id, normalizedRepliedMessageId))
            .limit(1)
            .then((res) => res[0])
        : Promise.resolve(null),
    ]);

    if (normalizedReferencedPostId) {
      if (!referencedPost) throw new SendMessageError("POST_NOT_FOUND", "Post not found.", 404);
      if (referencedPost.authorId === normalizedSenderId) {
        throw new SendMessageError("CANNOT_REFERENCE_OWN_POST", "Cannot reference own post.", 400);
      }
    }

    if (normalizedRepliedMessageId) {
      if (!repliedMessage)
        throw new SendMessageError("REPLIED_MESSAGE_NOT_FOUND", "Replied message not found.", 404);
      if (repliedMessage.isDeleted)
        throw new SendMessageError(
          "REPLIED_MESSAGE_UNSENT",
          "Cannot reply to a deleted message.",
          400,
        );
      if (repliedMessage.conversationId !== normalizedConversationId) {
        throw new SendMessageError(
          "REPLIED_MESSAGE_NOT_FOUND",
          "Replied message is not in this conversation.",
          400,
        );
      }
    }

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

    const isBlocked = await hasBlockingRelationship(normalizedSenderId, receiverId);
    if (isBlocked) {
      throw new SendMessageError("NOT_FRIENDS", "You can only message friends.", 403);
    }

    const [friendship] = await db
      .select({ userLow: friendships.userLow })
      .from(friendships)
      .where(
        and(
          eq(friendships.userLow, conversation.userLow),
          eq(friendships.userHigh, conversation.userHigh),
        ),
      )
      .limit(1);

    if (!friendship) {
      throw new SendMessageError("NOT_FRIENDS", "You can only message friends.", 403);
    }

    const messageResult = await withTx(async (tx) => {
      const [insertedMessage] = await tx
        .insert(messages)
        .values({
          id: messageId,
          conversationId: normalizedConversationId,
          senderId: normalizedSenderId,
          content: trimmedContent,
          referencedPostId: normalizedReferencedPostId ?? null,
          repliedMessageId: normalizedRepliedMessageId ?? null,
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
            ? { updatedAt: insertedMessage.createdAt, userLowLastReadAt: insertedMessage.createdAt }
            : {
                updatedAt: insertedMessage.createdAt,
                userHighLastReadAt: insertedMessage.createdAt,
              },
        )
        .where(eq(conversations.id, normalizedConversationId));

      return {
        id: messageId,
        conversationId: normalizedConversationId,
        senderId: normalizedSenderId,
        content: trimmedContent,
        referencedPostId: normalizedReferencedPostId ?? null,
        repliedMessageId: normalizedRepliedMessageId ?? null,
        createdAt: insertedMessage.createdAt,
      };
    });

    const wsPayload = {
      type: "NEW_MESSAGE" as const,
      payload: {
        conversationId: normalizedConversationId,
        message: messageResult,
      },
    };

    wsPublisher.sendToUser(receiverId, wsPayload);
    wsPublisher.sendToUser(normalizedSenderId, wsPayload);

    void (async () => {
      try {
        const [isMuted] = await db
          .select({ mutedAt: mutedConversations.mutedAt })
          .from(mutedConversations)
          .where(
            and(
              eq(mutedConversations.userId, receiverId),
              eq(mutedConversations.conversationId, normalizedConversationId),
            ),
          )
          .limit(1);

        if (isMuted) return;

        const sender = await db
          .select({
            username: users.username,
            displayName: users.displayName,
            avatarKey: users.avatarKey,
          })
          .from(users)
          .where(eq(users.id, normalizedSenderId))
          .limit(1)
          .then((res) => res[0]);

        if (sender) {
          const isPostReply = !!normalizedReferencedPostId;
          const isMessageReply = !!normalizedRepliedMessageId;
          const senderName = sender.displayName || sender.username || "Someone";

          let title = "New Message";
          let body = `${senderName} sent a message.`;

          if (isPostReply) {
            title = "New Post Reply";
            body = `${senderName} replied to your post.`;
          } else if (isMessageReply) {
            title = "New Reply";
            body = `${senderName} replied to a message.`;
          }

          const extraData = {
            conversationId: normalizedConversationId,
            messageId: messageResult.id,
            avatarKey: sender.avatarKey || "",
          };

          await enqueueJob("push-notification-processing", Bun.randomUUIDv7(), {
            recipientUserId: receiverId,
            title,
            body,
            notificationType: "NEW_MESSAGE",
            extraData,
          });
        }
      } catch (err) {
        console.error(`[ERROR] Failed to enqueue background push notification: ${err}`);
      }
    })();

    return messageResult;
  } catch (error) {
    if (error instanceof SendMessageError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Send message\n${error}`);
    throw new SendMessageError("INTERNAL_ERROR", "Error sending message.", 500);
  }
}
