import { isValidUuid } from "../../utils/uuid.ts";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  blockedUsers,
  conversations,
  friendships,
  messages,
  mutedConversations,
} from "../../db/schema.ts";
import { getNicknameMap, getUserSummariesByIds } from "../common_queries.ts";

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
  isDeleted: boolean;
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
  isReadOnly: boolean;
  isMuted: boolean;
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

export async function getConversations(
  userId: string,
  limit = 20,
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

    const [partnerMap, friendshipRows, blockedByRows, nicknamesMap, mutedRows] = await Promise.all([
      getUserSummariesByIds(partnerIds),
      db
        .select({ userLow: friendships.userLow, userHigh: friendships.userHigh })
        .from(friendships)
        .where(
          or(
            and(
              eq(friendships.userLow, normalizedUserId),
              inArray(friendships.userHigh, partnerIds),
            ),
            and(
              eq(friendships.userHigh, normalizedUserId),
              inArray(friendships.userLow, partnerIds),
            ),
          ),
        ),

      db
        .select({ blockerId: blockedUsers.blockerId })
        .from(blockedUsers)
        .where(
          and(
            eq(blockedUsers.blockedId, normalizedUserId),
            inArray(blockedUsers.blockerId, partnerIds),
          ),
        ),

      getNicknameMap(normalizedUserId, partnerIds),

      db
        .select({ conversationId: mutedConversations.conversationId })
        .from(mutedConversations)
        .where(
          and(
            eq(mutedConversations.userId, normalizedUserId),
            inArray(mutedConversations.conversationId, conversationIds),
          ),
        ),
    ]);

    const activeFriendsSet = new Set(
      friendshipRows.map((f) => (f.userLow === normalizedUserId ? f.userHigh : f.userLow)),
    );
    const blockedByPartnerSet = new Set(blockedByRows.map((b) => b.blockerId));
    const mutedConversationSet = new Set(mutedRows.map((row) => row.conversationId));

    const lastMessageRows = await db
      .selectDistinctOn([messages.conversationId], {
        conversationId: messages.conversationId,
        id: messages.id,
        senderId: messages.senderId,
        content: messages.content,
        isDeleted: messages.isDeleted,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .orderBy(messages.conversationId, desc(messages.createdAt));

    const lastMessageMap = new Map(lastMessageRows.map((m) => [m.conversationId, m]));

    const items: ConversationItem[] = conversationRows.map((row) => {
      const partnerId = row.userLow === normalizedUserId ? row.userHigh : row.userLow;
      const partner = partnerMap.get(partnerId);

      if (!partner) {
        throw new GetConversationsError("INTERNAL_ERROR", "Partner not found.", 500);
      }

      const isViewerLow = row.userLow === normalizedUserId;
      const isFriend = activeFriendsSet.has(partnerId);
      const isBlockedByPartner = blockedByPartnerSet.has(partnerId);

      const nickname = nicknamesMap.get(partnerId);

      const finalPartner: ConversationPartner = isBlockedByPartner
        ? {
            id: partner.id,
            username: "Someone",
            displayName: null,
            avatarKey: null,
          }
        : {
            ...partner,
            displayName: nickname ?? partner.displayName,
          };

      return {
        id: row.id,
        userLow: row.userLow,
        userHigh: row.userHigh,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        partner: finalPartner,
        lastMessage: lastMessageMap.get(row.id) ?? null,
        currentUserLastReadAt: isViewerLow ? row.userLowLastReadAt : row.userHighLastReadAt,
        partnerLastReadAt: isViewerLow ? row.userHighLastReadAt : row.userLowLastReadAt,
        isReadOnly: !isFriend,
        isMuted: mutedConversationSet.has(row.id),
      };
    });

    return {
      items,
      nextCursor: items.length > 0 ? items[items.length - 1]!.updatedAt : null,
    };
  } catch (error) {
    if (error instanceof GetConversationsError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Get conversations\n${error}`);
    throw new GetConversationsError(
      "INTERNAL_ERROR",
      "Internal server error fetching conversations.",
      500,
    );
  }
}
