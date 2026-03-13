import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { conversations, messages, users } from "../../db/migrations/schema.ts";

export type ConversationPartner = {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
};

export type ConversationLastMessage = {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
} | null;

export type ConversationItem = {
  id: string;
  userLow: string;
  userHigh: string;
  createdAt: string;
  updatedAt: string;
  partner: ConversationPartner;
  lastMessage: ConversationLastMessage;
  currentUserLastReadAt: string | null;
  partnerLastReadAt: string | null;
};

export type GetConversationsResult = {
  items: ConversationItem[];
  nextCursor: string | null;
};

export type GetConversationsErrorType = "MISSING_INPUT" | "INVALID_CURSOR" | "INTERNAL_ERROR";

export class GetConversationsError extends Error {
  readonly type: GetConversationsErrorType;
  readonly statusCode: number;

  constructor(type: GetConversationsErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "GetConversationsError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function getConversations(
  userId: string,
  limit = 50,
  cursor?: string,
): Promise<GetConversationsResult> {
  const normalizedUserId = userId.trim();

  if (!normalizedUserId) {
    throw new GetConversationsError("MISSING_INPUT", "User ID is required.", 400);
  }

  if (!isValidUuid(normalizedUserId)) {
    throw new GetConversationsError("MISSING_INPUT", "Invalid user ID format.", 400);
  }

  let parsedCursor: string | undefined;
  if (cursor) {
    const parsed = new Date(cursor);
    if (Number.isNaN(parsed.getTime())) {
      throw new GetConversationsError(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }
    parsedCursor = parsed.toISOString();
  }

  const normalizedLimit = Math.min(Math.max(1, limit), 100);

  try {
    const conversationRows = await db
      .select({
        id: conversations.id,
        userLow: conversations.userLow,
        userHigh: conversations.userHigh,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        userLowLastReadAt: conversations.userLowLastReadAt,
        userHighLastReadAt: conversations.userHighLastReadAt,
      })
      .from(conversations)
      .where(
        and(
          or(
            eq(conversations.userLow, normalizedUserId),
            eq(conversations.userHigh, normalizedUserId),
          ),
          parsedCursor ? lt(conversations.updatedAt, parsedCursor) : undefined,
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(normalizedLimit);

    if (conversationRows.length === 0) {
      return {
        items: [],
        nextCursor: null,
      };
    }

    const conversationIds = conversationRows.map((row) => row.id);

    const partnerIds = [
      ...new Set(
        conversationRows.map((row) =>
          row.userLow === normalizedUserId ? row.userHigh : row.userLow,
        ),
      ),
    ];

    const partnerRows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
      })
      .from(users)
      .where(inArray(users.id, partnerIds));

    const partnerMap = new Map(
      partnerRows.map((partner) => [
        partner.id,
        {
          id: partner.id,
          username: partner.username,
          displayName: partner.displayName,
          avatarKey: partner.avatarKey,
        },
      ]),
    );

    const lastMessageRows = await db
      .selectDistinctOn([messages.conversationId], {
        conversationId: messages.conversationId,
        id: messages.id,
        senderId: messages.senderId,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .orderBy(messages.conversationId, desc(messages.createdAt));

    const lastMessageMap = new Map(
      lastMessageRows.map((message) => [
        message.conversationId,
        {
          id: message.id,
          senderId: message.senderId,
          content: message.content,
          createdAt: message.createdAt,
        },
      ]),
    );

    const items: ConversationItem[] = conversationRows.map((row) => {
      const partnerId = row.userLow === normalizedUserId ? row.userHigh : row.userLow;
      const partner = partnerMap.get(partnerId);

      if (!partner) {
        throw new GetConversationsError(
          "INTERNAL_ERROR",
          "Internal server error fetching conversations.",
          500,
        );
      }

      const isViewerLow = row.userLow === normalizedUserId;

      return {
        id: row.id,
        userLow: row.userLow,
        userHigh: row.userHigh,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        partner,
        lastMessage: lastMessageMap.get(row.id) ?? null,
        currentUserLastReadAt: isViewerLow ? row.userLowLastReadAt : row.userHighLastReadAt,
        partnerLastReadAt: isViewerLow ? row.userHighLastReadAt : row.userLowLastReadAt,
      };
    });

    const nextCursor = items.length > 0 ? items[items.length - 1]!.updatedAt : null;

    return {
      items,
      nextCursor,
    };
  } catch (error) {
    if (error instanceof GetConversationsError) throw error;

    throw new GetConversationsError(
      "INTERNAL_ERROR",
      "Internal server error fetching conversations.",
      500,
    );
  }
}
