import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";

export type ConversationPartner = {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
};

export type ConversationItem = {
  id: string;
  userLow: string;
  userHigh: string;
  createdAt: Date;
  updatedAt: Date;
  partner: ConversationPartner;
};

export type GetConversationsResult = {
  items: ConversationItem[];
  nextCursor: string | null;
};

export type GetConversationsErrorType =
  | "MISSING_INPUT"
  | "INVALID_CURSOR"
  | "INTERNAL_ERROR";

export class GetConversationsError extends Error {
  readonly type: GetConversationsErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: GetConversationsErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "GetConversationsError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

type ConversationRow = {
  id: string;
  user_low: string;
  user_high: string;
  created_at: Date;
  updated_at: Date;
  partner_id: string;
  partner_username: string;
  partner_display_name: string | null;
  partner_avatar_key: string | null;
};

export async function getConversations(
  userId: string,
  limit = 50,
  cursor?: string,
): Promise<GetConversationsResult> {
  if (!userId) {
    throw new GetConversationsError(
      "MISSING_INPUT",
      "User ID is required.",
      400,
    );
  }

  let parsedCursor: Date | null = null;
  if (cursor) {
    parsedCursor = new Date(cursor);
    if (isNaN(parsedCursor.getTime())) {
      throw new GetConversationsError(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }
  }

  const normalizedLimit = Math.min(Math.max(1, limit), 100);

  try {
    return await withDb(async (client) => {
      const result = await client.queryObject<ConversationRow>(
        `
        SELECT
          c.id,
          c.user_low,
          c.user_high,
          c.created_at,
          c.updated_at,
          u.id AS partner_id,
          u.username AS partner_username,
          u.display_name AS partner_display_name,
          u.avatar_key AS partner_avatar_key
        FROM conversations c
        JOIN users u ON u.id = CASE WHEN c.user_low = $1 THEN c.user_high ELSE c.user_low END
        WHERE (c.user_low = $1 OR c.user_high = $1)
          AND ($2::timestamptz IS NULL OR c.updated_at < $2)
        ORDER BY c.updated_at DESC
        LIMIT $3
        `,
        [userId, parsedCursor, normalizedLimit],
      );

      const items: ConversationItem[] = result.rows.map((row) => ({
        id: row.id,
        userLow: row.user_low,
        userHigh: row.user_high,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        partner: {
          id: row.partner_id,
          username: row.partner_username,
          displayName: row.partner_display_name,
          avatarKey: row.partner_avatar_key,
        },
      }));

      const nextCursor = items.length > 0 ? items[items.length - 1].updatedAt.toISOString() : null;

      return {
        items,
        nextCursor,
      };
    });
  } catch (error) {
    if (error instanceof GetConversationsError) throw error;

    if (isPgError(error) && error.fields.code === "22P02") {
      throw new GetConversationsError("MISSING_INPUT", "Invalid user ID format.", 400);
    }

    throw new GetConversationsError(
      "INTERNAL_ERROR",
      "Internal server error fetching conversations.",
      500,
    );
  }
}
