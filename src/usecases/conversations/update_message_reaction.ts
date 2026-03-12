import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { messageReactions } from "../../db/migrations/schema.ts";
import { isSingleEmoji } from "./react_message.ts";

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
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
    const [updated] = await db
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
      id: updated.id,
      messageId: normalizedMessageId,
      userId: normalizedUserId,
      emoji: trimmedEmoji,
      createdAt: updated.createdAt,
    };
  } catch (error) {
    if (error instanceof UpdateMessageReactionError) throw error;

    throw new UpdateMessageReactionError(
      "INTERNAL_ERROR",
      "Internal server error updating reaction.",
      500,
    );
  }
}
