import { isValidUuid } from "../../utils/uuid.ts";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  blockedUsers,
  conversations,
  friendships,
  messages,
  mutedConversations,
} from "../../db/schema.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { getNickname, getUserSummaryById } from "../common_queries.ts";
import type { ConversationItem, ConversationPartner } from "./get_conversations.ts";

export type GetConversationErrorType =
  | "MISSING_INPUT"
  | "CONVERSATION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class GetConversationError extends Error {
  readonly type: GetConversationErrorType;
  readonly statusCode: number;

  constructor(type: GetConversationErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "GetConversationError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<ConversationItem> {
  const normalizedUserId = userId.trim();
  const normalizedConversationId = conversationId.trim();

  if (!normalizedUserId || !normalizedConversationId) {
    throw new GetConversationError(
      "MISSING_INPUT",
      "User ID and conversation ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedConversationId)) {
    throw new GetConversationError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
  }

  try {
    const [conversation] = await db
      .select({
        id: conversations.id,
        userLow: conversations.userLow,
        userHigh: conversations.userHigh,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        userLowClearedAt: conversations.userLowClearedAt,
        userHighClearedAt: conversations.userHighClearedAt,
        userLowLastReadAt: conversations.userLowLastReadAt,
        userHighLastReadAt: conversations.userHighLastReadAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, normalizedConversationId),
          or(
            eq(conversations.userLow, normalizedUserId),
            eq(conversations.userHigh, normalizedUserId),
          ),
        ),
      )
      .limit(1);

    if (!conversation) {
      throw new GetConversationError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    }

    const partnerId =
      conversation.userLow === normalizedUserId ? conversation.userHigh : conversation.userLow;

    const [partner, friendship, blockedByPartner, nickname, lastMessage, mutedConversation] =
      await Promise.all([
        getUserSummaryById(partnerId),

        db
          .select({ userLow: friendships.userLow })
          .from(friendships)
          .where(
            and(
              eq(friendships.userLow, conversation.userLow),
              eq(friendships.userHigh, conversation.userHigh),
            ),
          )
          .limit(1)
          .then((rows) => rows[0]),

        db
          .select({ blockerId: blockedUsers.blockerId })
          .from(blockedUsers)
          .where(
            and(
              eq(blockedUsers.blockerId, partnerId),
              eq(blockedUsers.blockedId, normalizedUserId),
            ),
          )
          .limit(1)
          .then((rows) => rows[0]),

        getNickname(normalizedUserId, partnerId),

        db
          .select({
            id: messages.id,
            senderId: messages.senderId,
            content: messages.content,
            isDeleted: messages.isDeleted,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(eq(messages.conversationId, normalizedConversationId))
          .orderBy(desc(messages.createdAt))
          .limit(1)
          .then((rows) => rows[0] ?? null),

        db
          .select({ conversationId: mutedConversations.conversationId })
          .from(mutedConversations)
          .where(
            and(
              eq(mutedConversations.userId, normalizedUserId),
              eq(mutedConversations.conversationId, normalizedConversationId),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ]);

    if (!partner) {
      throw new GetConversationError("INTERNAL_ERROR", "Partner not found.", 500);
    }

    const avatarUrl =
      !blockedByPartner && partner.avatarKey ? await getFileUrl(partner.avatarKey) : null;

    const finalPartner: ConversationPartner = blockedByPartner
      ? {
          id: partner.id,
          username: "Someone",
          displayName: null,
          avatarUrl: null,
        }
      : {
          id: partner.id,
          username: partner.username,
          displayName: nickname ?? partner.displayName,
          avatarUrl,
        };

    const isViewerLow = conversation.userLow === normalizedUserId;
    const currentUserClearedAt = isViewerLow
      ? conversation.userLowClearedAt
      : conversation.userHighClearedAt;
    const visibleLastMessage =
      lastMessage && currentUserClearedAt && currentUserClearedAt > lastMessage.createdAt
        ? null
        : lastMessage;

    return {
      id: conversation.id,
      userLow: conversation.userLow,
      userHigh: conversation.userHigh,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      partner: finalPartner,
      lastMessage: visibleLastMessage,
      currentUserLastReadAt: isViewerLow
        ? conversation.userLowLastReadAt
        : conversation.userHighLastReadAt,
      partnerLastReadAt: isViewerLow
        ? conversation.userHighLastReadAt
        : conversation.userLowLastReadAt,
      isReadOnly: !friendship,
      isMuted: Boolean(mutedConversation),
    };
  } catch (error) {
    if (error instanceof GetConversationError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Get conversation\n${error}`);
    throw new GetConversationError(
      "INTERNAL_ERROR",
      "Internal server error fetching conversation.",
      500,
    );
  }
}
