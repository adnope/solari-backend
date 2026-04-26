import { sql } from "drizzle-orm";
import { db } from "../client.ts";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type FriendRequestContext = {
  receiverId: string;
  isBlocked: boolean;
  isFriend: boolean;
  outgoingReqId: string | null;
  incomingReqId: string | null;
};

type FriendRequestContextRow = FriendRequestContext & Record<string, unknown>;

export async function getFriendRequestContext(
  requesterId: string,
  identifier: string,
  tx: DbTransaction,
): Promise<FriendRequestContext | null> {
  const isEmail = identifier.includes("@");

  const query = sql`
    WITH receiver_cte AS (
      SELECT id FROM users WHERE ${
        isEmail ? sql`email = ${identifier}` : sql`username = ${identifier}`
      } LIMIT 1
    )
    SELECT
      r.id AS "receiverId",
      EXISTS(SELECT 1 FROM blocked_users WHERE (blocker_id = ${requesterId} AND blocked_id = r.id) OR (blocker_id = r.id AND blocked_id = ${requesterId})) AS "isBlocked",
      EXISTS(SELECT 1 FROM friendships WHERE user_low = LEAST(${requesterId}::uuid, r.id::uuid) AND user_high = GREATEST(${requesterId}::uuid, r.id::uuid)) AS "isFriend",
      (SELECT id FROM friend_requests WHERE requester_id = ${requesterId} AND receiver_id = r.id LIMIT 1) AS "outgoingReqId",
      (SELECT id FROM friend_requests WHERE requester_id = r.id AND receiver_id = ${requesterId} LIMIT 1) AS "incomingReqId"
    FROM receiver_cte r;
  `;

  const rows = await tx.execute<FriendRequestContextRow>(query);
  const row = rows[0];

  if (!row) return null;

  return {
    receiverId: row.receiverId,
    isBlocked: Boolean(row.isBlocked),
    isFriend: Boolean(row.isFriend),
    outgoingReqId: row.outgoingReqId ?? null,
    incomingReqId: row.incomingReqId ?? null,
  };
}
