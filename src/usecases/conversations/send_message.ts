import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { db, withTx } from "../../db/client.ts";
import { conversations, messages, mutedConversations } from "../../db/schema.ts";
import { getNickname, getUserSummaryById, hasBlockingRelationship } from "../common_queries.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";
import { enqueuePushNotification, publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { getSendMessageContext } from "../../db/queries/get_send_message_context.ts";

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
    const context = await getSendMessageContext(
      normalizedSenderId,
      normalizedConversationId,
      normalizedReferencedPostId,
      normalizedRepliedMessageId,
      false,
    );

    if (!context) {
      throw new SendMessageError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    }

    if (context.userLow !== normalizedSenderId && context.userHigh !== normalizedSenderId) {
      throw new SendMessageError(
        "CONVERSATION_NOT_FOUND",
        "Unauthorized access to conversation.",
        404,
      );
    }

    if (normalizedReferencedPostId) {
      if (!context.referencedPostAuthorId) {
        throw new SendMessageError("POST_NOT_FOUND", "Post not found.", 404);
      }
      if (context.referencedPostAuthorId === normalizedSenderId) {
        throw new SendMessageError("CANNOT_REFERENCE_OWN_POST", "Cannot reference own post.", 400);
      }
    }

    if (normalizedRepliedMessageId) {
      if (!context.repliedMessageConversationId) {
        throw new SendMessageError("REPLIED_MESSAGE_NOT_FOUND", "Replied message not found.", 404);
      }
      if (context.repliedMessageIsDeleted) {
        throw new SendMessageError(
          "REPLIED_MESSAGE_UNSENT",
          "Cannot reply to a deleted message.",
          400,
        );
      }
      if (context.repliedMessageConversationId !== normalizedConversationId) {
        throw new SendMessageError(
          "REPLIED_MESSAGE_NOT_FOUND",
          "Replied message is not in this conversation.",
          400,
        );
      }
    }

    const isBlocked = await hasBlockingRelationship(normalizedSenderId, context.receiverId);

    if (isBlocked || !context.isFriend) {
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
          context.userLow === normalizedSenderId
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
    await publishWebSocketEventToUsers([context.receiverId, normalizedSenderId], wsPayload);

    void (async () => {
      try {
        const [isMuted] = await db
          .select({ mutedAt: mutedConversations.mutedAt })
          .from(mutedConversations)
          .where(
            and(
              eq(mutedConversations.userId, context.receiverId),
              eq(mutedConversations.conversationId, normalizedConversationId),
            ),
          )
          .limit(1);

        if (isMuted) return;

        const [sender, nickname] = await Promise.all([
          getUserSummaryById(normalizedSenderId),
          getNickname(context.receiverId, normalizedSenderId),
        ]);

        if (sender) {
          const senderName = nickname ?? sender.displayName ?? sender.username ?? "Someone";
          let title = "New Message";
          let body = `${senderName} sent you a message`;

          if (normalizedReferencedPostId) {
            title = "New Post Reply";
            body = `${senderName} replied to your post`;
          } else if (normalizedRepliedMessageId) {
            title = "New Reply";
            body = `${senderName} replied to a message`;
          }

          await enqueuePushNotification({
            recipientUserId: context.receiverId,
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
