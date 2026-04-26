import { sql } from "drizzle-orm";
import { db } from "../client.ts";

export type TypingStateContext = {
  userLow: string;
  userHigh: string;
  expectedReceiverId: string;
  isBlocked: boolean;
  isFriend: boolean;
};

type TypingStateContextRow = TypingStateContext & Record<string, unknown>;

export async function getTypingStateContext(
  senderId: string,
  conversationId: string,
  includeBlockingCheck = true,
): Promise<TypingStateContext | null> {
  const blockingSelection = includeBlockingCheck
    ? sql`EXISTS(
        SELECT 1
        FROM blocked_users
        WHERE
          (blocker_id = ${senderId}::uuid AND blocked_id = ctx."expectedReceiverId")
          OR (blocker_id = ctx."expectedReceiverId" AND blocked_id = ${senderId}::uuid)
      )`
    : sql`FALSE`;

  const rows = await db.execute<TypingStateContextRow>(sql`
    WITH conversation_cte AS (
      SELECT user_low AS "userLow", user_high AS "userHigh"
      FROM conversations
      WHERE
        id = ${conversationId}::uuid
        AND (user_low = ${senderId}::uuid OR user_high = ${senderId}::uuid)
      LIMIT 1
    ),
    context_cte AS (
      SELECT
        c."userLow",
        c."userHigh",
        CASE WHEN c."userLow" = ${senderId}::uuid THEN c."userHigh" ELSE c."userLow" END
          AS "expectedReceiverId"
      FROM conversation_cte c
    )
    SELECT
      ctx.*,
      ${blockingSelection} AS "isBlocked",
      EXISTS(
        SELECT 1
        FROM friendships
        WHERE user_low = ctx."userLow" AND user_high = ctx."userHigh"
      ) AS "isFriend"
    FROM context_cte ctx;
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    userLow: row.userLow,
    userHigh: row.userHigh,
    expectedReceiverId: row.expectedReceiverId,
    isBlocked: Boolean(row.isBlocked),
    isFriend: Boolean(row.isFriend),
  };
}
