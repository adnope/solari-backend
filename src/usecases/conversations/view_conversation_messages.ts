import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

export type MessageReaction = {
  userId: string;
  emoji: string;
};

export type ConversationMessage = {
  id: string;
  senderId: string;
  content: string;
  referencedPostId: string | null;
  createdAt: Date;
  reactions: MessageReaction[];
};

export type ViewConversationMessagesResult = {
  items: ConversationMessage[];
  nextCursor: string | null;
};

export type ViewConversationMessagesErrorType =
  | "MISSING_INPUT"
  | "INVALID_CURSOR"
  | "UNAUTHORIZED"
  | "CONVERSATION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ViewConversationMessagesError extends Error {
  readonly type: ViewConversationMessagesErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: ViewConversationMessagesErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "ViewConversationMessagesError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

type MessageRow = {
  id: string;
  sender_id: string;
  content: string;
  referenced_post_id: string | null;
  created_at: Date;
  reactions: { user_id: string; emoji: string }[];
};

export async function viewConversationMessages(
  viewerId: string,
  conversationId: string,
  limit = 50,
  cursor?: string,
): Promise<ViewConversationMessagesResult> {
  if (!viewerId || !conversationId) {
    throw new ViewConversationMessagesError(
      "MISSING_INPUT",
      "Viewer ID and Conversation ID are required.",
      400,
    );
  }

  let parsedCursor: Date | null = null;
  if (cursor) {
    parsedCursor = new Date(cursor);
    if (isNaN(parsedCursor.getTime())) {
      throw new ViewConversationMessagesError(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }
  }

  const normalizedLimit = Math.min(Math.max(1, limit), 50);

  try {
    return await withDb(async (client) => {
      const authCheckResult = await client.queryObject<{
        user_low: string;
        user_high: string;
        user_low_cleared_at: Date | null;
        user_high_cleared_at: Date | null;
      }>(
        `
        SELECT user_low, user_high, user_low_cleared_at, user_high_cleared_at
        FROM conversations WHERE id = $1
        `,
        [conversationId],
      );

      if (authCheckResult.rows.length === 0) {
        throw new ViewConversationMessagesError(
          "CONVERSATION_NOT_FOUND",
          "Conversation not found.",
          404,
        );
      }

      const conv = authCheckResult.rows[0];
      if (conv.user_low !== viewerId && conv.user_high !== viewerId) {
        throw new ViewConversationMessagesError(
          "UNAUTHORIZED",
          "You are not a participant in this conversation.",
          403,
        );
      }

      const clearedAt = conv.user_low === viewerId
        ? conv.user_low_cleared_at
        : conv.user_high_cleared_at;

      const result = await client.queryObject<MessageRow>(
        `
        SELECT
          m.id,
          m.sender_id,
          m.content,
          m.referenced_post_id,
          m.created_at,
          COALESCE(
            json_agg(
              json_build_object('user_id', mr.user_id, 'emoji', mr.emoji)
            ) FILTER (WHERE mr.id IS NOT NULL),
            '[]'
          ) AS reactions
        FROM messages m
        LEFT JOIN message_reactions mr ON mr.message_id = m.id
        WHERE m.conversation_id = $1
          AND ($2::timestamptz IS NULL OR m.created_at >= $2)
          AND ($3::timestamptz IS NULL OR m.created_at < $3)
        GROUP BY m.id
        ORDER BY m.created_at DESC
        LIMIT $4
        `,
        [conversationId, clearedAt, parsedCursor, normalizedLimit],
      );

      const items: ConversationMessage[] = result.rows.map((row) => ({
        id: row.id,
        senderId: row.sender_id,
        content: row.content,
        referencedPostId: row.referenced_post_id,
        createdAt: row.created_at,
        reactions: row.reactions.map((r) => ({
          userId: r.user_id,
          emoji: r.emoji,
        })),
      }));

      const nextCursor = items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null;

      return {
        items,
        nextCursor,
      };
    });
  } catch (error) {
    if (error instanceof ViewConversationMessagesError) throw error;

    if (isPgError(error) && error.fields.code === "22P02") {
      throw new ViewConversationMessagesError(
        "CONVERSATION_NOT_FOUND",
        "Invalid conversation ID format.",
        404,
      );
    }

    throw new ViewConversationMessagesError(
      "INTERNAL_ERROR",
      "Internal server error fetching messages.",
      500,
    );
  }
}
