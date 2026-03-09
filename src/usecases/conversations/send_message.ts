import type { ContentfulStatusCode } from "hono/utils/http-status";
import { v7 } from "uuid";
import { withDb } from "../../db/postgres_client.ts";
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

  const messageId = v7();

  try {
    return await withDb(async (client) => {
      if (input.referencedPostId) {
        const postCheckResult = await client<{ author_id: string }[]>`
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

      const result = await client<{ id: string; created_at: Date }[]>`
        WITH conv_check AS (
          SELECT id FROM conversations
          WHERE id = ${input.conversationId} AND (user_low = ${input.senderId} OR user_high = ${input.senderId})
        ),
        inserted_msg AS (
          INSERT INTO messages (id, conversation_id, sender_id, content, referenced_post_id)
          SELECT ${messageId}, id, ${input.senderId}, ${trimmedContent}, ${input.referencedPostId || null}
          FROM conv_check
          RETURNING id, created_at
        ),
        updated_conv AS (
          UPDATE conversations
          SET updated_at = (SELECT created_at FROM inserted_msg)
          WHERE id = (SELECT id FROM conv_check)
        )
        SELECT id, created_at FROM inserted_msg;
      `;

      if (result.length === 0) {
        throw new SendMessageError(
          "CONVERSATION_NOT_FOUND",
          "Conversation not found or you are not a participant.",
          404,
        );
      }

      return {
        id: messageId,
        conversationId: input.conversationId,
        senderId: input.senderId,
        content: trimmedContent,
        referencedPostId: input.referencedPostId || null,
        createdAt: result[0]!.created_at,
      };
    });
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
