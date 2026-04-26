import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { messageReactions } from "../../db/schema.ts";
import { publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { isSingleEmoji } from "./react_message.ts";
import { getMessageActionContext } from "../../db/queries/get_message_action_context.ts";

export type UpdateMessageReactionInput = {
  userId: string;
  messageId: string;
  emoji: string;
};

export type UpdateMessageReactionResult = {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
};

export type UpdateMessageReactionErrorType =
  | "MISSING_INPUT"
  | "INVALID_EMOJI"
  | "REACTION_NOT_FOUND"
  | "ARCHIVED"
  | "INTERNAL_ERROR";

export class UpdateMessageReactionError extends Error {
  readonly type: UpdateMessageReactionErrorType;
  readonly statusCode: number;

  constructor(type: UpdateMessageReactionErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "UpdateMessageReactionError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function updateMessageReaction(
  input: UpdateMessageReactionInput,
): Promise<UpdateMessageReactionResult> {
  const normalizedUserId = input.userId.trim();
  const normalizedMessageId = input.messageId.trim();
  const trimmedEmoji = input.emoji?.trim();

  if (!normalizedUserId || !normalizedMessageId || !trimmedEmoji) {
    throw new UpdateMessageReactionError(
      "MISSING_INPUT",
      "User ID, Message ID, and Emoji are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedMessageId)) {
    throw new UpdateMessageReactionError("REACTION_NOT_FOUND", "Invalid message ID format.", 404);
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new UpdateMessageReactionError(
      "INVALID_EMOJI",
      "Reaction must be a single valid emoji.",
      400,
    );
  }

  try {
    const { updatedReaction, receiverId, conversationId } = await withTx(async (tx) => {
      const messageRow = await getMessageActionContext(
        normalizedMessageId,
        normalizedUserId,
        tx,
        false,
      );

      if (!messageRow) {
        throw new UpdateMessageReactionError("REACTION_NOT_FOUND", "Message not found.", 404);
      }

      if (messageRow.isBlocked) {
        throw new UpdateMessageReactionError(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      if (!messageRow.isFriend) {
        throw new UpdateMessageReactionError(
          "ARCHIVED",
          "This conversation is archived. You cannot modify it.",
          403,
        );
      }

      const [updated] = await tx
        .update(messageReactions)
        .set({
          emoji: trimmedEmoji,
        })
        .where(
          and(
            eq(messageReactions.messageId, normalizedMessageId),
            eq(messageReactions.userId, normalizedUserId),
          ),
        )
        .returning({
          id: messageReactions.id,
          createdAt: messageReactions.createdAt,
        });

      if (!updated) {
        throw new UpdateMessageReactionError(
          "REACTION_NOT_FOUND",
          "Reaction not found. You must react to the message first.",
          404,
        );
      }

      return {
        updatedReaction: {
          id: updated.id,
          messageId: normalizedMessageId,
          userId: normalizedUserId,
          emoji: trimmedEmoji,
          createdAt: updated.createdAt,
        },
        receiverId: messageRow.receiverId,
        conversationId: messageRow.conversationId,
      };
    });

    const eventPayload = {
      type: "REACTION_UPDATED" as const,
      payload: {
        conversationId,
        reaction: updatedReaction,
      },
    };

    await publishWebSocketEventToUsers([receiverId, normalizedUserId], eventPayload);

    return updatedReaction;
  } catch (error) {
    if (error instanceof UpdateMessageReactionError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Update message reaction\n${error}`);
    throw new UpdateMessageReactionError(
      "INTERNAL_ERROR",
      "Internal server error updating reaction.",
      500,
    );
  }
}
