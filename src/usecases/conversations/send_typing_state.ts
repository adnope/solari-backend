import { isValidUuid } from "../../utils/validation.ts";
import { getTypingStateContext } from "../../db/queries/get_typing_state_context.ts";
import { hasBlockingRelationship } from "../common_queries.ts";
import { AppError } from "../app_error.ts";

export type SendTypingStateInput = {
  senderId: string;
  conversationId: string;
  receiverId: string;
  isTyping: boolean;
};

export type SendTypingStateResult = {
  conversationId: string;
  senderId: string;
  receiverId: string;
  isTyping: boolean;
};

export type SendTypingStateErrorType =
  | "MISSING_INPUT"
  | "CONVERSATION_NOT_FOUND"
  | "UNAUTHORIZED"
  | "ARCHIVED"
  | "INTERNAL_ERROR";

export async function sendTypingState(input: SendTypingStateInput): Promise<SendTypingStateResult> {
  const normalizedSenderId = input.senderId.trim();
  const normalizedConversationId = input.conversationId.trim();
  const normalizedReceiverId = input.receiverId.trim();

  if (!normalizedSenderId || !normalizedConversationId || !normalizedReceiverId) {
    throw new AppError<SendTypingStateErrorType>("MISSING_INPUT", "Required fields missing.", 400);
  }

  if (
    !isValidUuid(normalizedSenderId) ||
    !isValidUuid(normalizedConversationId) ||
    !isValidUuid(normalizedReceiverId)
  ) {
    throw new AppError<SendTypingStateErrorType>("MISSING_INPUT", "Invalid format.", 400);
  }

  if (normalizedSenderId === normalizedReceiverId) {
    throw new AppError<SendTypingStateErrorType>("UNAUTHORIZED", "Invalid typing target.", 403);
  }

  try {
    const context = await getTypingStateContext(
      normalizedSenderId,
      normalizedConversationId,
      false,
    );

    if (!context) {
      throw new AppError<SendTypingStateErrorType>(
        "CONVERSATION_NOT_FOUND",
        "Conversation not found.",
        404,
      );
    }

    if (context.expectedReceiverId !== normalizedReceiverId) {
      throw new AppError<SendTypingStateErrorType>(
        "UNAUTHORIZED",
        "Receiver does not match conversation.",
        403,
      );
    }

    const isBlocked = await hasBlockingRelationship(normalizedSenderId, normalizedReceiverId);
    if (isBlocked) {
      throw new AppError<SendTypingStateErrorType>(
        "ARCHIVED",
        "This conversation is archived. You cannot send typing state.",
        403,
      );
    }

    if (!context.isFriend) {
      throw new AppError<SendTypingStateErrorType>(
        "ARCHIVED",
        "This conversation is archived. You cannot send typing state.",
        403,
      );
    }

    return {
      conversationId: normalizedConversationId,
      senderId: normalizedSenderId,
      receiverId: normalizedReceiverId,
      isTyping: input.isTyping,
    };
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Send typing state\n`, error);
    throw new AppError<SendTypingStateErrorType>(
      "INTERNAL_ERROR",
      "Internal server error sending typing state.",
      500,
    );
  }
}
