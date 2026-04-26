import { isValidUuid } from "../../utils/uuid.ts";
import { eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { messages } from "../../db/schema.ts";
import { publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { getMessageActionContext } from "../../db/queries/get_message_action_context.ts";

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
      const message = await getMessageActionContext(
        normalizedMessageId,
        normalizedSenderId,
        tx,
        false,
      );

      if (!message) {
        throw new UnsendMessageError("MESSAGE_NOT_FOUND", "Message not found.", 404);
      }

      if (message.senderId !== normalizedSenderId) {
        throw new UnsendMessageError("UNAUTHORIZED", "You can only unsend your own messages.", 403);
      }

      if (message.isBlocked) {
        throw new UnsendMessageError(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      if (!message.isFriend) {
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
          receiverId: message.receiverId,
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
        receiverId: message.receiverId,
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
