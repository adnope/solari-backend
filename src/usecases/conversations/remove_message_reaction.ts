import { isValidUuid } from "../../utils/validation.ts";
import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { messageReactions } from "../../db/schema.ts";
import { publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { getMessageActionContext } from "../../db/queries/get_message_action_context.ts";
import { AppError } from "../app_error.ts";

export type RemoveMessageReactionErrorType =
  | "MISSING_INPUT"
  | "REACTION_NOT_FOUND"
  | "ARCHIVED"
  | "INTERNAL_ERROR";

export async function removeMessageReaction(userId: string, messageId: string): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedMessageId = messageId.trim();

  if (!normalizedUserId || !normalizedMessageId) {
    throw new AppError<RemoveMessageReactionErrorType>(
      "MISSING_INPUT",
      "User ID and Message ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedMessageId)) {
    throw new AppError<RemoveMessageReactionErrorType>(
      "REACTION_NOT_FOUND",
      "Invalid message ID format.",
      404,
    );
  }

  try {
    const { receiverId, conversationId } = await withTx(async (tx) => {
      const authorizedMessage = await getMessageActionContext(
        normalizedMessageId,
        normalizedUserId,
        tx,
        true,
      );

      if (!authorizedMessage) {
        throw new AppError<RemoveMessageReactionErrorType>(
          "REACTION_NOT_FOUND",
          "Message not found, deleted, or you are not authorized.",
          404,
        );
      }

      if (authorizedMessage.isBlocked) {
        throw new AppError<RemoveMessageReactionErrorType>(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      if (!authorizedMessage.isFriend) {
        throw new AppError<RemoveMessageReactionErrorType>(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      const [deletedReaction] = await tx
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, normalizedMessageId),
            eq(messageReactions.userId, normalizedUserId),
          ),
        )
        .returning({ id: messageReactions.id });

      if (!deletedReaction) {
        throw new AppError<RemoveMessageReactionErrorType>(
          "REACTION_NOT_FOUND",
          "Reaction not found.",
          404,
        );
      }

      return {
        receiverId: authorizedMessage.receiverId,
        conversationId: authorizedMessage.conversationId,
      };
    });

    const eventPayload = {
      type: "REACTION_REMOVED" as const,
      payload: {
        conversationId,
        messageId: normalizedMessageId,
        userId: normalizedUserId,
      },
    };

    await publishWebSocketEventToUsers([receiverId, normalizedUserId], eventPayload);
  } catch (error) {
    if (error instanceof AppError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Remove message reaction\n${error}`);
    throw new AppError<RemoveMessageReactionErrorType>(
      "INTERNAL_ERROR",
      "Internal server error removing reaction.",
      500,
    );
  }
}
