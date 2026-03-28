import { and, eq, gte, isNull, or } from "drizzle-orm";
import { getFileUrl } from "../../storage/s3.ts";
import { withTx } from "../../db/client.ts";
import {
  conversations,
  messageReactions,
  messages,
  userDevices,
  users,
} from "../../db/schema.ts";
import { sendPushNotification } from "../../utils/fcm.ts";

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
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
    const { reactionResult, pushData } = await withTx(async (tx) => {
      const [messageRow] = await tx
        .select({
          senderId: messages.senderId,
          conversationId: messages.conversationId,
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
          set: {
            emoji: trimmedEmoji,
          },
        })
        .returning({
          id: messageReactions.id,
          createdAt: messageReactions.createdAt,
        });

      if (!reactionRow) {
        throw new ReactMessageError("INTERNAL_ERROR", "Error adding reaction.", 500);
      }

      let pushData: {
        tokens: string[];
        reactorName: string;
        reactorAvatarKey: string | null;
        conversationId: string;
      } | null = null;

      if (messageRow.senderId !== normalizedUserId) {
        const [reactor] = await tx
          .select({
            username: users.username,
            displayName: users.displayName,
            avatarKey: users.avatarKey,
          })
          .from(users)
          .where(eq(users.id, normalizedUserId))
          .limit(1);

        const tokensRows = await tx
          .select({
            deviceToken: userDevices.deviceToken,
          })
          .from(userDevices)
          .where(eq(userDevices.userId, messageRow.senderId));

        pushData = {
          tokens: tokensRows.map((row) => row.deviceToken),
          reactorName: reactor?.displayName || reactor?.username || "Someone",
          reactorAvatarKey: reactor?.avatarKey ?? null,
          conversationId: messageRow.conversationId,
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
        pushData,
      };
    });

    if (pushData && pushData.tokens.length > 0) {
      const avatarUrl = pushData.reactorAvatarKey
        ? await getFileUrl(pushData.reactorAvatarKey)
        : "";

      const extraData = {
        conversationId: pushData.conversationId,
        messageId: reactionResult.messageId,
        avatarUrl,
      };

      void Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(
            token,
            "New Reaction",
            `${pushData.reactorName} reacted ${trimmedEmoji}`,
            "NEW_MESSAGE_REACTION",
            extraData,
          ),
        ),
      ).catch(console.error);
    }

    return reactionResult;
  } catch (error) {
    if (error instanceof ReactMessageError) throw error;

    throw new ReactMessageError("INTERNAL_ERROR", "Error adding reaction.", 500);
  }
}
