import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { conversations, messageReactions, messages } from "../../db/migrations/schema.ts";

export type MessageReaction = {
  userId: string;
  emoji: string;
};

export type ConversationMessage = {
  id: string;
  senderId: string;
  content: string;
  referencedPostId: string | null;
  createdAt: string;
  reactions: MessageReaction[];
};

export type ViewConversationMessagesResult = {
  items: ConversationMessage[];
  nextCursor: string | null;
  partnerLastReadAt: string | null;
};

export type ViewConversationMessagesErrorType =
  | "MISSING_INPUT"
  | "INVALID_CURSOR"
  | "UNAUTHORIZED"
  | "CONVERSATION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ViewConversationMessagesError extends Error {
  readonly type: ViewConversationMessagesErrorType;
  readonly statusCode: number;

  constructor(type: ViewConversationMessagesErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ViewConversationMessagesError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function viewConversationMessages(
  viewerId: string,
  conversationId: string,
  limit = 50,
  cursor?: string,
): Promise<ViewConversationMessagesResult> {
  const normalizedViewerId = viewerId.trim();
  const normalizedConversationId = conversationId.trim();

  if (!normalizedViewerId || !normalizedConversationId) {
    throw new ViewConversationMessagesError(
      "MISSING_INPUT",
      "Viewer ID and Conversation ID are required.",
      400,
    );
  }

  if (!isValidUuid(normalizedViewerId) || !isValidUuid(normalizedConversationId)) {
    throw new ViewConversationMessagesError(
      "CONVERSATION_NOT_FOUND",
      "Invalid conversation ID format.",
      404,
    );
  }

  let parsedCursor: string | undefined;
  if (cursor) {
    const parsed = new Date(cursor);
    if (Number.isNaN(parsed.getTime())) {
      throw new ViewConversationMessagesError(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }
    parsedCursor = parsed.toISOString();
  }

  const normalizedLimit = Math.min(Math.max(1, limit), 50);

  try {
    const [conversation] = await db
      .select({
        userLow: conversations.userLow,
        userHigh: conversations.userHigh,
        userLowClearedAt: conversations.userLowClearedAt,
        userHighClearedAt: conversations.userHighClearedAt,
        userLowLastReadAt: conversations.userLowLastReadAt,
        userHighLastReadAt: conversations.userHighLastReadAt,
      })
      .from(conversations)
      .where(eq(conversations.id, normalizedConversationId))
      .limit(1);

    if (!conversation) {
      throw new ViewConversationMessagesError(
        "CONVERSATION_NOT_FOUND",
        "Conversation not found.",
        404,
      );
    }

    if (
      conversation.userLow !== normalizedViewerId &&
      conversation.userHigh !== normalizedViewerId
    ) {
      throw new ViewConversationMessagesError(
        "UNAUTHORIZED",
        "You are not a participant in this conversation.",
        403,
      );
    }

    const isViewerLow = conversation.userLow === normalizedViewerId;

    const clearedAt = isViewerLow ? conversation.userLowClearedAt : conversation.userHighClearedAt;

    const partnerLastReadAt = isViewerLow
      ? conversation.userHighLastReadAt
      : conversation.userLowLastReadAt;

    const messageRows = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        content: messages.content,
        referencedPostId: messages.referencedPostId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, normalizedConversationId),
          clearedAt ? gte(messages.createdAt, clearedAt) : undefined,
          parsedCursor ? lt(messages.createdAt, parsedCursor) : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(normalizedLimit);

    if (messageRows.length === 0) {
      return {
        items: [],
        nextCursor: null,
        partnerLastReadAt: partnerLastReadAt ?? null,
      };
    }

    const messageIds = messageRows.map((message) => message.id);

    const reactionRows = await db
      .select({
        messageId: messageReactions.messageId,
        userId: messageReactions.userId,
        emoji: messageReactions.emoji,
      })
      .from(messageReactions)
      .where(inArray(messageReactions.messageId, messageIds));

    const reactionsMap = new Map<string, MessageReaction[]>();

    for (const reaction of reactionRows) {
      const existing = reactionsMap.get(reaction.messageId) ?? [];
      existing.push({
        userId: reaction.userId,
        emoji: reaction.emoji,
      });
      reactionsMap.set(reaction.messageId, existing);
    }

    const items: ConversationMessage[] = messageRows.map((message) => ({
      id: message.id,
      senderId: message.senderId,
      content: message.content,
      referencedPostId: message.referencedPostId,
      createdAt: message.createdAt,
      reactions: reactionsMap.get(message.id) ?? [],
    }));

    const nextCursor = items.length > 0 ? items[items.length - 1]!.createdAt : null;

    return {
      items,
      nextCursor,
      partnerLastReadAt: partnerLastReadAt ?? null,
    };
  } catch (error) {
    if (error instanceof ViewConversationMessagesError) throw error;

    throw new ViewConversationMessagesError(
      "INTERNAL_ERROR",
      "Internal server error fetching messages.",
      500,
    );
  }
}
