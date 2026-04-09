import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { conversations, friendships, messages } from "../../db/schema.ts";
import { publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { hasBlockingRelationship } from "../common_queries.ts";

export type UnsendMessageInput = {
  senderId: string;
  messageId: string;
};

export type UnsendMessageResult = {
  messageId: string;
  conversationId: string;
  isDeleted: boolean;
};

export type UnsendMessageErrorType =
  | "MISSING_INPUT"
  | "MESSAGE_NOT_FOUND"
  | "UNAUTHORIZED"
  | "ARCHIVED"
  | "INTERNAL_ERROR";

export class UnsendMessageError extends Error {
  readonly type: UnsendMessageErrorType;
  readonly statusCode: number;

  constructor(type: UnsendMessageErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "UnsendMessageError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function unsendMessage(input: UnsendMessageInput): Promise<UnsendMessageResult> {
  const normalizedSenderId = input.senderId.trim();
  const normalizedMessageId = input.messageId.trim();

  if (!normalizedSenderId || !normalizedMessageId) {
    throw new UnsendMessageError("MISSING_INPUT", "Required fields missing.", 400);
  }

  if (!isValidUuid(normalizedSenderId) || !isValidUuid(normalizedMessageId)) {
    throw new UnsendMessageError("MISSING_INPUT", "Invalid format.", 400);
  }

  try {
    const { resultPayload, receiverId } = await withTx(async (tx) => {
      const [message] = await tx
        .select({
          senderId: messages.senderId,
          conversationId: messages.conversationId,
          isDeleted: messages.isDeleted,
        })
        .from(messages)
        .where(eq(messages.id, normalizedMessageId))
        .limit(1);

      if (!message) {
        throw new UnsendMessageError("MESSAGE_NOT_FOUND", "Message not found.", 404);
      }

      if (message.senderId !== normalizedSenderId) {
        throw new UnsendMessageError("UNAUTHORIZED", "You can only unsend your own messages.", 403);
      }

      const [conversation] = await tx
        .select({
          userLow: conversations.userLow,
          userHigh: conversations.userHigh,
        })
        .from(conversations)
        .where(eq(conversations.id, message.conversationId))
        .limit(1);

      if (!conversation) {
        throw new UnsendMessageError("INTERNAL_ERROR", "Conversation data missing.", 500);
      }

      const targetReceiverId =
        conversation.userLow === normalizedSenderId ? conversation.userHigh : conversation.userLow;

      const isBlocked = await hasBlockingRelationship(normalizedSenderId, targetReceiverId, tx);
      if (isBlocked) {
        throw new UnsendMessageError(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      const [friendship] = await tx
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
        throw new UnsendMessageError(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      if (message.isDeleted) {
        return {
          resultPayload: {
            conversationId: message.conversationId,
            messageId: normalizedMessageId,
            isDeleted: true,
          },
          receiverId: targetReceiverId,
        };
      }

      const [updatedMessage] = await tx
        .update(messages)
        .set({
          isDeleted: true,
          content: "",
        })
        .where(eq(messages.id, normalizedMessageId))
        .returning({
          id: messages.id,
          conversationId: messages.conversationId,
        });

      if (!updatedMessage) {
        throw new UnsendMessageError("INTERNAL_ERROR", "Failed to unsend message.", 500);
      }

      return {
        resultPayload: {
          messageId: updatedMessage.id,
          conversationId: updatedMessage.conversationId,
          isDeleted: true,
        },
        receiverId: targetReceiverId,
      };
    });

    const eventPayload = {
      type: "MESSAGE_UNSENT" as const,
      payload: resultPayload,
    };

    await publishWebSocketEventToUsers([receiverId, normalizedSenderId], eventPayload);

    return resultPayload;
  } catch (error) {
    if (error instanceof UnsendMessageError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Unsend message\n${error}`);
    throw new UnsendMessageError("INTERNAL_ERROR", "Error unsending message.", 500);
  }
}
