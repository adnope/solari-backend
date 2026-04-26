import { sql } from "drizzle-orm";
import { db } from "../client.ts";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MessageActionContext = {
  messageId: string;
  senderId: string;
  conversationId: string;
  isDeleted: boolean;
  userLow: string;
  userHigh: string;
  receiverId: string;
  isBlocked: boolean;
  isFriend: boolean;
};

type MessageActionContextRow = MessageActionContext & Record<string, unknown>;

export async function getMessageActionContext(
  messageId: string,
  actorId: string,
  tx: DbTransaction,
  requireVisibleToActor: boolean,
): Promise<MessageActionContext | null> {
  const visibilityCondition = requireVisibleToActor
    ? sql`
      AND (
        (
          c.user_low = ${actorId}::uuid
          AND (c.user_low_cleared_at IS NULL OR m.created_at >= c.user_low_cleared_at)
        )
        OR (
          c.user_high = ${actorId}::uuid
          AND (c.user_high_cleared_at IS NULL OR m.created_at >= c.user_high_cleared_at)
        )
      )
    `
    : sql``;

  const rows = await tx.execute<MessageActionContextRow>(sql`
    WITH message_cte AS (
      SELECT
        m.id AS "messageId",
        m.sender_id AS "senderId",
        m.conversation_id AS "conversationId",
        m.is_deleted AS "isDeleted",
        c.user_low AS "userLow",
        c.user_high AS "userHigh"
      FROM messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = ${messageId}::uuid
      ${visibilityCondition}
      LIMIT 1
    )
    SELECT
      m.*,
      CASE
        WHEN m."userLow" = ${actorId}::uuid THEN m."userHigh"
        ELSE m."userLow"
      END AS "receiverId",
      EXISTS(
        SELECT 1
        FROM blocked_users
        WHERE
          (
            blocker_id = ${actorId}::uuid
            AND blocked_id = CASE
              WHEN m."userLow" = ${actorId}::uuid THEN m."userHigh"
              ELSE m."userLow"
            END
          )
          OR (
            blocker_id = CASE
              WHEN m."userLow" = ${actorId}::uuid THEN m."userHigh"
              ELSE m."userLow"
            END
            AND blocked_id = ${actorId}::uuid
          )
      ) AS "isBlocked",
      EXISTS(
        SELECT 1
        FROM friendships
        WHERE user_low = m."userLow" AND user_high = m."userHigh"
      ) AS "isFriend"
    FROM message_cte m;
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    messageId: row.messageId,
    senderId: row.senderId,
    conversationId: row.conversationId,
    isDeleted: Boolean(row.isDeleted),
    userLow: row.userLow,
    userHigh: row.userHigh,
    receiverId: row.receiverId,
    isBlocked: Boolean(row.isBlocked),
    isFriend: Boolean(row.isFriend),
  };
}
