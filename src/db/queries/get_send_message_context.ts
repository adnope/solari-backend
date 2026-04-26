import { sql } from "drizzle-orm";
import { db } from "../client.ts";

export type SendMessageContext = {
  userLow: string;
  userHigh: string;
  receiverId: string;
  referencedPostAuthorId: string | null;
  repliedMessageConversationId: string | null;
  repliedMessageIsDeleted: boolean | null;
  isBlocked: boolean;
  isFriend: boolean;
};

type SendMessageContextRow = SendMessageContext & Record<string, unknown>;

export async function getSendMessageContext(
  senderId: string,
  conversationId: string,
  referencedPostId?: string,
  repliedMessageId?: string,
  includeBlockingCheck = true,
): Promise<SendMessageContext | null> {
  const referencedPostCte = referencedPostId
    ? sql`referenced_post_cte AS (
        SELECT author_id AS "referencedPostAuthorId"
        FROM posts
        WHERE id = ${referencedPostId}::uuid
        LIMIT 1
      ),`
    : sql`referenced_post_cte AS (
        SELECT NULL::uuid AS "referencedPostAuthorId"
        WHERE FALSE
      ),`;

  const repliedMessageCte = repliedMessageId
    ? sql`replied_message_cte AS (
        SELECT
          conversation_id AS "repliedMessageConversationId",
          is_deleted AS "repliedMessageIsDeleted"
        FROM messages
        WHERE id = ${repliedMessageId}::uuid
        LIMIT 1
      ),`
    : sql`replied_message_cte AS (
        SELECT
          NULL::uuid AS "repliedMessageConversationId",
          NULL::boolean AS "repliedMessageIsDeleted"
        WHERE FALSE
      ),`;

  const blockingSelection = includeBlockingCheck
    ? sql`EXISTS(
        SELECT 1
        FROM blocked_users
        WHERE
          (blocker_id = ${senderId}::uuid AND blocked_id = ctx."receiverId")
          OR (blocker_id = ctx."receiverId" AND blocked_id = ${senderId}::uuid)
      )`
    : sql`FALSE`;

  const rows = await db.execute<SendMessageContextRow>(sql`
    WITH conversation_cte AS (
      SELECT user_low AS "userLow", user_high AS "userHigh"
      FROM conversations
      WHERE id = ${conversationId}::uuid
      LIMIT 1
    ),
    ${referencedPostCte}
    ${repliedMessageCte}
    context_cte AS (
      SELECT
        c."userLow",
        c."userHigh",
        CASE WHEN c."userLow" = ${senderId}::uuid THEN c."userHigh" ELSE c."userLow" END
          AS "receiverId",
        rp."referencedPostAuthorId",
        rm."repliedMessageConversationId",
        rm."repliedMessageIsDeleted"
      FROM conversation_cte c
      LEFT JOIN referenced_post_cte rp ON TRUE
      LEFT JOIN replied_message_cte rm ON TRUE
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
    receiverId: row.receiverId,
    referencedPostAuthorId: row.referencedPostAuthorId ?? null,
    repliedMessageConversationId: row.repliedMessageConversationId ?? null,
    repliedMessageIsDeleted: row.repliedMessageIsDeleted,
    isBlocked: Boolean(row.isBlocked),
    isFriend: Boolean(row.isFriend),
  };
}
