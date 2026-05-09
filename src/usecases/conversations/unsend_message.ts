import { isValidUuid } from "../../utils/validation.ts";
import { eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { messages } from "../../db/schema.ts";
import { publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { getMessageActionContext } from "../../db/queries/get_message_action_context.ts";
import { AppError } from "../app_error.ts";

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

export async function unsendMessage(input: UnsendMessageInput): Promise<UnsendMessageResult> {
  const normalizedSenderId = input.senderId.trim();
  const normalizedMessageId = input.messageId.trim();

  if (!normalizedSenderId || !normalizedMessageId) {
    throw new AppError<UnsendMessageErrorType>("MISSING_INPUT", "Required fields missing.", 400);
  }

  if (!isValidUuid(normalizedSenderId) || !isValidUuid(normalizedMessageId)) {
    throw new AppError<UnsendMessageErrorType>("MISSING_INPUT", "Invalid format.", 400);
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
        throw new AppError<UnsendMessageErrorType>("MESSAGE_NOT_FOUND", "Message not found.", 404);
      }

      if (message.senderId !== normalizedSenderId) {
        throw new AppError<UnsendMessageErrorType>(
          "UNAUTHORIZED",
          "You can only unsend your own messages.",
          403,
        );
      }

      if (message.isBlocked) {
        throw new AppError<UnsendMessageErrorType>(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      if (!message.isFriend) {
        throw new AppError<UnsendMessageErrorType>(
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
        throw new AppError<UnsendMessageErrorType>(
          "INTERNAL_ERROR",
          "Failed to unsend message.",
          500,
        );
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
    if (error instanceof AppError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Unsend message\n${error}`);
    throw new AppError<UnsendMessageErrorType>("INTERNAL_ERROR", "Error unsending message.", 500);
  }
}
