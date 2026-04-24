import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { conversations, messageReactions, messages } from "../../db/schema.ts";
import { getNickname, getUserSummaryById, hasBlockingRelationship } from "../common_queries.ts";
import { enqueuePushNotification, publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { isPgErrorCode, PgErrorCode } from "../postgres_error.ts";

export type ReactMessageInput = {
  userId: string;
  messageId: string;
  emoji: string;
};

export type ReactMessageResult = {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
};

export type ReactMessageErrorType =
  | "MISSING_INPUT"
  | "INVALID_EMOJI"
  | "UNAUTHORIZED_OR_NOT_FOUND"
  | "MESSAGE_DELETED"
  | "INTERNAL_ERROR";

export class ReactMessageError extends Error {
  readonly type: ReactMessageErrorType;
  readonly statusCode: number;

  constructor(type: ReactMessageErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ReactMessageError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export function isSingleEmoji(input: string): boolean {
  const emojiRegex = /^\p{RGI_Emoji}$/v;
  return emojiRegex.test(input);
}

export async function reactMessage(input: ReactMessageInput): Promise<ReactMessageResult> {
  const normalizedUserId = input.userId.trim();
  const normalizedMessageId = input.messageId.trim();
  const trimmedEmoji = input.emoji?.trim();

  if (!normalizedUserId || !normalizedMessageId || !trimmedEmoji) {
    throw new ReactMessageError(
      "MISSING_INPUT",
      "User ID, Message ID, and Emoji are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedMessageId)) {
    throw new ReactMessageError("UNAUTHORIZED_OR_NOT_FOUND", "Invalid ID.", 404);
  }

  if (!isSingleEmoji(trimmedEmoji)) {
    throw new ReactMessageError("INVALID_EMOJI", "Invalid emoji.", 400);
  }

  const reactionId = Bun.randomUUIDv7();

  try {
    const { reactionResult, pushData, receiverId, conversationId } = await withTx(async (tx) => {
      const [messageRow] = await tx
        .select({
          senderId: messages.senderId,
          conversationId: messages.conversationId,
          isDeleted: messages.isDeleted,
          userLow: conversations.userLow,
          userHigh: conversations.userHigh,
        })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(messages.id, normalizedMessageId),
            or(
              and(
                eq(conversations.userLow, normalizedUserId),
                or(
                  isNull(conversations.userLowClearedAt),
                  gte(messages.createdAt, conversations.userLowClearedAt),
                ),
              ),
              and(
                eq(conversations.userHigh, normalizedUserId),
                or(
                  isNull(conversations.userHighClearedAt),
                  gte(messages.createdAt, conversations.userHighClearedAt),
                ),
              ),
            ),
          ),
        )
        .limit(1);

      if (!messageRow) {
        throw new ReactMessageError(
          "UNAUTHORIZED_OR_NOT_FOUND",
          "Message not found or authorized.",
          404,
        );
      }

      if (messageRow.isDeleted) {
        throw new ReactMessageError("MESSAGE_DELETED", "Cannot react to an unsent message.", 400);
      }

      const targetReceiverId =
        messageRow.userLow === normalizedUserId ? messageRow.userHigh : messageRow.userLow;

      const isBlocked = await hasBlockingRelationship(normalizedUserId, targetReceiverId, tx);
      if (isBlocked) {
        throw new ReactMessageError(
          "UNAUTHORIZED_OR_NOT_FOUND",
          "Message not found or authorized.",
          404,
        );
      }

      const [reactionRow] = await tx
        .insert(messageReactions)
        .values({
          id: reactionId,
          messageId: normalizedMessageId,
          userId: normalizedUserId,
          emoji: trimmedEmoji,
        })
        .onConflictDoUpdate({
          target: [messageReactions.messageId, messageReactions.userId],
          set: { emoji: trimmedEmoji },
        })
        .returning({
          id: messageReactions.id,
          createdAt: messageReactions.createdAt,
        });

      if (!reactionRow) {
        throw new ReactMessageError("INTERNAL_ERROR", "Error adding reaction.", 500);
      }

      let pushPayload: {
        reactorName: string;
        conversationId: string;
        receiverId: string;
      } | null = null;

      if (messageRow.senderId !== normalizedUserId) {
        const recipientId = messageRow.senderId;

        const [reactor, nickname] = await Promise.all([
          getUserSummaryById(normalizedUserId, tx),
          getNickname(recipientId, normalizedUserId, tx),
        ]);

        pushPayload = {
          reactorName: nickname ?? reactor?.displayName ?? reactor?.username ?? "Someone",
          conversationId: messageRow.conversationId,
          receiverId: recipientId,
        };
      }

      return {
        reactionResult: {
          id: reactionRow.id,
          messageId: normalizedMessageId,
          userId: normalizedUserId,
          emoji: trimmedEmoji,
          createdAt: reactionRow.createdAt,
        },
        pushData: pushPayload,
        receiverId: targetReceiverId,
        conversationId: messageRow.conversationId,
      };
    });

    const eventPayload = {
      type: "NEW_REACTION" as const,
      payload: {
        conversationId,
        reaction: reactionResult,
      },
    };

    await publishWebSocketEventToUsers([receiverId, normalizedUserId], eventPayload);

    if (pushData) {
      try {
        await enqueuePushNotification({
          recipientUserId: pushData.receiverId,
          title: "New Reaction",
          body: `${pushData.reactorName} reacted ${trimmedEmoji} to your message`,
          notificationType: "NEW_MESSAGE_REACTION",
          extraData: {
            conversationId: pushData.conversationId,
            messageId: reactionResult.messageId,
          },
        });
      } catch (err) {
        console.error(`[ERROR] Failed to enqueue background push notification:`, err);
      }
    }

    return reactionResult;
  } catch (error: unknown) {
    if (error instanceof ReactMessageError) throw error;

    if (isPgErrorCode(error, PgErrorCode.INVALID_TEXT_REPRESENTATION)) {
      throw new ReactMessageError("UNAUTHORIZED_OR_NOT_FOUND", "Invalid ID.", 404);
    }

    console.error(`[ERROR] Unexpected error in use case: React message\n`, error);
    throw new ReactMessageError("INTERNAL_ERROR", "Error adding reaction.", 500);
  }
}
