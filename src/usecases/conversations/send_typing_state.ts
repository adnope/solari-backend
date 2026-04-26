import { isValidUuid } from "../../utils/uuid.ts";
import { getTypingStateContext } from "../../db/queries/get_typing_state_context.ts";
import { hasBlockingRelationship } from "../common_queries.ts";

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

export class SendTypingStateError extends Error {
  readonly type: SendTypingStateErrorType;
  readonly statusCode: number;

  constructor(type: SendTypingStateErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "SendTypingStateError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function sendTypingState(input: SendTypingStateInput): Promise<SendTypingStateResult> {
  const normalizedSenderId = input.senderId.trim();
  const normalizedConversationId = input.conversationId.trim();
  const normalizedReceiverId = input.receiverId.trim();

  if (!normalizedSenderId || !normalizedConversationId || !normalizedReceiverId) {
    throw new SendTypingStateError("MISSING_INPUT", "Required fields missing.", 400);
  }

  if (
    !isValidUuid(normalizedSenderId) ||
    !isValidUuid(normalizedConversationId) ||
    !isValidUuid(normalizedReceiverId)
  ) {
    throw new SendTypingStateError("MISSING_INPUT", "Invalid format.", 400);
  }

  if (normalizedSenderId === normalizedReceiverId) {
    throw new SendTypingStateError("UNAUTHORIZED", "Invalid typing target.", 403);
  }

  try {
    const context = await getTypingStateContext(
      normalizedSenderId,
      normalizedConversationId,
      false,
    );

    if (!context) {
      throw new SendTypingStateError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    }

    if (context.expectedReceiverId !== normalizedReceiverId) {
      throw new SendTypingStateError("UNAUTHORIZED", "Receiver does not match conversation.", 403);
    }

    const isBlocked = await hasBlockingRelationship(normalizedSenderId, normalizedReceiverId);
    if (isBlocked) {
      throw new SendTypingStateError(
        "ARCHIVED",
        "This conversation is archived. You cannot send typing state.",
        403,
      );
    }

    if (!context.isFriend) {
      throw new SendTypingStateError(
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
    if (error instanceof SendTypingStateError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Send typing state\n`, error);
    throw new SendTypingStateError(
      "INTERNAL_ERROR",
      "Internal server error sending typing state.",
      500,
    );
  }
}
