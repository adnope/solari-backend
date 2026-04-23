import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { db, withTx } from "../../db/client.ts";
import {
  conversations,
  friendships,
  messages,
  mutedConversations,
  posts,
} from "../../db/schema.ts";
import { hasBlockingRelationship, getNickname, getUserSummaryById } from "../common_queries.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";
import { enqueuePushNotification, publishWebSocketEventToUsers } from "../../jobs/queue.ts";

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
    throw new SendMessageError("MISSING_INPUT", "Invalid ID format.", 400);
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

    if (!conversation) {
      throw new SendMessageError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    }

    if (
      conversation.userLow !== normalizedSenderId &&
      conversation.userHigh !== normalizedSenderId
    ) {
      throw new SendMessageError(
        "CONVERSATION_NOT_FOUND",
        "Unauthorized access to conversation.",
        404,
      );
    }

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

    const receiverId =
      conversation.userLow === normalizedSenderId ? conversation.userHigh : conversation.userLow;

    const [isBlocked, friendship] = await Promise.all([
      hasBlockingRelationship(normalizedSenderId, receiverId),
      db
        .select({ userLow: friendships.userLow })
        .from(friendships)
        .where(
          and(
            eq(friendships.userLow, conversation.userLow),
            eq(friendships.userHigh, conversation.userHigh),
          ),
        )
        .limit(1)
        .then((res) => res[0]),
    ]);

    if (isBlocked || !friendship) {
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
        throw new SendMessageError("INTERNAL_ERROR", "Error writing message to database.", 500);
      }

      await tx
        .update(conversations)
        .set(
          conversation.userLow === normalizedSenderId
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
      payload: { conversationId: normalizedConversationId, message: messageResult },
    };
    await publishWebSocketEventToUsers([receiverId, normalizedSenderId], wsPayload);

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

        const [sender, nickname] = await Promise.all([
          getUserSummaryById(normalizedSenderId),
          getNickname(receiverId, normalizedSenderId),
        ]);

        if (sender) {
          const senderName = nickname ?? sender.displayName ?? sender.username ?? "Someone";
          let title = "New Message";
          let body = `${senderName} sent a message.`;

          if (normalizedReferencedPostId) {
            title = "New Post Reply";
            body = `${senderName} replied to your post.`;
          } else if (normalizedRepliedMessageId) {
            title = "New Reply";
            body = `${senderName} replied to a message.`;
          }

          await enqueuePushNotification({
            recipientUserId: receiverId,
            title,
            body,
            notificationType: "NEW_MESSAGE",
            extraData: {
              conversationId: normalizedConversationId,
              messageId: messageResult.id,
            },
          });
        }
      } catch (err) {
        console.error(`[ERROR] Background notification failure:`, err);
      }
    })();

    return messageResult;
  } catch (error: unknown) {
    if (error instanceof SendMessageError) throw error;

    if (isPgErrorCode(error, PgErrorCode.INVALID_TEXT_REPRESENTATION)) {
      throw new SendMessageError("MISSING_INPUT", "Invalid format.", 400);
    }

    console.error(`[ERROR] Unexpected error in use case: Send message\n`, error);
    throw new SendMessageError("INTERNAL_ERROR", "Internal server error sending message.", 500);
  }
}
